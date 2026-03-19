import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { authManager } from "./src/auth-manager.js";
import { config } from "./src/config.js";
import { dabbyClient } from "./src/dabby-client.js";
import { NotificationService } from "./src/notification-service.js";
import { qrCodeAuthProvider } from "./src/providers/qr-code.js";
import { setNotifyCallback } from "./src/server.js";
import type { AuthSession } from "./src/types.js";

const notificationService = NotificationService.getInstance();
const pendingAuthUsers = new Set<string>();

function isWebchatChannel(channel: string | undefined): boolean {
  if (!channel) {
    return false;
  }
  const normalized = channel.trim().toLowerCase();
  return normalized === "webchat" || normalized === "web";
}

function isPeerKindToken(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "direct" || normalized === "group" || normalized === "dm";
}

function parseSessionContextFromKey(sessionKey: string | undefined): {
  channel?: string;
  accountId?: string;
  to?: string;
} {
  const parts = String(sessionKey || "")
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return {};
  }

  const channel = parts[2];
  let accountId = parts[3];
  const to = parts[parts.length - 1];

  // In common session keys, index 3 is peer kind (direct/group/dm), not account id.
  if (isPeerKindToken(accountId)) {
    accountId = undefined;
  }

  return {
    channel: channel || undefined,
    accountId: accountId || undefined,
    to: to || undefined,
  };
}

function addPendingAuthCandidates(...ids: Array<string | undefined>): void {
  for (const id of expandAuthIdCandidates(ids)) {
    pendingAuthUsers.add(id);
  }
}

