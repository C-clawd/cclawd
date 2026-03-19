/**
 * Cclawd MFA Auth Plugin - Main Entry
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { authManager } from './src/auth-manager.js';
import { config } from './src/config.js';
import { NotificationService } from './src/notification-service.js';
import { pollingManager } from './src/polling-manager.js';
import { SessionResolver } from './src/session-resolver.js';
import { sensitiveDetector } from './src/sensitive-detector.js';
import { qrCodeAuthProvider } from './src/providers/qr-code.js';
import type { AuthSession, PendingAuthContext } from './src/types.js';

const notificationService = NotificationService.getInstance();

/**
 * 发送认证消息
 */
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
    sessionId: 'notification',
    authMethod: 'qr-code',
    timestamp: Date.now(),
    originalContext: {
      sessionKey: overrideSessionKey || `${channel || 'web'}:${accountId || ''}:${userId}`,
      senderId: userId,
      commandBody: '',
      channel: channel || 'web',
      accountId: accountId || '',
      to,
      toolName: 'notification',
      toolParams: {},
      timestamp: Date.now(),
      triggerType: 'sensitive_operation',
    },
  };

  await notificationService.sendAuthNotification(session, message);
}

/**
 * 插件注册函数
 */
export default function register(api: OpenClawPluginApi) {
  console.log('[cclawd-mfa-auth] Plugin registration started');
  authManager.registerProvider(qrCodeAuthProvider);

  notificationService.setConfig(api.config);

  /**
   * 处理消息接收事件 - 首次对话认证
   */
  api.on('message_received', async (event, ctx) => {
    await authManager.ensureInitialized();

    api.logger.info(
      `[cclawd-mfa-auth] First message auth check: config.requireAuthOnFirstMessage=${config.requireAuthOnFirstMessage}`,
    );

    if (!config.requireAuthOnFirstMessage) {
      api.logger.warn(`[cclawd-mfa-auth] First message auth is disabled in config, skipping.`);
      return;
    }

    const content = event.content || '';
    const isReauthCommand = content.trim() === '/reauth';

    if (isReauthCommand) {
      api.logger.info(`[cclawd-mfa-auth] /reauth command detected, skipping first message auth check`);
      return;
    }

    // 解析会话信息
    // metadata.senderId 是 WebChat 的真实用户标识
    const metadataSenderId = event.metadata?.senderId as string | undefined;
    
    const resolved = SessionResolver.resolveFromContext({
      sessionKey: ctx.sessionKey,
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      accountId: ctx.accountId,
      from: event.from,
      senderId: metadataSenderId || ctx.senderId,
    });

    const userId = resolved.userId;

    api.logger.info(`[cclawd-mfa-auth] Extracted userId="${userId}", sessionKey="${resolved.sessionKey}"`);

    // 检查是否已认证
    if (authManager.isUserVerifiedForFirstMessage(userId)) {
      api.logger.info(`[cclawd-mfa-auth] User ${userId} already verified for first message`);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        const messageText = notificationInfo.isReauth
          ? '✅ 重新认证成功，请继续对话。'
          : '✅ 首次认证成功，请继续对话。';

        await sendAuthMessage(
          resolved.channel,
          resolved.accountId,
          event.metadata?.to as string | undefined || event.from || userId,
          messageText,
          userId,
          resolved.sessionKey,
        );
      }
      return;
    }

    api.logger.info(`[cclawd-mfa-auth] First message from unauthenticated user ${userId}, requiring auth`);

    // 生成认证会话
    const session = await authManager.generateSession(userId, {
      sessionKey: resolved.sessionKey,
      senderId: userId,
      commandBody: event.content || '',
      channel: resolved.channel,
      to: event.metadata?.to as string | undefined || event.from,
      accountId: resolved.accountId,
      toolName: '',
      toolParams: {},
      timestamp: Date.now(),
      triggerType: 'first_message',
    });

    if (!session) {
      api.logger.error(`[cclawd-mfa-auth] Failed to generate first message auth session for user ${userId}`);
      return;
    }

    api.logger.info(`[cclawd-mfa-auth] Blocking first message from ${userId}`);

    // 发送认证链接
    const messageText = `🔐 首次对话需要进行认证

为了您的账户安全，首次对话前需要完成身份验证。

📱 请点击以下链接完成扫码认证:
${session.qrCodeUrl}

验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`;

    try {
      await sendAuthMessage(
        resolved.channel,
        resolved.accountId,
        event.metadata?.to as string | undefined || event.from || userId,
        messageText,
        userId,
        resolved.sessionKey,
      );

      // 启动轮询
      pollingManager.startPolling(api, userId, session.sessionId, {
        triggerType: 'first_message',
        isReauth: false,
        channel: resolved.channel,
        accountId: resolved.accountId,
        to: event.metadata?.to as string | undefined,
        sessionKey: resolved.sessionKey,
      });

      api.logger.info(`[cclawd-mfa-auth] Sent first message auth notification`);
    } catch (error) {
      api.logger.error(`[cclawd-mfa-auth] Failed to send first message auth notification: ${String(error)}`);
    }
  });

  /**
   * 处理工具调用前事件 - 敏感操作认证
   */
  api.on('before_tool_call', async (event, ctx) => {
    await authManager.ensureInitialized();
    if (!config.requireAuthOnSensitiveOperation) {
      return undefined;
    }

    const { toolName, params } = event;

    api.logger.info(`[cclawd-mfa-auth] Tool call detected: ${toolName}`);

    // 检查是否为敏感操作
    const sensitiveCheck = sensitiveDetector.checkToolCall(toolName, params || {});
    if (!sensitiveCheck.isSensitive) {
      api.logger.info(`[cclawd-mfa-auth] Tool ${toolName} is not sensitive, allowing`);
      return undefined;
    }

    // 解析会话信息
    const resolved = SessionResolver.resolveFromContext({
      sessionKey: ctx.sessionKey,
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      accountId: ctx.accountId,
      from: ctx.from,
      senderId: ctx.senderId,
    });

    const userId = resolved.userId;

    // 检查是否已认证
    if (authManager.isUserVerifiedForSensitiveOps(userId)) {
      api.logger.info(`[cclawd-mfa-auth] User ${userId} is verified for sensitive ops, allowing`);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        await sendAuthMessage(
          resolved.channel,
          resolved.accountId,
          resolved.to || userId,
          '✅ 二次认证成功，请重新发送之前的命令（或回复"确认"）即可执行。',
          userId,
          resolved.sessionKey,
        );
      }

      return undefined;
    }

    api.logger.info(`[cclawd-mfa-auth] User ${userId} is NOT verified for sensitive ops.`);

    // 生成认证会话
    const session = await authManager.generateSession(userId, {
      sessionKey: resolved.sessionKey,
      senderId: userId,
      commandBody: sensitiveCheck.preview,
      channel: resolved.channel,
      to: resolved.to,
      accountId: resolved.accountId,
      toolName,
      toolParams: params || {},
      timestamp: Date.now(),
      triggerType: 'sensitive_operation',
    });

    if (!session) {
      api.logger.error(`[cclawd-mfa-auth] Failed to generate session for user ${userId}`);
      return undefined;
    }

    api.logger.info(`[cclawd-mfa-auth] Blocking sensitive tool call: ${toolName} from ${userId}`);

    // 发送认证链接
    const messageText = `🔐 该操作需要二次认证

检测到敏感操作: ${sensitiveCheck.preview}

📱 请点击以下链接完成扫码认证:
${session.qrCodeUrl}

验证有效期: ${Math.floor(config.timeout / 60000)} 分钟

验证成功后，请回复"确认"或者重新发送之前的命令以继续执行。`;

    try {
      await sendAuthMessage(
        resolved.channel,
        resolved.accountId,
        resolved.to || userId,
        messageText,
        userId,
        resolved.sessionKey,
      );

      // 启动轮询
      pollingManager.startPolling(api, userId, session.sessionId, {
        triggerType: 'sensitive_operation',
        isReauth: false,
        channel: resolved.channel,
        accountId: resolved.accountId,
        to: resolved.to,
        sessionKey: resolved.sessionKey,
      });

      api.logger.info(`[cclawd-mfa-auth] Sent sensitive operation auth notification`);
    } catch (error) {
      api.logger.error(`[cclawd-mfa-auth] Failed to send sensitive operation auth notification: ${String(error)}`);
    }

    // 注册待执行操作
    authManager.registerPendingExecution(userId, session.sessionId);

    return {
      block: true,
      blockReason: `🔐 该操作需要二次认证`,
    };
  });

  /**
   * 注册 /reauth 命令
   */
  api.registerCommand({
    name: 'reauth',
    description: '重新进行首次对话认证',
    acceptsArgs: false,
    requireAuth: false,
    handler: async (ctx) => {
      const userId = ctx.from || ctx.senderId || 'unknown';
      api.logger.info(`[cclawd-mfa-auth] /reauth command received. userId=${userId}`);

      // 清除首次消息认证状态
      authManager.clearFirstMessageAuth(userId);

      // 解析会话信息
      const resolved = SessionResolver.resolveFromContext({
        sessionKey: ctx.sessionKey,
        channelId: ctx.channel,
        accountId: ctx.accountId,
        from: ctx.from,
        senderId: ctx.senderId,
        to: ctx.to,
      });

      // 生成认证会话
      const session = await authManager.generateSession(userId, {
        sessionKey: resolved.sessionKey,
        senderId: userId,
        commandBody: '/reauth',
        channel: resolved.channel,
        to: resolved.to,
        accountId: resolved.accountId,
        toolName: '',
        toolParams: {},
        timestamp: Date.now(),
        triggerType: 'first_message',
      });

      if (!session) {
        api.logger.error(`[cclawd-mfa-auth] Failed to generate reauth session for user ${userId}`);
        return { text: '❌ 认证会话创建失败，请稍后重试。' };
      }

      api.logger.info(`[cclawd-mfa-auth] Reauth requested by user ${userId}, session=${session.sessionId}`);

      const messageText = `🔐 重新认证

📱 请点击以下链接完成扫码认证:
${session.qrCodeUrl}

验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`;

      try {
        await sendAuthMessage(
          resolved.channel,
          resolved.accountId,
          resolved.to || userId,
          messageText,
          userId,
          resolved.sessionKey,
        );

        // 启动轮询
        pollingManager.startPolling(api, userId, session.sessionId, {
          triggerType: 'first_message',
          isReauth: true,
          channel: resolved.channel,
          accountId: resolved.accountId,
          to: resolved.to,
          sessionKey: resolved.sessionKey,
        });

        return { text: '📱 认证链接已发送，请查看最新消息。' };
      } catch (error) {
        api.logger.error(`[cclawd-mfa-auth] Failed to send reauth link: ${String(error)}`);
        return { text: '❌ 认证链接发送失败，请稍后重试。' };
      }
    },
  });

  api.logger.info('[cclawd-mfa-auth] Plugin loaded successfully');
}
