import { createHash, randomUUID } from "node:crypto";

export type RiskApprovalDecision = "allow-once" | "allow-always" | "deny";

export const DEFAULT_RISK_APPROVAL_TIMEOUT_MS = 120_000;

export const RISK_APPROVAL_ID_PREFIX = "risk-";

export type RiskApprovalFindingSummary = {
  riskLevel?: string;
  riskType?: string;
  reason?: string;
  ruleId?: string;
};

export type RiskApprovalRequestPayload = {
  source: "cclawd-guard";
  toolName: string;
  paramsPreview: string;
  paramsHash: string;
  riskLevel: string;
  confidence: number;
  explanation: string;
  ruleId?: string;
  anomalyTypes?: string[];
  findings?: RiskApprovalFindingSummary[];
  agentId?: string | null;
  sessionKey?: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  turnSourceChannel?: string | null;
  turnSourceTo?: string | null;
  turnSourceAccountId?: string | null;
  turnSourceThreadId?: string | number | null;
  /** Original tool params for post-approval auto-retry. */
  toolParams?: Record<string, unknown>;
};

export type RiskApprovalRequest = {
  id: string;
  request: RiskApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type RiskApprovalResolved = {
  id: string;
  decision: RiskApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
  request?: RiskApprovalRequestPayload;
};

export function createRiskApprovalId(): string {
  return `${RISK_APPROVAL_ID_PREFIX}${randomUUID()}`;
}

export function createRiskApprovalSlug(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return trimmed.slice(0, 12);
}

export function buildRiskParamsHash(toolName: string, params: Record<string, unknown>): string {
  const canonical = stableStringify({ toolName, params });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeys(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}

export function formatRiskParamsPreview(
  toolName: string,
  params: Record<string, unknown>,
  maxLen = 800,
): string {
  const raw = `${toolName} ${JSON.stringify(params)}`.trim();
  if (raw.length <= maxLen) {
    return raw;
  }
  return `${raw.slice(0, maxLen)}…`;
}

export function formatRiskApprovalNotifyMessage(
  request: RiskApprovalRequest,
  nowMs: number = Date.now(),
): string {
  const slug = createRiskApprovalSlug(request.id);
  const req = request.request;
  const lines: string[] = [
    "⚠️ CClawd Guard risk approval required",
    `ID: ${request.id}`,
    `Short: ${slug}`,
    `Tool: ${req.toolName}`,
    `Risk: ${req.riskLevel} (${Math.round(req.confidence * 100)}%)`,
    `Reason: ${req.explanation}`,
  ];
  if (req.ruleId) {
    lines.push(`Rule: ${req.ruleId}`);
  }
  if (req.anomalyTypes?.length) {
    lines.push(`Signals: ${req.anomalyTypes.join(", ")}`);
  }
  lines.push("Parameters:");
  lines.push(`\`\`\`\n${req.paramsPreview}\n\`\`\``);
  const expiresIn = Math.max(0, Math.round((request.expiresAtMs - nowMs) / 1000));
  lines.push(`Expires in: ${expiresIn}s`);
  lines.push("Reply with:");
  lines.push(`/approve ${slug} allow-once`);
  lines.push(`/approve ${slug} allow-always`);
  lines.push(`/approve ${slug} deny`);
  lines.push("If the short id is ambiguous, use the full id in /approve.");
  return lines.join("\n");
}
