import fs from "node:fs";
import path from "node:path";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { resolveSessionFilePath } from "../config/sessions.js";
import { stripEnvelopeFromMessage } from "../gateway/chat-sanitize.js";
import { appendInjectedAssistantMessageToTranscript } from "../gateway/server-methods/chat-transcript-inject.js";
import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { loadSessionEntry } from "../gateway/session-utils.js";
import { stripInlineDirectiveTagsFromMessageForDisplay } from "../utils/directive-tags.js";
import { formatRiskApprovalNotifyMessage, type RiskApprovalRequest } from "./risk-approvals.js";

export type RiskApprovalChatNotifyContext = {
  broadcast: GatewayBroadcastFn;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
};

function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
}): string | null {
  const { sessionId, storePath, sessionFile, agentId } = params;
  if (!storePath && !sessionFile) {
    return null;
  }
  try {
    const sessionsDir = storePath ? path.dirname(storePath) : undefined;
    return resolveSessionFilePath(
      sessionId,
      sessionFile ? { sessionFile } : undefined,
      sessionsDir || agentId ? { sessionsDir, agentId } : undefined,
    );
  } catch {
    return null;
  }
}

function ensureTranscriptFile(params: { transcriptPath: string; sessionId: string }): {
  ok: boolean;
  error?: string;
} {
  if (fs.existsSync(params.transcriptPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
    fs.writeFileSync(params.transcriptPath, "", "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Inject a visible approval prompt into WebChat/control-ui transcript (webchat is not outbound-deliverable). */
export function notifyRiskApprovalInChat(
  params: { sessionKey?: string | null; record: RiskApprovalRequest; nowMs?: number },
  context: RiskApprovalChatNotifyContext,
): boolean {
  const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (!sessionKey) {
    return false;
  }

  const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
  const sessionId = entry?.sessionId;
  if (!sessionId || !storePath) {
    return false;
  }

  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const transcriptPath = resolveTranscriptPath({
    sessionId,
    storePath,
    sessionFile: entry?.sessionFile,
    agentId,
  });
  if (!transcriptPath) {
    return false;
  }

  const ensured = ensureTranscriptFile({ transcriptPath, sessionId });
  if (!ensured.ok) {
    return false;
  }

  const message = formatRiskApprovalNotifyMessage(params.record, params.nowMs ?? Date.now());
  const appended = appendInjectedAssistantMessageToTranscript({
    transcriptPath,
    message,
    label: "Guard risk approval",
    idempotencyKey: `risk-approval:${params.record.id}`,
  });
  if (!appended.ok || !appended.messageId || !appended.message) {
    return false;
  }

  const chatPayload = {
    runId: `risk-approval-${appended.messageId}`,
    sessionKey,
    seq: 0,
    state: "final" as const,
    message: stripInlineDirectiveTagsFromMessageForDisplay(
      stripEnvelopeFromMessage(appended.message) as Record<string, unknown>,
    ),
  };
  context.broadcast("chat", chatPayload);
  context.nodeSendToSession(sessionKey, "chat", chatPayload);
  return true;
}
