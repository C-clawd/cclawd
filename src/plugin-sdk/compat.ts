// Legacy compat surface for external plugins that still depend on older
// broad plugin-sdk imports. Keep this file intentionally small.

const shouldWarnCompatImport =
  process.env.VITEST !== "true" &&
  process.env.NODE_ENV !== "test" &&
  process.env.OPENCLAW_SUPPRESS_PLUGIN_SDK_COMPAT_WARNING !== "1";

if (shouldWarnCompatImport) {
  process.emitWarning(
    "openclaw/plugin-sdk/compat is deprecated for new plugins. Migrate to focused openclaw/plugin-sdk/<subpath> imports. See https://docs.openclaw.ai/plugins/sdk-migration",
    {
      code: "OPENCLAW_PLUGIN_SDK_COMPAT_DEPRECATED",
      detail:
        "Bundled plugins must use scoped plugin-sdk subpaths. External plugins may keep compat temporarily while migrating. Migration guide: https://docs.openclaw.ai/plugins/sdk-migration",
    },
  );
}

// Core exports
export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "./account-id.js";
export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export { delegateCompactionToRuntime } from "../context-engine/delegate.js";
export type { DiagnosticEventPayload } from "../infra/diagnostic-events.js";
export { onDiagnosticEvent } from "../infra/diagnostic-events.js";
export { createAccountStatusSink } from "./channel-lifecycle.js";
export { createPluginRuntimeStore } from "./runtime-store.js";
export { KeyedAsyncQueue } from "./keyed-async-queue.js";

// Allow-from exports
export {
  formatAllowFromLowercase,
  formatNormalizedAllowFromEntries,
  isNormalizedSenderAllowed,
  mapAllowlistResolutionInputs,
} from "./allow-from.js";

// Channel config helpers
export {
  adaptScopedAccountAccessor,
  createHybridChannelConfigAdapter,
  createHybridChannelConfigBase,
  createScopedAccountConfigAccessors,
  createScopedChannelConfigAdapter,
  createScopedChannelConfigBase,
  createScopedDmSecurityResolver,
  createTopLevelChannelConfigAdapter,
  createTopLevelChannelConfigBase,
  formatTrimmedAllowFromEntries,
  mapAllowFromEntries,
  resolveOptionalConfigString,
} from "./channel-config-helpers.js";

// Channel reply pipeline
export { createChannelReplyPipeline } from "./channel-reply-pipeline.js";

// Reply prefix
export { createReplyPrefixContext } from "../channels/reply-prefix.js";

// Typing callbacks
export { createTypingCallbacks } from "../channels/typing.js";

// Channel pairing
export { createChannelPairingController } from "./channel-pairing.js";

// Status helpers
export {
  buildBaseChannelStatusSummary,
  buildProbeChannelStatusSummary,
  buildRuntimeAccountStatusSnapshot,
  createDefaultChannelRuntimeState,
} from "./status-helpers.js";

// Webhook ingress
export {
  applyBasicWebhookRequestGuards,
  createFixedWindowRateLimiter,
  createWebhookAnomalyTracker,
  WEBHOOK_ANOMALY_COUNTER_DEFAULTS,
  WEBHOOK_RATE_LIMIT_DEFAULTS,
} from "./webhook-ingress.js";

// Agent tools
export { createActionGate } from "../agents/tools/common.js";

// Channel logging
export { logTypingFailure } from "../channels/logging.js";

// Pairing message
export { PAIRING_APPROVED_MESSAGE } from "../channels/plugins/pairing-message.js";

// Reply prefix
export { createReplyPrefixOptions } from "../channels/reply-prefix.js";

// Secret input
export {
  buildSecretInputSchema,
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
  normalizeSecretInputString,
} from "./secret-input.js";

// Dedupe
export { createDedupeCache } from "../infra/dedupe.js";

// HTTP body
export { installRequestBodyLimitGuard, readJsonBodyWithLimit } from "../infra/http-body.js";

// Fetch guard
export { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";

// Outbound identity
export { resolveAgentOutboundIdentity } from "../infra/outbound/identity.js";

// Terminal links
export { formatDocsLink } from "../terminal/links.js";

// Group access
export { evaluateSenderGroupAccessForPolicy } from "./group-access.js";

// Command auth
export {
  resolveDirectDmAuthorizationOutcome,
  resolveSenderCommandAuthorization,
  resolveSenderCommandAuthorizationWithRuntime,
} from "./command-auth.js";

// Command gating
export { resolveControlCommandGate } from "../channels/command-gating.js";

// JSON store
export { readJsonFileWithFallback, writeJsonFileAtomically } from "./json-store.js";

// Temp path
export { withTempDownloadPath } from "./temp-path.js";

// Agent media payload
export { buildAgentMediaPayload } from "./agent-media-payload.js";

// Persistent dedupe
export { createPersistentDedupe } from "./persistent-dedupe.js";

// Star exports
export * from "./channel-config-schema.js";
export * from "./channel-policy.js";
export * from "./reply-history.js";
export * from "./directory-runtime.js";

// Bluebubbles
export {
  resolveBlueBubblesGroupRequireMention,
  resolveBlueBubblesGroupToolPolicy,
} from "../../extensions/bluebubbles/runtime-api.js";
export { collectBlueBubblesStatusIssues } from "../channels/plugins/status-issues/bluebubbles.js";
