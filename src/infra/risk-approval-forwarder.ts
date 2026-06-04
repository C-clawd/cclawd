import type { ReplyPayload } from "../auto-reply/types.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import type { RiskApprovalForwardingConfig } from "../config/types.approvals.js";
import type { ExecApprovalForwardTarget } from "../config/types.approvals.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { compileConfigRegex } from "../security/config-regex.js";
import { testRegexWithBoundedInput } from "../security/safe-regex.js";
import { resolveExecApprovalSessionTarget } from "./exec-approval-session-target.js";
import type { ExecApprovalRequest } from "./exec-approvals.js";
import {
  formatRiskApprovalNotifyMessage,
  type RiskApprovalDecision,
  type RiskApprovalRequest,
  type RiskApprovalResolved,
} from "./risk-approvals.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";

const log = createSubsystemLogger("gateway/risk-approvals");

type ForwardTarget = ExecApprovalForwardTarget & { source: "session" | "target" };

type PendingApproval = {
  request: RiskApprovalRequest;
  targets: ForwardTarget[];
  timeoutId: NodeJS.Timeout | null;
};

export type RiskApprovalForwarder = {
  handleRequested: (request: RiskApprovalRequest) => Promise<boolean>;
  handleResolved: (resolved: RiskApprovalResolved) => Promise<void>;
  stop: () => void;
};

export type RiskApprovalForwarderDeps = {
  getConfig?: () => OpenClawConfig;
  deliver?: typeof deliverOutboundPayloads;
  nowMs?: () => number;
};

const DEFAULT_MODE = "session" as const;

function normalizeMode(mode?: RiskApprovalForwardingConfig["mode"]) {
  return mode ?? DEFAULT_MODE;
}

function matchSessionFilter(sessionKey: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (sessionKey.includes(pattern)) {
      return true;
    }
    const compiled = compileConfigRegex(pattern);
    return compiled?.regex ? testRegexWithBoundedInput(compiled.regex, sessionKey) : false;
  });
}

function shouldForward(params: {
  config?: RiskApprovalForwardingConfig;
  request: RiskApprovalRequest;
}): boolean {
  const config = params.config;
  if (!config?.enabled) {
    return false;
  }
  if (config.agentFilter?.length) {
    const agentId =
      params.request.request.agentId ??
      parseAgentSessionKey(params.request.request.sessionKey ?? "")?.agentId;
    if (!agentId || !config.agentFilter.includes(agentId)) {
      return false;
    }
  }
  if (config.sessionFilter?.length) {
    const sessionKey = params.request.request.sessionKey;
    if (!sessionKey || !matchSessionFilter(sessionKey, config.sessionFilter)) {
      return false;
    }
  }
  return true;
}

function buildTargetKey(target: ExecApprovalForwardTarget): string {
  const channel = normalizeMessageChannel(target.channel) ?? target.channel;
  const accountId = target.accountId ?? "";
  const threadId = target.threadId ?? "";
  return [channel, target.to, accountId, threadId].join(":");
}

function asExecRequestForSessionTarget(request: RiskApprovalRequest): ExecApprovalRequest {
  return {
    id: request.id,
    createdAtMs: request.createdAtMs,
    expiresAtMs: request.expiresAtMs,
    request: {
      command: request.request.paramsPreview,
      sessionKey: request.request.sessionKey,
      agentId: request.request.agentId,
      turnSourceChannel: request.request.turnSourceChannel,
      turnSourceTo: request.request.turnSourceTo,
      turnSourceAccountId: request.request.turnSourceAccountId,
      turnSourceThreadId: request.request.turnSourceThreadId,
    },
  };
}

function resolveSessionTarget(params: {
  cfg: OpenClawConfig;
  request: RiskApprovalRequest;
}): ExecApprovalForwardTarget | null {
  const execShape = asExecRequestForSessionTarget(params.request);
  const resolved = resolveExecApprovalSessionTarget({
    cfg: params.cfg,
    request: execShape,
    turnSourceChannel: params.request.request.turnSourceChannel,
    turnSourceTo: params.request.request.turnSourceTo?.trim() || undefined,
    turnSourceAccountId: params.request.request.turnSourceAccountId?.trim() || undefined,
    turnSourceThreadId: params.request.request.turnSourceThreadId ?? undefined,
  });
  if (!resolved?.channel || !resolved.to) {
    return null;
  }
  const channel = resolved.channel;
  if (!isDeliverableMessageChannel(channel)) {
    return null;
  }
  return {
    channel,
    to: resolved.to,
    accountId: resolved.accountId,
    threadId: resolved.threadId,
  };
}