function findPendingAuthCandidate(eventTo: string, conversationId?: string): string | undefined {
  for (const candidate of expandAuthIdCandidates([eventTo, conversationId])) {
    if (pendingAuthUsers.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeAuthId(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const lower = raw.toLowerCase();
  if (lower.startsWith("agent:main:")) {
    return raw.slice("agent:main:".length);
  }
  if (lower.startsWith("webchat:")) {
    return raw.slice("webchat:".length);
  }
  if (lower.startsWith("web:")) {
    return raw.slice("web:".length);
  }
  return raw;
}

function expandAuthIdCandidates(values: Array<string | undefined>): string[] {
  const result = new Set<string>();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      continue;
    }
    result.add(raw);
    const normalized = normalizeAuthId(raw);
    if (normalized) {
      result.add(normalized);
      result.add(`agent:main:${normalized}`);
      result.add(`webchat:${normalized}`);
      result.add(`web:${normalized}`);
    }
  }
  return Array.from(result);
}

function authIdEquals(a: string | undefined, b: string | undefined): boolean {
  const aa = String(a ?? "").trim();
  const bb = String(b ?? "").trim();
  if (!aa || !bb) {
    return false;
  }
  return aa === bb || normalizeAuthId(aa) === normalizeAuthId(bb);
}

function resolvePendingAuthSession(candidateIds: string[]): {
  matchedId: string;
  session: AuthSession;
} | null {
  const uniqueCandidates = expandAuthIdCandidates(candidateIds);

  for (const id of uniqueCandidates) {
    const hasPendingCandidate = Array.from(pendingAuthUsers).some((pending) => authIdEquals(pending, id));
    if (!hasPendingCandidate) {
      continue;
    }
    const session =
      authManager.getLatestSessionByUserId(id) ||
      authManager.getLatestSessionByUserId(normalizeAuthId(id));
    if (session?.metadata && typeof (session.metadata as Record<string, unknown>).qrCodeUrl === "string") {
      return { matchedId: id, session };
    }
  }

  let latest: { matchedId: string; session: AuthSession } | null = null;
  for (const sessionId of authManager.getSessionIds()) {
    const session = authManager.getSession(sessionId);
    if (!session?.metadata) {
      continue;
    }
    const metadata = session.metadata as Record<string, unknown>;
    if (typeof metadata.qrCodeUrl !== "string") {
      continue;
    }
    const matches = uniqueCandidates.some((candidate) => {
      return (
        authIdEquals(candidate, session.userId) ||
        authIdEquals(candidate, String(session.originalContext.sessionKey ?? "")) ||
        authIdEquals(candidate, String(session.originalContext.to ?? ""))
      );
    });
    if (!matches) {
      continue;
    }
    if (!latest || session.timestamp > latest.session.timestamp) {
      latest = {
        matchedId:
          uniqueCandidates.find((candidate) => candidate === session.userId) || session.userId,
        session,
      };
    }
  }

  return latest;
}

function resolveGlobalPendingFirstMessageSession(): AuthSession | null {
  let latestPending: AuthSession | null = null;

  for (const sessionId of authManager.getSessionIds()) {
    const session = authManager.getSession(sessionId);
    if (!session?.metadata) {
      continue;
    }

    const metadata = session.metadata as Record<string, unknown>;
    if (metadata.triggerType !== "first_message") {
      continue;
    }
    if (typeof metadata.qrCodeUrl !== "string" || !metadata.qrCodeUrl.trim()) {
      continue;
    }
    if (authManager.isUserVerifiedForFirstMessage(session.userId)) {
      continue;
    }

    if (!latestPending || session.timestamp > latestPending.timestamp) {
      latestPending = session;
    }
  }

  return latestPending;
}

function buildFirstMessageChallengeText(metadata: Record<string, unknown>): string {
  const qrCodeUrl = typeof metadata.qrCodeUrl === "string" ? metadata.qrCodeUrl : "";
  const isReauth = metadata.isReauth === true;
  if (isReauth) {
    return `Re-auth required.\n\nPlease complete QR verification:\n${qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.`;
  }
  return `First message requires verification.\n\nPlease complete QR verification:\n${qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.`;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function isAnyFirstMessageAliasVerified(userIds: string[]): string | undefined {
  for (const userId of userIds) {
    if (authManager.isUserVerifiedForFirstMessage(userId)) {
      return userId;
    }
  }
  return undefined;
}

function consumeNotificationByAliases(userIds: string[]): {
  triggerType: "first_message" | "sensitive_operation";
  isReauth: boolean;
} | null {
  for (const userId of userIds) {
    const notification = authManager.checkAndConsumeNotification(userId);
    if (notification) {
      return notification;
    }
  }
  return null;
}

function resolveInboundAuthUserId(params: {
  channelId?: string;
  from?: string;
  senderId?: string;
  conversationId?: string;
  metadataTo?: string;
  metadataOriginatingTo?: string;
}): string {
  const candidates = [
    params.from,
    params.senderId,
    params.conversationId,
    params.metadataOriginatingTo,
    params.metadataTo,
  ];
  const firstNonEmpty = candidates
    .map((value) => String(value ?? "").trim())
    .find((value) => value.length > 0);

  if (isWebchatChannel(params.channelId)) {
    return firstNonEmpty || "unknown";
  }
  return firstNonEmpty || "unknown";
}

async function sendAuthMessage(
  channel: string | undefined,
  accountId: string | undefined,
  to: string,
  message: string,
  userId: string,
  overrideSessionKey?: string,
): Promise<void> {
  const session: AuthSession = {
    userId,
    sessionId: "notification",
    authMethod: "qr-code",
    timestamp: Date.now(),
    originalContext: {
      sessionKey: overrideSessionKey || `${channel || "web"}:${accountId || ""}:${userId}`,
      senderId: userId,
      commandBody: "",
      channel: channel || "web",
      accountId: accountId || "",
      to,
      toolName: "notification",
      toolParams: {},
      timestamp: Date.now(),
      triggerType: "sensitive_operation",
    },
  };

  await notificationService.sendAuthNotification(session, message);
}

export default function register(api: OpenClawPluginApi) {
  console.log("[mfa-auth] Plugin registration started");
  authManager.registerProvider(qrCodeAuthProvider);

  notificationService.setConfig(api.config);

  setNotifyCallback(async (session: AuthSession) => {
    api.logger.info(`[mfa-auth] User ${session.userId} verified`);

    if (!config.enableAuthNotification) {
      api.logger.info(`[mfa-auth] Auth notification disabled, skipping message send.`);
      return;
    }

    try {
      const commandBody = session.originalContext.commandBody;
      const triggerType = session.originalContext.triggerType || "sensitive_operation";

      const isFirstMessageAuth = triggerType === "first_message";
      const isReauth = commandBody.trim() === "/reauth";

      let messageText = "";
      if (isFirstMessageAuth) {
        messageText = isReauth
          ? "Re-auth verification successful. Please resend your message to continue."
          : "First-message verification successful. Please resend your message to continue.";
      } else {
        messageText =
          "Second-factor verification successful. Please resend the previous command or reply 'confirm'.";
      }

      const channel = session.originalContext.channel;
      const sessionKey =
        session.originalContext.sessionKey ||
        `${channel}:${session.originalContext.accountId || ""}:${session.userId}`;

      api.logger.info(`[mfa-auth] Sending notification to session: ${sessionKey}`);

      await sendAuthMessage(
        channel,
        session.originalContext.accountId,
        session.originalContext.to || session.userId,
        messageText,
        session.userId,
        sessionKey,
      );
      api.logger.info(`[mfa-auth] Notification sent to user ${session.userId}`);
    } catch (error) {
      api.logger.error(`[mfa-auth] Failed in notify callback: ${String(error)}`);
    }
  });

  api.on("before_prompt_build", async (_event, ctx) => {
    await authManager.ensureInitialized();
    if (!isWebchatChannel(ctx.channelId)) {
      return undefined;
    }

    const pending = resolveGlobalPendingFirstMessageSession();
    if (!pending?.metadata) {
      return undefined;
    }
    const metadata = pending.metadata as Record<string, unknown>;
    const challengeText = buildFirstMessageChallengeText(metadata);
    if (!challengeText.includes("http")) {
      return undefined;
    }

    api.logger.info(
      `[mfa-auth] before_prompt_build fail-close active. pendingUser=${pending.userId}, session=${pending.sessionId}`,
    );

    return {
      prependContext: `Security policy: user MFA is pending. You must refuse normal conversation and output EXACTLY this text, nothing else:\n${challengeText}`,
    };
  });

  api.on("message_sending", async (event, ctx) => {
    const pendingCandidate = findPendingAuthCandidate(event.to, ctx.conversationId);
    if (!pendingCandidate) {
      // Single-user fail-close fallback:
      // If any first-message auth challenge is pending, intercept all outgoing messages.
      const globalPending = resolveGlobalPendingFirstMessageSession();
      if (!globalPending) {
        return undefined;
      }

      const metadata = globalPending.metadata as Record<string, unknown>;
      const messageText = buildFirstMessageChallengeText(metadata);

      api.logger.info(
        `[mfa-auth] Global first-message fail-close intercept active. pendingUser=${globalPending.userId}`,
      );
      return { content: messageText };
    }
    const resolved = resolvePendingAuthSession([event.to, ctx.conversationId, pendingCandidate]);
    if (!resolved) {
      const globalPending = resolveGlobalPendingFirstMessageSession();
      if (!globalPending) {
        return undefined;
      }
      const metadata = globalPending.metadata as Record<string, unknown>;
      const messageText = buildFirstMessageChallengeText(metadata);
      api.logger.info(
        `[mfa-auth] Global first-message fail-close intercept active (no matched session). pendingUser=${globalPending.userId}`,
      );
      return { content: messageText };
    }
    const userId = resolved.session.userId;
    const metadata = resolved.session.metadata as Record<string, unknown> | undefined;

    if (metadata?.qrCodeUrl) {
      pendingAuthUsers.delete(resolved.matchedId);
      pendingAuthUsers.delete(userId);

      let messageText = "";
      if (metadata.triggerType === "first_message") {
        const isReauth = metadata.isReauth === true;
        messageText = isReauth
          ? `Re-auth required.\n\nPlease complete QR verification:\n${metadata.qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.`
          : `First message requires verification.\n\nPlease complete QR verification:\n${metadata.qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.`;
      } else if (metadata.triggerType === "sensitive_operation") {
        messageText = `Sensitive operation requires verification.\n\nDetected operation: ${metadata.commandPreview}\n\nPlease complete QR verification:\n${metadata.qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.\n\nAfter verification, resend the previous command or reply "confirm".`;
      }

      return { content: messageText };
    }
  });

  api.on("before_tool_call", async (event, ctx) => {
    await authManager.ensureInitialized();
    if (!config.requireAuthOnSensitiveOperation) {
      return undefined;
    }

    const { toolName, params } = event;

    api.logger.info(`[mfa-auth] Tool call detected: ${toolName}`);

    const sensitiveTools = ["bash", "exec", "runCommand", "command", "process"];
    if (!sensitiveTools.includes(toolName)) {
      api.logger.info(`[mfa-auth] Tool ${toolName} is not in sensitive list, allowing`);
      return undefined;
    }

    const command =
      typeof params?.command === "string"
        ? params.command
        : typeof params?.cmd === "string"
          ? params.cmd
          : typeof params?.input === "string"
            ? params.input
            : typeof params?.args === "string"
              ? params.args
              : "";

    api.logger.info(`[mfa-auth] Extracted command from ${toolName}: ${command}`);

    if (!command) {
      api.logger.info(`[mfa-auth] No command found in params, allowing`);
      return undefined;
    }

    const { isSensitive, preview } = checkSensitiveOperation(command);
    if (!isSensitive) {
      api.logger.info(`[mfa-auth] Command is not sensitive, allowing`);
      return undefined;
    }

    const sessionKey = ctx.sessionKey || "";
    const parsed = parseSessionContextFromKey(sessionKey);
    const userId = isWebchatChannel(parsed.channel)
      ? parsed.to || sessionKey || "unknown"
      : sessionKey || "unknown";

    if (authManager.isUserVerifiedForSensitiveOps(userId)) {
      api.logger.info(`[mfa-auth] User ${userId} is verified for sensitive ops, allowing`);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        const parsedChannel = parsed.channel;
        const parsedAccountId = parsed.accountId;
        const parsedTo = parsed.to;

        const targetSessionKey =
          isWebchatChannel(parsedChannel) ? sessionKey || userId : sessionKey;

        sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          "Second-factor verification successful. Please resend the previous command or reply 'confirm'.",
          userId,
          targetSessionKey,
        ).catch((err) =>
          api.logger.error(`[mfa-auth] Failed to send success notification: ${err}`),
        );
      }

      return undefined;
    }

    api.logger.info(`[mfa-auth] User ${userId} is NOT verified for sensitive ops.`);

    const parsedChannel = parsed.channel;
    const parsedAccountId = parsed.accountId;
    const parsedTo = parsed.to;

    api.logger.info(
      `[mfa-auth] Parsed from sessionKey: channel=${parsedChannel}, accountId=${parsedAccountId}, to=${parsedTo}`,
    );

    const session = await authManager.generateSession(userId, {
      sessionKey,
      senderId: userId,
      commandBody: command,
      channel: parsedChannel,
      to: parsedTo,
      accountId: parsedAccountId,
      toolName,
      toolParams: params,
      timestamp: Date.now(),
      triggerType: "sensitive_operation",
    });

    if (!session) {
      api.logger.error(`[mfa-auth] Failed to generate session for user ${userId}`);
      return undefined;
    }

    api.logger.info(`[mfa-auth] Blocking sensitive tool call: ${toolName} from ${userId}`);

    // For webchat, use userId as sessionKey instead of agent:main:<userId>
    if (isWebchatChannel(parsedChannel)) {
      const sessionKeyForWebchat = sessionKey || userId;

      try {
        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          `Sensitive operation requires verification.\n\nDetected operation: ${preview}\n\nPlease complete QR verification:\n${session.qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.\n\nAfter verification, resend the previous command or reply "confirm".`, 
          userId,
          sessionKeyForWebchat,
        );
        api.logger.info(
          `[mfa-auth] Sent sensitive operation auth notification to webchat: sessionKey=${sessionKeyForWebchat}`,
        );
      } catch (error) {
        api.logger.error(
          `[mfa-auth] Failed to send webchat sensitive auth notification: ${String(error)}`,
        );
      }
      // Also add to pending users as fallback
      addPendingAuthCandidates(userId, sessionKeyForWebchat, parsedTo);
      authManager.setSessionMetadata(session.sessionId, {
        qrCodeUrl: session.qrCodeUrl,
        triggerType: "sensitive_operation",
        commandPreview: preview,
      });

      startPollingForAuth(api, userId, session.sessionId, {
        triggerType: "sensitive_operation",
        isReauth: false,
        channel: parsedChannel,
        accountId: parsedAccountId,
        to: parsedTo,
        sessionKey: sessionKeyForWebchat,
      });

      return {
        block: true,
        blockReason: "Sensitive operation requires second-factor verification.",
      };
    }

    if (parsedChannel && parsedChannel !== "web") {
      if (parsedChannel !== "feishu") {
        api.logger.warn(
          `[mfa-auth] Channel ${parsedChannel} not supported, skipping auth notification`,
        );
      } else {
        const messageText = `Sensitive operation requires verification.\n\nDetected operation: ${preview}\n\nPlease complete QR verification:\n${session.qrCodeUrl}\n\nValid for ${Math.floor(config.timeout / 60000)} minutes.\n\nAfter verification, resend the previous command or reply "confirm".`;

        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          messageText,
          userId,
        );

        startPollingForAuth(api, userId, session.sessionId, {
          triggerType: "sensitive_operation",
          isReauth: false,
          channel: parsedChannel,
          accountId: parsedAccountId,
          to: parsedTo,
          sessionKey: ctx.sessionKey || "",
        });
      }
    }

    authManager.registerPendingExecution(userId, session.sessionId);

    return {
      block: true,
      blockReason: "Sensitive operation requires second-factor verification.",
    };
  });

  api.on("message_received", async (event, ctx) => {
    await authManager.ensureInitialized();
    const metadata =
      event.metadata && typeof event.metadata === "object"
        ? (event.metadata as Record<string, unknown>)
        : undefined;
    const metadataSenderId =
      typeof metadata?.senderId === "string" ? metadata.senderId : undefined;
    const metadataTo = typeof metadata?.to === "string" ? metadata.to : undefined;
    const metadataOriginatingTo =
      typeof metadata?.originatingTo === "string" ? metadata.originatingTo : undefined;
    const userId = resolveInboundAuthUserId({
      channelId: ctx.channelId,
      from: event.from,
      senderId: metadataSenderId,
      conversationId: ctx.conversationId,
      metadataTo,
      metadataOriginatingTo,
    });
    const authAliases = expandAuthIdCandidates([
      event.from,
      metadataSenderId,
      ctx.conversationId,
      metadataOriginatingTo,
      metadataTo,
      userId,
    ]);

    api.logger.info(
      `[mfa-auth] First message auth check: config.requireAuthOnFirstMessage=${config.requireAuthOnFirstMessage}`,
    );
    if (config.debug) {
      api.logger.info(
        `[mfa-auth] Inbound auth aliases: userId=${userId}, from=${event.from}, senderId=${metadataSenderId}, conversationId=${ctx.conversationId}, metadata.to=${metadataTo}, metadata.originatingTo=${metadataOriginatingTo}, aliases=${authAliases.join(",")}`,
      );
    }

    if (!config.requireAuthOnFirstMessage) {
      api.logger.warn(`[mfa-auth] First message auth is disabled in config, skipping.`);
      return;
    }

    const content = event.content || "";
    const isReauthCommand = content.trim() === "/reauth";

    if (isReauthCommand) {
      api.logger.info(`[mfa-auth] /reauth command detected, skipping first message auth check`);
      return;
    }

    const verifiedAlias = isAnyFirstMessageAliasVerified(authAliases);
    if (verifiedAlias) {
      api.logger.info(
        `[mfa-auth] User ${userId} already verified for first message (matchedAlias=${verifiedAlias})`,
      );

      const notificationInfo = consumeNotificationByAliases(authAliases);
      if (notificationInfo) {
        const parsedChannel = ctx.channelId;
        const parsedAccountId = ctx.accountId || "";
        const parsedTo = isWebchatChannel(parsedChannel) ? userId : event.from;

        let sessionKey = ctx.conversationId;
        if (!sessionKey) {
          if (parsedChannel === "webchat" || parsedChannel === "web") {
            sessionKey = userId;
          } else {
            sessionKey = `${parsedChannel}:${parsedAccountId}:${userId}`;
          }
        }

        const messageText = notificationInfo.isReauth
          ? "Re-auth verification successful. Please continue chatting."
          : "First-message verification successful. Please continue chatting.";

        sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          messageText,
          userId,
          sessionKey,
        ).catch((err) =>
          api.logger.error(`[mfa-auth] Failed to send success notification: ${err}`),
        );
      }

      return;
    }

    api.logger.info(`[mfa-auth] First message from unauthenticated user ${userId}, requiring auth`);
    api.logger.info(
      `[mfa-auth] Debug Context: channelId=${ctx.channelId}, conversationId=${ctx.conversationId}, accountId=${ctx.accountId}, from=${event.from}`,
    );

    const parsedChannel = ctx.channelId;
    const parsedAccountId = ctx.accountId || "";
    const parsedTo = isWebchatChannel(parsedChannel) ? userId : event.from;

    // Use conversationId as sessionKey if available
    // For webchat, try to use userId directly as sessionKey (common pattern)
    let sessionKey = ctx.conversationId;
    if (!sessionKey) {
      if (isWebchatChannel(parsedChannel)) {
        // For webchat, use userId as sessionKey (this is the most common pattern)
        sessionKey = userId;
        api.logger.info(`[mfa-auth] Using webchat sessionKey (userId): ${sessionKey}`);
      } else {
        // Fallback to channel:accountId:from format
        sessionKey = `${parsedChannel}:${parsedAccountId}:${userId}`;
      }
    }

    const session = await authManager.generateSession(userId, {
      sessionKey,
      senderId: userId,
      commandBody: event.content || "",
      channel: parsedChannel,
      to: parsedTo,
      accountId: parsedAccountId,
      toolName: "",
      toolParams: {},
      timestamp: Date.now(),
      triggerType: "first_message",
    });

    if (!session) {
      api.logger.error(
        `[mfa-auth] Failed to generate first message auth session for user ${userId}`,
      );
      return;
    }

    api.logger.info(`[mfa-auth] Blocking first message from ${userId}`);

    if (isWebchatChannel(parsedChannel)) {
      addPendingAuthCandidates(userId, sessionKey, parsedTo);
      authManager.setSessionMetadata(session.sessionId, {
        qrCodeUrl: session.qrCodeUrl,
        triggerType: "first_message",
      });

      try {
        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          `馃攼 棣栨瀵硅瘽闇€瑕佽繘琛岃璇乗n\n涓轰簡鎮ㄧ殑璐︽埛瀹夊叏锛岄娆″璇濆墠闇€瑕佸畬鎴愯韩浠介獙璇併€俓n\n馃摣 璇风偣鍑讳互涓嬮摼鎺ュ畬鎴愭壂鐮佽璇?\n${session.qrCodeUrl}\n\n楠岃瘉鏈夋晥鏈? ${Math.floor(config.timeout / 60000)} 鍒嗛挓`,
          userId,
          sessionKey,
        );
      } catch (error) {
        api.logger.error(
          `[mfa-auth] Failed to send first-message auth link to webchat: ${String(error)}`,
        );
      }

      startPollingForAuth(api, userId, session.sessionId, {
        triggerType: "first_message",
        isReauth: false,
        channel: parsedChannel,
        accountId: parsedAccountId,
        to: parsedTo,
        sessionKey: userId,
      });

      return;
    }

    if (parsedChannel && parsedChannel !== "web") {
      if (parsedChannel !== "feishu") {
        api.logger.warn(
          `[mfa-auth] Channel ${parsedChannel} not supported, skipping auth notification`,
        );
      } else {
        const messageText = `馃攼 棣栨瀵硅瘽闇€瑕佽繘琛岃璇乗n\n涓轰簡鎮ㄧ殑璐︽埛瀹夊叏锛岄娆″璇濆墠闇€瑕佸畬鎴愯韩浠介獙璇併€俓n\n馃摫 璇风偣鍑讳互涓嬮摼鎺ュ畬鎴愭壂鐮佽璇?\n${session.qrCodeUrl}\n\n楠岃瘉鏈夋晥鏈? ${Math.floor(config.timeout / 60000)} 鍒嗛挓`;

        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          messageText,
          userId,
          sessionKey,
        );

        startPollingForAuth(api, userId, session.sessionId, {
          triggerType: "first_message",
          isReauth: false,
          channel: parsedChannel,
          accountId: parsedAccountId,
          to: parsedTo,
          sessionKey: sessionKey,
        });
      }
    }
  });

  api.registerCommand({
    name: "reauth",
    description: "閲嶆柊杩涜棣栨瀵硅瘽璁よ瘉",
    acceptsArgs: false,
    requireAuth: false,
    handler: async (ctx) => {
      const rawCtx = ctx as unknown as Record<string, unknown>;
      const ctxSessionKey = typeof rawCtx.sessionKey === "string" ? rawCtx.sessionKey : undefined;
      const userId =
        normalizeAuthId(ctx.from || ctx.senderId || ctx.to || ctxSessionKey || "unknown") ||
        "unknown";
      const authUserIds = expandAuthIdCandidates(
        uniqueNonEmpty([ctx.from, ctx.senderId, ctx.to, ctxSessionKey, userId]),
      );
      api.logger.info(
        `[mfa-auth] /reauth command received. userId=${userId}, aliases=${authUserIds.join(",")}, ctx.channel=${ctx.channel}, ctx.accountId=${ctx.accountId}, ctx.to=${ctx.to}`,
      );

      for (const authUserId of authUserIds) {
        authManager.clearFirstMessageAuth(authUserId);
      }

      const parsedChannel = ctx.channel;
      const parsedAccountId = ctx.accountId || "";
      const parsedTo = ctx.to;

      api.logger.info(
        `[mfa-auth] Parsed: channel=${parsedChannel}, accountId=${parsedAccountId}, to=${parsedTo}`,
      );

      // For webchat, use userId as sessionKey
      const sessionKey =
        isWebchatChannel(parsedChannel)
          ? ctxSessionKey || userId
          : `${parsedChannel}:${parsedAccountId}:${userId}`;

      api.logger.info(`[mfa-auth] Using sessionKey for reauth: ${sessionKey}`);

      const session = await authManager.generateSession(userId, {
        sessionKey,
        senderId: userId,
        commandBody: "/reauth",
        channel: parsedChannel,
        to: parsedTo,
        accountId: parsedAccountId,
        toolName: "",
        toolParams: {},
        timestamp: Date.now(),
        triggerType: "first_message",
      });

      if (!session) {
        api.logger.error(`[mfa-auth] Failed to generate reauth session for user ${userId}`);
        return { text: "Failed to create authentication session. Please try again later." };
      }

      api.logger.info(
        `[mfa-auth] Reauth requested by user ${userId}, session=${session.sessionId}`,
      );

      const messageText = `馃攼 閲嶆柊璁よ瘉\n\n馃摫 璇风偣鍑讳互涓嬮摼鎺ュ畬鎴愭壂鐮佽璇?\n${session.qrCodeUrl}\n\n楠岃瘉鏈夋晥鏈? ${Math.floor(config.timeout / 60000)} 鍒嗛挓`;

      // Use sendAuthMessage to ensure consistent delivery via WebSocket for WebChat
      // This will use the new robust session resolution logic
      if (isWebchatChannel(parsedChannel)) {
        try {
          addPendingAuthCandidates(userId, sessionKey, parsedTo);
          authManager.setSessionMetadata(session.sessionId, {
            qrCodeUrl: session.qrCodeUrl,
            triggerType: "first_message",
            isReauth: true,
          });

          await sendAuthMessage(
            parsedChannel,
            parsedAccountId,
            parsedTo || userId,
            messageText,
            userId,
            sessionKey,
          );

          startPollingForAuth(api, userId, session.sessionId, {
            triggerType: "first_message",
            isReauth: true,
            channel: parsedChannel,
            accountId: parsedAccountId,
            to: parsedTo,
            sessionKey: sessionKey,
          });

          return { text: messageText };
        } catch (error) {
          api.logger.error(`[mfa-auth] Failed to send reauth link to webchat: ${String(error)}`);
          // Fallback to returning text directly if push fails, though this might be less reliable if session context is lost
          return { text: messageText };
        }
      }

      if (!parsedChannel || parsedChannel !== "feishu") {
        api.logger.warn(`[mfa-auth] Channel ${parsedChannel} not supported`);
        return { text: "Current channel does not support this authentication flow." };
      }

      try {
        api.logger.info(
          `[mfa-auth] Sending reauth notification: channel=${parsedChannel}, to=${parsedTo}, accountId=${parsedAccountId}`,
        );

        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          `馃攼 閲嶆柊璁よ瘉\n\n馃摫 璇风偣鍑讳互涓嬮摼鎺ュ畬鎴愭壂鐮佽璇?\n${session.qrCodeUrl}\n\n楠岃瘉鏈夋晥鏈? ${Math.floor(config.timeout / 60000)} 鍒嗛挓`,
          userId,
        );

        startPollingForAuth(api, userId, session.sessionId, {
          triggerType: "first_message",
          isReauth: true,
          channel: parsedChannel,
          accountId: parsedAccountId,
          to: parsedTo,
          sessionKey: sessionKey,
        });

        api.logger.info(`[mfa-auth] Reauth notification sent successfully`);
        return { text: "Auth link sent. Please check new messages." };
      } catch (error) {
        api.logger.error(`[mfa-auth] Failed to send reauth notification: ${String(error)}`);
        return { text: "Failed to send auth link. Please try again later." };
      }
    },
  });

  api.logger.info("mfa-auth plugin loaded");
}

