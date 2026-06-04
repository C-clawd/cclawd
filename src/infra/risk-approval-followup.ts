import path from "node:path";
import { sendExecApprovalFollowup } from "../agents/bash-tools.exec-approval-followup.js";
import {
  DEFAULT_MAX_OUTPUT,
  DEFAULT_PENDING_MAX_OUTPUT,
  DEFAULT_NOTIFY_TAIL_CHARS,
  applyShellPath,
  normalizeNotifyOutput,
  runExecProcess,
} from "../agents/bash-tools.exec-runtime.js";
import { callGatewayTool } from "../agents/tools/gateway.js";
import { callGateway } from "../gateway/call.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  getShellPathFromLoginShell,
  resolveShellEnvFallbackTimeoutMs,
} from "../infra/shell-env.js";
import type { RiskApprovalRequestPayload, RiskApprovalResolved } from "./risk-approvals.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";

const log = createSubsystemLogger("gateway/risk-approvals");

const EXEC_LIKE_TOOLS = new Set([
  "exec",
  "bash",
  "Bash",
  "shell",
  "run_command",
  "execute",
  "terminal",
  "cmd",
  "powershell",
]);

const DEFAULT_EXEC_TIMEOUT_SEC = 1800;

export type RiskApprovalResolvedHook = (resolved: RiskApprovalResolved) => void;

let resolvedHook: RiskApprovalResolvedHook | null = null;

export function setRiskApprovalResolvedHook(hook: RiskApprovalResolvedHook | null): void {
  resolvedHook = hook;
}

