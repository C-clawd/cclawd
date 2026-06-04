import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const RiskApprovalFindingSummarySchema = Type.Object(
  {
    riskLevel: Type.Optional(Type.String()),
    riskType: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()),
    ruleId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const RiskApprovalRequestPayloadSchema = Type.Object(
  {
    source: Type.Literal("cclawd-guard"),
    toolName: NonEmptyString,
    paramsPreview: NonEmptyString,
    paramsHash: NonEmptyString,
    riskLevel: NonEmptyString,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    explanation: NonEmptyString,
    ruleId: Type.Optional(Type.String()),
    anomalyTypes: Type.Optional(Type.Array(Type.String())),
    findings: Type.Optional(Type.Array(RiskApprovalFindingSummarySchema)),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    runId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    toolCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceChannel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceTo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceAccountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceThreadId: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    toolParams: Type.Optional(Type.Record(Type.String(), Type.Any())),
  },
  { additionalProperties: false },
);

export const RiskApprovalRequestParamsSchema = Type.Object(
  {
    id: Type.Optional(NonEmptyString),
    source: Type.Literal("cclawd-guard"),
    toolName: NonEmptyString,
    paramsPreview: NonEmptyString,
    paramsHash: NonEmptyString,
    riskLevel: NonEmptyString,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    explanation: NonEmptyString,
    ruleId: Type.Optional(Type.String()),
    anomalyTypes: Type.Optional(Type.Array(Type.String())),
    findings: Type.Optional(Type.Array(RiskApprovalFindingSummarySchema)),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    runId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    toolCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceChannel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceTo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceAccountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceThreadId: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
    toolParams: Type.Optional(Type.Record(Type.String(), Type.Any())),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    twoPhase: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const RiskApprovalResolveParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    decision: NonEmptyString,
  },
  { additionalProperties: false },
);

export const RiskApprovalWaitDecisionParamsSchema = Type.Object(
  {
    id: NonEmptyString,
  },
  { additionalProperties: false },
);

export const RiskApprovalGetDecisionParamsSchema = Type.Object(
  {
    id: NonEmptyString,
  },
  { additionalProperties: false },
);