function startPollingForAuth(
  api: OpenClawPluginApi,
  userId: string,
  sessionId: string,
  context: {
    triggerType: string;
    isReauth: boolean;
    channel?: string;
    accountId?: string;
    to?: string;
    sessionKey?: string;
  },
) {
  api.logger.info(
    `[mfa-auth] Starting polling for auth status: userId=${userId}, sessionId=${sessionId}`,
  );

  const pollInterval = setInterval(async () => {
    let isVerified = false;
    if (context.triggerType === "first_message") {
      isVerified = authManager.isUserVerifiedForFirstMessage(userId);
    } else {
      isVerified = authManager.isUserVerifiedForSensitiveOps(userId);
    }

    if (!isVerified) {
      const session = authManager.getSession(sessionId);
      if (session && session.certToken) {
        try {
          const authResult = await dabbyClient.getAuthResult(session.certToken);
          if (authResult.status === "verified") {
            api.logger.info(`[mfa-auth] Auth verification successful for session ${sessionId}`);
            authManager.markUserVerified(
              userId,
              context.triggerType === "first_message" ? "first_message" : "sensitive_operation",
              context.isReauth,
            );
            isVerified = true;
          } else if (authResult.status === "failed" || authResult.status === "expired") {
            api.logger.warn(
              `[mfa-auth] Auth failed or expired for session ${sessionId}: ${authResult.error}`,
            );
            clearInterval(pollInterval);
            return;
          }
        } catch (error) {
          api.logger.error(
            `[mfa-auth] Failed to check auth status for session ${sessionId}: ${String(error)}`,
          );
        }
      }
    }

    if (isVerified) {
      clearInterval(pollInterval);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        api.logger.info(`[mfa-auth] Polling detected verification for user ${userId}`);

        const messageText = notificationInfo.isReauth
          ? "Re-auth verification successful. Please continue chatting."
          : notificationInfo.triggerType === "first_message"
            ? "First-message verification successful. Please continue chatting."
            : "Second-factor verification successful. Please resend the previous command or reply 'confirm'.";

        sendAuthMessage(
          context.channel,
          context.accountId,
          context.to || userId,
          messageText,
          userId,
          context.sessionKey,
        ).catch((err) =>
          api.logger.error(`[mfa-auth] Failed to send success notification from polling: ${err}`),
        );
      }
      return;
    }

    const session = authManager.getSession(sessionId);
    if (!session) {
      clearInterval(pollInterval);
      api.logger.info(
        `[mfa-auth] Polling stopped: session ${sessionId} not found and user not verified`,
      );
    }
  }, 2000);

  setTimeout(() => {
    clearInterval(pollInterval);
  }, config.timeout + 10000);
}

function checkSensitiveOperation(text: string): { isSensitive: boolean; preview: string } {
  const lowerText = text.toLowerCase();

  if (config.debug) {
    console.log(`[mfa-auth] Checking sensitive keywords for: ${text}`);
    console.log(
      `[mfa-auth] Sensitive keywords configured: ${JSON.stringify(config.sensitiveKeywords)}`,
    );
  }

  for (const keyword of config.sensitiveKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      const preview = text;
      if (config.debug) {
        console.log(`[mfa-auth] Sensitive keyword matched: ${keyword}`);
      }
      return { isSensitive: true, preview };
    }
  }

  if (config.debug) {
    console.log(`[mfa-auth] No sensitive keyword matched`);
  }

  return { isSensitive: false, preview: "" };
}

