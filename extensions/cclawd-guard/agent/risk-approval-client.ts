import { callGateway } from "../../../src/gateway/call.js";
import {
  createRiskApprovalSlug,
  DEFAULT_RISK_APPROVAL_TIMEOUT_MS,
  type RiskApprovalDecision,
  type RiskApprovalRequestPayload,
} from "../../../src/infra/risk-approvals.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../../src/utils/message-channel.js";

const REQUEST_TIMEOUT_BUFFER_MS = 5_000;

export type RequestRiskApprovalParams = Omit<
  RiskApprovalRequestPayload,
  "source" | "paramsPreview" | "paramsHash"
> & {
  paramsPreview: string;
  paramsHash: string;
  toolParams?: Record<string, unknown>;
  timeoutMs?: number;
};

export type RiskApprovalRegistration = {
  id: string;
  slug: string;
  expiresAtMs: number;
};

export async function registerRiskApprovalRequest(
  params: RequestRiskApprovalParams,
): Promise<RiskApprovalRegistration | null> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_RISK_APPROVAL_TIMEOUT_MS;
  const registration = await callGateway<{
    id?: string;
    expiresAtMs?: number;
    status?: string;
  }>({
    method: "risk.approval.request",
    params: {
      source: "cclawd-guard" as const,
      toolName: params.toolName,
      paramsPreview: params.paramsPreview,
      paramsHash: params.paramsHash,
      riskLevel: params.riskLevel,
      confidence: params.confidence,
      explanation: params.explanation,
      ruleId: params.ruleId,
      anomalyTypes: params.anomalyTypes,
      findings: params.findings,
      agentId: params.agentId ?? null,
      sessionKey: params.sessionKey ?? null,
      runId: params.runId ?? null,
      toolCallId: params.toolCallId ?? null,
      turnSourceChannel: params.turnSourceChannel ?? null,
      turnSourceTo: params.turnSourceTo ?? null,
      turnSourceAccountId: params.turnSourceAccountId ?? null,
      turnSourceThreadId: params.turnSourceThreadId ?? null,
      toolParams: params.toolParams,
      timeoutMs,
      twoPhase: true,
    },
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    clientDisplayName: "CClawd Guard",
    mode: GATEWAY_CLIENT_MODES.BACKEND,
    expectFinal: false,
    timeoutMs: 15_000,
  });

  const id = typeof registration?.id === "string" ? registration.id.trim() : "";
  if (!id) {
    return null;
  }
  const expiresAtMs =
    typeof registration?.expiresAtMs === "number" && Number.isFinite(registration.expiresAtMs)
      ? registration.expiresAtMs
      : Date.now() + timeoutMs;
  return { id, slug: createRiskApprovalSlug(id), expiresAtMs };
}

export async function getRiskApprovalDecision(
  approvalId: string,
): Promise<RiskApprovalDecision | null | "pending"> {
  const result = await callGateway<{
    status?: string;
    decision?: RiskApprovalDecision | null;
  }>({
    method: "risk.approval.getDecision",
    params: { id: approvalId },
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    clientDisplayName: "CClawd Guard",
    mode: GATEWAY_CLIENT_MODES.BACKEND,
    timeoutMs: 10_000,
  });
  if (result?.status === "pending") {
    return "pending";
  }
  const decision = result?.decision;
  if (decision === "allow-once" || decision === "allow-always" || decision === "deny") {
    return decision;
  }
  return null;
}

/** @deprecated Use registerRiskApprovalRequest + getRiskApprovalDecision for approve policy. */
export async function requestRiskApprovalDecision(
  params: RequestRiskApprovalParams,
): Promise<RiskApprovalDecision | null> {
  const registration = await registerRiskApprovalRequest(params);
  if (!registration) {
    return null;
  }
  const timeoutMs = params.timeoutMs ?? DEFAULT_RISK_APPROVAL_TIMEOUT_MS;
  try {
    const waited = await callGateway<{ decision?: RiskApprovalDecision | null }>({
      method: "risk.approval.waitDecision",
      params: { id: registration.id },
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: "CClawd Guard",
      mode: GATEWAY_CLIENT_MODES.BACKEND,
      timeoutMs: timeoutMs + REQUEST_TIMEOUT_BUFFER_MS,
    });
    const decision = waited?.decision;
    if (decision === "allow-once" || decision === "allow-always" || decision === "deny") {
      return decision;
    }
    return null;
  } catch (err) {
    const message = String(err).toLowerCase();
    if (message.includes("approval expired or not found")) {
      return null;
    }
    throw err;
  }
}
