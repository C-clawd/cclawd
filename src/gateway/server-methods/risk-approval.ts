import type { RiskApprovalForwarder } from "../../infra/risk-approval-forwarder.js";
import { notifyRiskApprovalInChat } from "../../infra/risk-approval-chat-notify.js";
import { scheduleRiskApprovalFollowup } from "../../infra/risk-approval-followup.js";
import {
  DEFAULT_RISK_APPROVAL_TIMEOUT_MS,
  type RiskApprovalDecision,
  type RiskApprovalRequestPayload,
} from "../../infra/risk-approvals.js";
import type { RiskApprovalManager } from "../risk-approval-manager.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateRiskApprovalRequestParams,
  validateRiskApprovalResolveParams,
  validateRiskApprovalGetDecisionParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export function createRiskApprovalHandlers(
  manager: RiskApprovalManager,
  opts?: { forwarder?: RiskApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "risk.approval.request": async ({ params, respond, context, client }) => {
      if (!validateRiskApprovalRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid risk.approval.request params: ${formatValidationErrors(
              validateRiskApprovalRequestParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as {
        id?: string;
        source: "cclawd-guard";
        toolName: string;
        paramsPreview: string;
        paramsHash: string;
        riskLevel: string;
        confidence: number;
        explanation: string;
        ruleId?: string;
        anomalyTypes?: string[];
        findings?: RiskApprovalRequestPayload["findings"];
        agentId?: string | null;
        sessionKey?: string | null;
        runId?: string | null;
        toolCallId?: string | null;
        turnSourceChannel?: string | null;
        turnSourceTo?: string | null;
        turnSourceAccountId?: string | null;
        turnSourceThreadId?: string | number | null;
        timeoutMs?: number;
        twoPhase?: boolean;
      };
      const twoPhase = p.twoPhase === true;
      const timeoutMs =
        typeof p.timeoutMs === "number" ? p.timeoutMs : DEFAULT_RISK_APPROVAL_TIMEOUT_MS;
      const explicitId = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : null;
      if (explicitId && manager.getSnapshot(explicitId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "approval id already pending"),
        );
        return;
      }
      const request: RiskApprovalRequestPayload = {
        source: "cclawd-guard",
        toolName: p.toolName,
        paramsPreview: p.paramsPreview,
        paramsHash: p.paramsHash,
        riskLevel: p.riskLevel,
        confidence: p.confidence,
        explanation: p.explanation,
        ruleId: p.ruleId,
        anomalyTypes: p.anomalyTypes,
        findings: p.findings,
        agentId: p.agentId ?? null,
        sessionKey: p.sessionKey ?? null,
        runId: p.runId ?? null,
        toolCallId: p.toolCallId ?? null,
        turnSourceChannel:
          typeof p.turnSourceChannel === "string" ? p.turnSourceChannel.trim() || null : null,
        turnSourceTo: typeof p.turnSourceTo === "string" ? p.turnSourceTo.trim() || null : null,
        turnSourceAccountId:
          typeof p.turnSourceAccountId === "string" ? p.turnSourceAccountId.trim() || null : null,
        turnSourceThreadId: p.turnSourceThreadId ?? null,
        toolParams:
          p.toolParams && typeof p.toolParams === "object" && !Array.isArray(p.toolParams)
            ? (p.toolParams as Record<string, unknown>)
            : undefined,
      };
      const record = manager.create(request, timeoutMs, explicitId);
      record.requestedByConnId = client?.connId ?? null;
      record.requestedByDeviceId = client?.connect?.device?.id ?? null;
      record.requestedByClientId = client?.connect?.client?.id ?? null;

      let decisionPromise: Promise<RiskApprovalDecision | null>;
      try {
        decisionPromise = manager.register(record, timeoutMs);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `registration failed: ${String(err)}`),
        );
        return;
      }
      context.broadcast(
        "risk.approval.requested",
        {
          id: record.id,
          request: record.request,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const chatNotified = notifyRiskApprovalInChat(
        { sessionKey: record.request.sessionKey, record },
        {
          broadcast: context.broadcast,
          nodeSendToSession: context.nodeSendToSession,
        },
      );
      const hasApprovalClients = context.hasExecApprovalClients?.() ?? false;
      let forwarded = false;
      if (opts?.forwarder) {
        try {
          forwarded = await opts.forwarder.handleRequested({
            id: record.id,
            request: record.request,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          });
        } catch (err) {
          context.logGateway?.error?.(`risk approvals: forward request failed: ${String(err)}`);
        }
      }

      if (!hasApprovalClients && !forwarded && !chatNotified) {
        manager.expire(record.id, "no-approval-route");
        respond(
          true,
          {
            id: record.id,
            decision: null,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          },
          undefined,
        );
        return;
      }

      if (twoPhase) {
        respond(
          true,
          {
            status: "accepted",
            id: record.id,
            createdAtMs: record.createdAtMs,
            expiresAtMs: record.expiresAtMs,
          },
          undefined,
        );
      }

      const decision = await decisionPromise;
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
    "risk.approval.waitDecision": async ({ params, respond }) => {
      const p = params as { id?: string };
      const id = typeof p.id === "string" ? p.id.trim() : "";
      if (!id) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
        return;
      }
      const decisionPromise = manager.awaitDecision(id);
      if (!decisionPromise) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "approval expired or not found"),
        );
        return;
      }
      const snapshot = manager.getSnapshot(id);
      const decision = await decisionPromise;
      respond(
        true,
        {
          id,
          decision,
          createdAtMs: snapshot?.createdAtMs,
          expiresAtMs: snapshot?.expiresAtMs,
        },
        undefined,
      );
    },
    "risk.approval.getDecision": async ({ params, respond }) => {
      if (!validateRiskApprovalGetDecisionParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid risk.approval.getDecision params: ${formatValidationErrors(
              validateRiskApprovalGetDecisionParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string };
      const lookup = manager.lookupPendingId(p.id);
      const approvalId = lookup.kind === "exact" || lookup.kind === "prefix" ? lookup.id : p.id;
      const status = manager.getDecision(approvalId);
      if (status === "missing") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id"),
        );
        return;
      }
      const snapshot = manager.getSnapshot(approvalId);
      respond(
        true,
        {
          id: approvalId,
          status: status === "pending" ? "pending" : "resolved",
          decision: status === "pending" ? null : status,
          createdAtMs: snapshot?.createdAtMs,
          expiresAtMs: snapshot?.expiresAtMs,
        },
        undefined,
      );
    },
    "risk.approval.resolve": async ({ params, respond, client, context }) => {
      if (!validateRiskApprovalResolveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid risk.approval.resolve params: ${formatValidationErrors(
              validateRiskApprovalResolveParams.errors,
            )}`,
          ),
        );
        return;
      }
      const p = params as { id: string; decision: string };
      const decision = p.decision as RiskApprovalDecision;
      if (decision !== "allow-once" && decision !== "allow-always" && decision !== "deny") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
        return;
      }
      const resolvedId = manager.lookupPendingId(p.id);
      if (resolvedId.kind === "none") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id"),
        );
        return;
      }
      if (resolvedId.kind === "ambiguous") {
        const candidates = resolvedId.ids.slice(0, 3).join(", ");
        const remainder = resolvedId.ids.length > 3 ? ` (+${resolvedId.ids.length - 3} more)` : "";
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `ambiguous approval id prefix; matches: ${candidates}${remainder}. Use the full id.`,
          ),
        );
        return;
      }
      const approvalId = resolvedId.id;
      const snapshot = manager.getSnapshot(approvalId);
      const resolvedBy = client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const ok = manager.resolve(approvalId, decision, resolvedBy ?? null);
      if (!ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id"),
        );
        return;
      }
      context.broadcast(
        "risk.approval.resolved",
        { id: approvalId, decision, resolvedBy, ts: Date.now(), request: snapshot?.request },
        { dropIfSlow: true },
      );
      void opts?.forwarder
        ?.handleResolved({
          id: approvalId,
          decision,
          resolvedBy,
          ts: Date.now(),
          request: snapshot?.request,
        })
        .catch((err) => {
          context.logGateway?.error?.(`risk approvals: forward resolve failed: ${String(err)}`);
        });
      if (decision === "allow-once" || decision === "allow-always") {
        scheduleRiskApprovalFollowup({
          id: approvalId,
          decision,
          resolvedBy,
          ts: Date.now(),
          request: snapshot?.request,
        });
      }
      respond(true, { ok: true }, undefined);
    },
  };
}
