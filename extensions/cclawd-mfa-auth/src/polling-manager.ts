/**
 * Cclawd MFA Auth Plugin - Polling Manager
 * 
 * 管理认证状态轮询任务
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { authManager } from './auth-manager.js';
import { config } from './config.js';
import { dabbyClient } from './dabby-client.js';
import type { PollingTask, AuthTriggerType } from './types.js';

/**
 * 轮询管理器
 */
export class PollingManager {
  private tasks = new Map<string, PollingTask>();
  private config = config;

  /**
   * 启动轮询任务
   */
  startPolling(
    api: OpenClawPluginApi,
    userId: string,
    sessionId: string,
    context: {
      triggerType: AuthTriggerType;
      isReauth: boolean;
      channel?: string;
      accountId?: string;
      to?: string;
      sessionKey?: string;
    },
  ): string {
    const taskId = `poll-${sessionId}-${Date.now()}`;

    api.logger.info(
      `[cclawd-mfa-auth] Starting polling for auth status: userId=${userId}, sessionId=${sessionId}`,
    );

    const interval = setInterval(async () => {
      try {
        await this.pollAuthStatus(api, userId, sessionId, context);
      } catch (error) {
        api.logger.error(
          `[cclawd-mfa-auth] Polling error for session ${sessionId}: ${String(error)}`,
        );
      }
    }, 2000);

    const task: PollingTask = {
      taskId,
      sessionId,
      userId,
      triggerType: context.triggerType,
      startTime: Date.now(),
      interval,
      context: {
        channel: context.channel,
        accountId: context.accountId,
        to: context.to,
        sessionKey: context.sessionKey,
        isReauth: context.isReauth,
      },
    };

    this.tasks.set(taskId, task);

    // 设置超时自动清理
    setTimeout(() => {
      this.stopPolling(taskId);
    }, config.timeout + 10000);

    return taskId;
  }

  /**
   * 停止轮询任务
   */
  stopPolling(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      clearInterval(task.interval);
      this.tasks.delete(taskId);
      console.log(`[cclawd-mfa-auth] Stopped polling task: ${taskId}`);
    }
  }

  /**
   * 停止用户的所有轮询任务
   */
  stopPollingForUser(userId: string): void {
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.userId === userId) {
        this.stopPolling(taskId);
      }
    }
  }

  /**
   * 轮询认证状态
   */
  private async pollAuthStatus(
    api: OpenClawPluginApi,
    userId: string,
    sessionId: string,
    context: {
      triggerType: AuthTriggerType;
      isReauth: boolean;
      channel?: string;
      accountId?: string;
      to?: string;
      sessionKey?: string;
    },
  ): Promise<void> {
    // 检查是否已验证
    let isVerified = false;
    if (context.triggerType === 'first_message') {
      isVerified = authManager.isUserVerifiedForFirstMessage(userId);
    } else {
      isVerified = authManager.isUserVerifiedForSensitiveOps(userId);
    }

    if (!isVerified) {
      // 检查认证状态
      const session = authManager.getSession(sessionId);
      if (session && session.certToken) {
        try {
          const authResult = await dabbyClient.getAuthResult(session.certToken);

          if (authResult.status === 'verified') {
            api.logger.info(`[cclawd-mfa-auth] Auth verification successful for session ${sessionId}`);
            authManager.markUserVerified(
              userId,
              context.triggerType === 'first_message' ? 'first_message' : 'sensitive_operation',
              context.isReauth,
            );
            isVerified = true;
          } else if (authResult.status === 'failed' || authResult.status === 'expired') {
            api.logger.warn(
              `[cclawd-mfa-auth] Auth failed or expired for session ${sessionId}: ${authResult.error}`,
            );
            // 停止该会话的轮询
            this.stopPollingForUser(userId);
            return;
          }
        } catch (error) {
          api.logger.error(
            `[cclawd-mfa-auth] Failed to check auth status for session ${sessionId}: ${String(error)}`,
          );
        }
      }
    }

    // 如果已验证，发送通知并停止轮询
    if (isVerified) {
      this.stopPollingForUser(userId);

      const notificationInfo = authManager.checkAndConsumeNotification(userId);
      if (notificationInfo) {
        api.logger.info(`[cclawd-mfa-auth] Polling detected verification for user ${userId}`);

        const messageText = notificationInfo.isReauth
          ? '✅ 重新认证成功，请继续对话。'
          : notificationInfo.triggerType === 'first_message'
            ? '✅ 首次认证成功，请继续对话。'
            : '✅ 二次认证成功，请重新发送之前的命令（或回复"确认"）即可执行。';

        // 使用 notification-service 发送消息
        const { NotificationService } = await import('./notification-service.js');
        const notificationService = NotificationService.getInstance();

        const session = authManager.getSession(sessionId);
        if (session) {
          await notificationService.sendAuthNotification(session, messageText);
        }
      }
      return;
    }

    // 检查会话是否还存在
    const session = authManager.getSession(sessionId);
    if (!session) {
      this.stopPollingForUser(userId);
      api.logger.info(
        `[cclawd-mfa-auth] Polling stopped: session ${sessionId} not found and user not verified`,
      );
    }
  }

  /**
   * 获取活跃的轮询任务数量
   */
  getActiveTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * 清理所有轮询任务
   */
  cleanup(): void {
    for (const [taskId] of this.tasks) {
      this.stopPolling(taskId);
    }
  }
}

/**
 * 轮询管理器工厂
 */
class PollingManagerFactory {
  private static instance: PollingManager | null = null;

  static getInstance(): PollingManager {
    if (!this.instance) {
      this.instance = new PollingManager();
      console.log('[PollingManagerFactory] Created new PollingManager instance');
    }
    return this.instance;
  }

  static reset(): void {
    if (this.instance) {
      this.instance.cleanup();
    }
    this.instance = null;
    console.log('[PollingManagerFactory] Reset PollingManager instance');
  }
}

export const pollingManager = PollingManagerFactory.getInstance();
