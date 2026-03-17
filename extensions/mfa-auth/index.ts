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

  notificationService.setRuntime(api.runtime);
  notificationService.setLogger(api.logger);

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
          ? `🎉 重新认证成功！请重新发送消息以继续对话。`
          : `🎉 首次认证成功！请重新发送消息以继续对话。`;
      } else {
        messageText = `✅ 二次认证成功！\n\n请回到聊天窗口，重新发送之前的命令（或回复'确认'）即可执行。`;
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

  api.on("message_sending", async (event, ctx) => {
    const userId = event.to || ctx.conversationId || "unknown";

    if (pendingAuthUsers.has(userId)) {
      const session = authManager.getLatestSessionByUserId(userId);
      const metadata = session?.metadata as Record<string, unknown> | undefined;

      if (metadata?.qrCodeUrl) {
        pendingAuthUsers.delete(userId);

        let messageText = "";
        if (metadata.triggerType === "first_message") {
          const isReauth = metadata.isReauth === true;
          messageText = isReauth
            ? `🔐 重新认证\n\n📱 请点击以下链接完成扫码认证:\n${metadata.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`
            : `🔐 首次对话需要进行认证\n\n为了您的账户安全，首次对话前需要完成身份验证。\n\n📱 请点击以下链接完成扫码认证:\n${metadata.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`;
        } else if (metadata.triggerType === "sensitive_operation") {
          messageText = `🔐 该操作需要二次认证\n\n检测到敏感操作: ${metadata.commandPreview}\n\n📱 请点击以下链接完成扫码认证:\n${metadata.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟\n\n验证成功后，请回复"确认"或者重新发送之前的命令以继续执行。`;
        }

        return { content: messageText };
      }
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

    const userId = ctx.sessionKey || "unknown";

    if (authManager.isUserVerifiedForSensitiveOps(userId)) {
      api.logger.info(`[mfa-auth] User ${userId} is verified for sensitive ops, allowing`);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        const sessionKey = ctx.sessionKey || "";
        const sessionKeyParts = sessionKey.split(":").filter(Boolean);
        const parsedChannel = sessionKeyParts[2] || undefined;
        let parsedAccountId = sessionKeyParts[3] || undefined;
        const parsedTo = sessionKeyParts[sessionKeyParts.length - 1] || undefined;

        if (parsedAccountId === "direct" || parsedAccountId === "group") {
          parsedAccountId = undefined;
        }

        const targetSessionKey =
          parsedChannel === "webchat" || parsedChannel === "web" ? userId : sessionKey;

        sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          "✅ 二次认证成功，请重新发送之前的命令（或回复'确认'）即可执行。",
          userId,
          targetSessionKey,
        ).catch((err) =>
          api.logger.error(`[mfa-auth] Failed to send success notification: ${err}`),
        );
      }

      return undefined;
    }

    api.logger.info(`[mfa-auth] User ${userId} is NOT verified for sensitive ops.`);

    const sessionKey = ctx.sessionKey || "";
    const sessionKeyParts = sessionKey.split(":").filter(Boolean);

    const parsedChannel = sessionKeyParts[2] || undefined;
    let parsedAccountId = sessionKeyParts[3] || undefined;
    const parsedTo = sessionKeyParts[sessionKeyParts.length - 1] || undefined;

    // Fix: If accountId is "direct" or "group", it's actually the peerKind, not an accountId.
    // This happens when the sessionKey omits the accountId (using default account).
    if (parsedAccountId === "direct" || parsedAccountId === "group") {
      parsedAccountId = undefined;
    }

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
    if (parsedChannel === "webchat" || parsedChannel === "web") {
      const sessionKeyForWebchat = userId;

      try {
        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          `🔐 该操作需要二次认证\n\n检测到敏感操作: ${preview}\n\n📱 请点击以下链接完成扫码认证:\n${session.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟\n\n验证成功后，请回复"确认"或者重新发送之前的命令以继续执行。`,
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
      pendingAuthUsers.add(userId);
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
        blockReason: `🔐 该操作需要二次认证`,
      };
    }

    if (parsedChannel && parsedChannel !== "web") {
      const messageText = `🔐 该操作需要二次认证\n\n检测到敏感操作: ${preview}\n\n📱 请点击以下链接完成扫码认证:\n${session.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟\n\n验证成功后，请回复"确认"或者重新发送之前的命令以继续执行。`;

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

    authManager.registerPendingExecution(userId, session.sessionId);

    return {
      block: true,
      blockReason: `🔐 该操作需要二次认证`,
    };
  });

  api.on("message_received", async (event, ctx) => {
    await authManager.ensureInitialized();

    api.logger.info(
      `[mfa-auth] First message auth check: config.requireAuthOnFirstMessage=${config.requireAuthOnFirstMessage}`,
    );

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

    const userId = event.from || ctx.conversationId || "unknown";

    if (authManager.isUserVerifiedForFirstMessage(userId)) {
      api.logger.info(`[mfa-auth] User ${userId} already verified for first message`);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        const parsedChannel = ctx.channelId;
        const parsedAccountId = ctx.accountId || "";
        const parsedTo = event.from;

        let sessionKey = ctx.conversationId;
        if (!sessionKey) {
          if (parsedChannel === "webchat" || parsedChannel === "web") {
            sessionKey = userId;
          } else {
            sessionKey = `${parsedChannel}:${parsedAccountId}:${event.from}`;
          }
        }

        const messageText = notificationInfo.isReauth
          ? "✅ 重新认证成功，请继续对话。"
          : "✅ 首次认证成功，请继续对话。";

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
    const parsedTo = event.from;

    // Use conversationId as sessionKey if available
    // For webchat, try to use userId directly as sessionKey (common pattern)
    let sessionKey = ctx.conversationId;
    if (!sessionKey) {
      if (parsedChannel === "webchat" || parsedChannel === "web") {
        // For webchat, use userId as sessionKey (this is the most common pattern)
        sessionKey = userId;
        api.logger.info(`[mfa-auth] Using webchat sessionKey (userId): ${sessionKey}`);
      } else {
        // Fallback to channel:accountId:from format
        sessionKey = `${parsedChannel}:${parsedAccountId}:${event.from}`;
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

    if (parsedChannel === "webchat" || parsedChannel === "web") {
      pendingAuthUsers.add(userId);
      authManager.setSessionMetadata(session.sessionId, {
        qrCodeUrl: session.qrCodeUrl,
        triggerType: "first_message",
      });

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
      const messageText = `🔐 首次对话需要进行认证\n\n为了您的账户安全，首次对话前需要完成身份验证。\n\n📱 请点击以下链接完成扫码认证:\n${session.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`;

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
  });

  api.registerCommand({
    name: "reauth",
    description: "重新进行首次对话认证",
    acceptsArgs: false,
    requireAuth: false,
    handler: async (ctx) => {
      const userId = ctx.from || ctx.senderId || "unknown";
      api.logger.info(
        `[mfa-auth] /reauth command received. userId=${userId}, ctx.channel=${ctx.channel}, ctx.accountId=${ctx.accountId}, ctx.to=${ctx.to}`,
      );

      authManager.clearFirstMessageAuth(userId);

      const parsedChannel = ctx.channel;
      const parsedAccountId = ctx.accountId || "";
      const parsedTo = ctx.to;

      api.logger.info(
        `[mfa-auth] Parsed: channel=${parsedChannel}, accountId=${parsedAccountId}, to=${parsedTo}`,
      );

      // For webchat, use userId as sessionKey
      const sessionKey =
        parsedChannel === "webchat" || parsedChannel === "web"
          ? userId
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
        return { text: "❌ 认证会话创建失败，请稍后重试。" };
      }

      api.logger.info(
        `[mfa-auth] Reauth requested by user ${userId}, session=${session.sessionId}`,
      );

      const messageText = `🔐 重新认证\n\n📱 请点击以下链接完成扫码认证:\n${session.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`;

      // Use sendAuthMessage to ensure consistent delivery via WebSocket for WebChat
      // This will use the new robust session resolution logic
      if (parsedChannel === "webchat" || parsedChannel === "web") {
        try {
          pendingAuthUsers.add(userId);
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

          return { text: "� 认证链接已发送，请查看最新消息。" };
        } catch (error) {
          api.logger.error(`[mfa-auth] Failed to send reauth link to webchat: ${String(error)}`);
          // Fallback to returning text directly if push fails, though this might be less reliable if session context is lost
          return { text: messageText };
        }
      }

      if (!parsedChannel || parsedChannel === "web") {
        api.logger.warn(`[mfa-auth] Channel ${parsedChannel} not supported for reauth`);
        return { text: "❌ 当前渠道不支持认证。" };
      }

      try {
        api.logger.info(
          `[mfa-auth] Sending reauth notification: channel=${parsedChannel}, to=${parsedTo}, accountId=${parsedAccountId}`,
        );

        await sendAuthMessage(
          parsedChannel,
          parsedAccountId,
          parsedTo || userId,
          `🔐 重新认证\n\n📱 请点击以下链接完成扫码认证:\n${session.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`,
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
        return { text: "📱 认证链接已发送，请查收。" };
      } catch (error) {
        api.logger.error(`[mfa-auth] Failed to send reauth notification: ${String(error)}`);
        return { text: "❌ 认证链接发送失败，请稍后重试。" };
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
          ? "✅ 重新认证成功，请继续对话。"
          : notificationInfo.triggerType === "first_message"
            ? "✅ 首次认证成功，请继续对话。"
            : "✅ 二次认证成功，请重新发送之前的命令（或回复'确认'）即可执行。";

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