export function parseRiskApprovalToolParams(
  toolName: string,
  paramsPreview: string,
): Record<string, unknown> | null {
  const prefix = `${toolName} `;
  let jsonPart = paramsPreview.startsWith(prefix)
    ? paramsPreview.slice(prefix.length)
    : paramsPreview;
  jsonPart = jsonPart.replace(/…$/, "").trim();
  if (!jsonPart.startsWith("{")) {
    const braceIndex = jsonPart.indexOf("{");
    if (braceIndex >= 0) {
      jsonPart = jsonPart.slice(braceIndex);
    }
  }
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractExecCommand(
  toolName: string,
  params: Record<string, unknown>,
): string | null {
  if (!EXEC_LIKE_TOOLS.has(toolName) && !EXEC_LIKE_TOOLS.has(toolName.toLowerCase())) {
    return null;
  }
  for (const key of ["command", "cmd", "script"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(-maxChars);
}

async function sendAgentRetryPrompt(
  resolved: RiskApprovalResolved,
  params: Record<string, unknown> | null,
): Promise<void> {
  const req = resolved.request;
  const sessionKey = req?.sessionKey?.trim();
  if (!sessionKey || !req) {
    return;
  }
  const paramsText = params ? JSON.stringify(params) : req.paramsPreview;
  await callGatewayTool(
    "agent",
    { timeoutMs: 120_000 },
    {
      sessionKey,
      message: [
        `The operator approved Guard risk request ${resolved.id} (${resolved.decision}).`,
        "Retry the blocked tool call once now with the exact same parameters.",
        "Do not ask for approval again.",
        "",
        `Tool: ${req.toolName}`,
        `Parameters: ${paramsText}`,
      ].join("\n"),
      deliver: false,
      idempotencyKey: `risk-approval-retry:${resolved.id}`,
    },
    { expectFinal: true },
  );
}

async function injectRiskApprovalResultInChat(
  sessionKey: string,
  summary: string,
  approvalId: string,
): Promise<void> {
  try {
    await callGateway({
      method: "chat.inject",
      params: {
        sessionKey,
        label: "Guard risk approval result",
        message: `✅ Approved command finished.\n\n${summary}`,
      },
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "CClawd Guard",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      timeoutMs: 15_000,
    });
  } catch (err) {
    log.warn(`risk approval chat inject failed (${approvalId}): ${String(err)}`);
  }
}

function buildFollowupExecEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const shellPath = getShellPathFromLoginShell({
    env: process.env,
    timeoutMs: resolveShellEnvFallbackTimeoutMs(process.env),
  });
  applyShellPath(env, shellPath);
  return env;
}

async function runApprovedExecFollowup(
  resolved: RiskApprovalResolved,
  command: string,
): Promise<void> {
  const req = resolved.request!;
  const sessionKey = req.sessionKey!.trim();
  const workdir = process.cwd();

  let run: Awaited<ReturnType<typeof runExecProcess>> | null = null;
  try {
    run = await runExecProcess({
      command,
      workdir,
      env: buildFollowupExecEnv(),
      sandbox: undefined,
      containerWorkdir: null,
      usePty: false,
      warnings: [],
      maxOutput: DEFAULT_MAX_OUTPUT,
      pendingMaxOutput: DEFAULT_PENDING_MAX_OUTPUT,
      notifyOnExit: false,
      notifyOnExitEmptySuccess: false,
      scopeKey: undefined,
      sessionKey,
      timeoutSec: DEFAULT_EXEC_TIMEOUT_SEC,
    });
  } catch (err) {
    await sendExecApprovalFollowup({
      approvalId: resolved.id,
      sessionKey,
      turnSourceChannel: req.turnSourceChannel ?? undefined,
      turnSourceTo: req.turnSourceTo ?? undefined,
      turnSourceAccountId: req.turnSourceAccountId ?? undefined,
      turnSourceThreadId: req.turnSourceThreadId ?? undefined,
      resultText: `Exec denied after Guard risk approval (id=${resolved.id}, spawn-failed): ${command}\n${String(err)}`,
    });
    return;
  }

  const outcome = await run.promise;
  const output = normalizeNotifyOutput(tail(outcome.aggregated || "", DEFAULT_NOTIFY_TAIL_CHARS));
  const exitLabel = outcome.timedOut ? "timeout" : `code ${outcome.exitCode ?? "?"}`;
  const summary = output
    ? `Exec finished after Guard risk approval (id=${resolved.id}, session=${run.session.id}, ${exitLabel})\n${output}`
    : `Exec finished after Guard risk approval (id=${resolved.id}, session=${run.session.id}, ${exitLabel})`;

  await injectRiskApprovalResultInChat(sessionKey, summary, resolved.id);

  await sendExecApprovalFollowup({
    approvalId: resolved.id,
    sessionKey,
    turnSourceChannel: req.turnSourceChannel ?? undefined,
    turnSourceTo: req.turnSourceTo ?? undefined,
    turnSourceAccountId: req.turnSourceAccountId ?? undefined,
    turnSourceThreadId: req.turnSourceThreadId ?? undefined,
    resultText: summary,
  });
}

export async function runRiskApprovalFollowup(resolved: RiskApprovalResolved): Promise<void> {
  if (resolved.decision !== "allow-once" && resolved.decision !== "allow-always") {
    return;
  }
  const req = resolved.request;
  if (!req?.sessionKey?.trim()) {
    log.warn(`risk approval followup skipped: missing sessionKey (${resolved.id})`);
    return;
  }

  try {
    resolvedHook?.(resolved);
  } catch (err) {
    log.error(`risk approval resolved hook failed: ${String(err)}`);
  }

  const params =
    req.toolParams && typeof req.toolParams === "object"
      ? req.toolParams
      : parseRiskApprovalToolParams(req.toolName, req.paramsPreview);
  const command = params ? extractExecCommand(req.toolName, params) : null;

  if (command) {
    log.info(
      `risk approval followup: running approved exec for ${resolved.id} in ${path.basename(process.cwd())}`,
    );
    await runApprovedExecFollowup(resolved, command);
    return;
  }

  log.info(`risk approval followup: prompting agent retry for ${req.toolName} (${resolved.id})`);
  await sendAgentRetryPrompt(resolved, params);
}

export function scheduleRiskApprovalFollowup(resolved: RiskApprovalResolved): void {
  void runRiskApprovalFollowup(resolved).catch((err) => {
    log.error(`risk approval followup failed (${resolved.id}): ${String(err)}`);
  });
}