function resolveForwardTargets(params: {
  cfg: OpenClawConfig;
  config?: RiskApprovalForwardingConfig;
  request: RiskApprovalRequest;
}): ForwardTarget[] {
  const mode = normalizeMode(params.config?.mode);
  const targets: ForwardTarget[] = [];
  const seen = new Set<string>();

  if (mode === "session" || mode === "both") {
    const sessionTarget = resolveSessionTarget({ cfg: params.cfg, request: params.request });
    if (sessionTarget) {
      const key = buildTargetKey(sessionTarget);
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ ...sessionTarget, source: "session" });
      }
    }
  }

  if (mode === "targets" || mode === "both") {
    for (const target of params.config?.targets ?? []) {
      const key = buildTargetKey(target);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      targets.push({ ...target, source: "target" });
    }
  }

  return targets;
}

function buildRequestMessage(request: RiskApprovalRequest, nowMs: number): string {
  return formatRiskApprovalNotifyMessage(request, nowMs);
}

function decisionLabel(decision: RiskApprovalDecision): string {
  if (decision === "allow-once") {
    return "allowed once";
  }
  if (decision === "allow-always") {
    return "allowed always";
  }
  return "denied";
}

function buildResolvedMessage(resolved: RiskApprovalResolved): string {
  const base = `✅ Guard risk approval ${decisionLabel(resolved.decision)}.`;
  const by = resolved.resolvedBy ? ` Resolved by ${resolved.resolvedBy}.` : "";
  return `${base}${by} ID: ${resolved.id}`;
}

function buildExpiredMessage(request: RiskApprovalRequest): string {
  return `⏱️ Guard risk approval expired. ID: ${request.id}`;
}

async function deliverToTargets(params: {
  cfg: OpenClawConfig;
  targets: ForwardTarget[];
  buildPayload: (target: ForwardTarget) => ReplyPayload;
  deliver: typeof deliverOutboundPayloads;
  shouldSend?: () => boolean;
}) {
  const deliveries = params.targets.map(async (target) => {
    if (params.shouldSend && !params.shouldSend()) {
      return;
    }
    const channel = normalizeMessageChannel(target.channel) ?? target.channel;
    if (!isDeliverableMessageChannel(channel)) {
      return;
    }
    try {
      await params.deliver({
        cfg: params.cfg,
        channel,
        to: target.to,
        accountId: target.accountId,
        threadId: target.threadId,
        payloads: [params.buildPayload(target)],
      });
    } catch (err) {
      log.error(`risk approvals: failed to deliver to ${channel}:${target.to}: ${String(err)}`);
    }
  });
  await Promise.allSettled(deliveries);
}

export function createRiskApprovalForwarder(
  deps: RiskApprovalForwarderDeps = {},
): RiskApprovalForwarder {
  const getConfig = deps.getConfig ?? loadConfig;
  const deliver = deps.deliver ?? deliverOutboundPayloads;
  const nowMs = deps.nowMs ?? Date.now;
  const pending = new Map<string, PendingApproval>();

  const handleRequested = async (request: RiskApprovalRequest): Promise<boolean> => {
    const cfg = getConfig();
    const config = cfg.approvals?.risk;
    const filteredTargets = shouldForward({ config, request })
      ? resolveForwardTargets({ cfg, config, request })
      : [];

    if (filteredTargets.length === 0) {
      return false;
    }

    const expiresInMs = Math.max(0, request.expiresAtMs - nowMs());
    const timeoutId = setTimeout(() => {
      void (async () => {
        const entry = pending.get(request.id);
        if (!entry) {
          return;
        }
        pending.delete(request.id);
        await deliverToTargets({
          cfg,
          targets: entry.targets,
          buildPayload: () => ({ text: buildExpiredMessage(request) }),
          deliver,
        });
      })();
    }, expiresInMs);
    timeoutId.unref?.();

    const pendingEntry: PendingApproval = { request, targets: filteredTargets, timeoutId };
    pending.set(request.id, pendingEntry);

    void deliverToTargets({
      cfg,
      targets: filteredTargets,
      buildPayload: () => ({ text: buildRequestMessage(request, nowMs()) }),
      deliver,
      shouldSend: () => pending.get(request.id) === pendingEntry,
    }).catch((err) => {
      log.error(`risk approvals: failed to deliver request ${request.id}: ${String(err)}`);
    });

    return true;
  };

  const handleResolved = async (resolved: RiskApprovalResolved) => {
    const entry = pending.get(resolved.id);
    if (!entry) {
      return;
    }
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    pending.delete(resolved.id);
    const cfg = getConfig();
    await deliverToTargets({
      cfg,
      targets: entry.targets,
      buildPayload: () => ({ text: buildResolvedMessage(resolved) }),
      deliver,
    });
  };

  const stop = () => {
    for (const entry of pending.values()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }
    pending.clear();
  };

  return { handleRequested, handleResolved, stop };
}
