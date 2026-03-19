/**
 * Cclawd MFA Auth Plugin - Notification Service
 * 
 * 统一的消息推送服务，支持多渠道消息发送
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { ClawdbotConfig } from 'openclaw/plugin-sdk';
import { config } from './config.js';
import type { AuthSession } from './types.js';

/**
 * 通知服务
 */
export class NotificationService {
  private static instance: NotificationService;
  private cfg?: ClawdbotConfig;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * 设置配置
   */
  setConfig(cfg: ClawdbotConfig): void {
    this.cfg = cfg;
  }

  /**
   * 发送认证通知
   */
  async sendAuthNotification(session: AuthSession, message: string): Promise<void> {
    const { channel, accountId, to } = session.originalContext;

    if (!this.cfg) {
      console.warn('[cclawd-mfa-auth] Config not set, skipping notification');
      return;
    }

    // Web/WebChat 渠道
    if (channel === 'webchat' || channel === 'web') {
      console.log(`[cclawd-mfa-auth] Web/webchat channel: sending notification via WebSocket`);
      await this.sendToWebChat(session, message);
      return;
    }

    // 飞书渠道
    if (channel === 'feishu') {
      await this.sendToFeishu(session, message);
      return;
    }

    console.warn(`[cclawd-mfa-auth] Unsupported channel: ${channel}`);
  }

  /**
   * 发送消息到 WebChat
   */
  private async sendToWebChat(session: AuthSession, message: string): Promise<void> {
    const { sessionKey } = session.originalContext;
    const port = this.cfg?.gateway?.port || 18789;
    const token = this.cfg?.gateway?.auth?.token;
    const host = config.gatewayHost || '127.0.0.1';

    console.log(`[cclawd-mfa-auth] [DEBUG] sendToWebChat START`);
    console.log(`[cclawd-mfa-auth] [DEBUG] sessionKey=${sessionKey}`);
    console.log(`[cclawd-mfa-auth] [DEBUG] host=${host}, port=${port}`);
    console.log(`[cclawd-mfa-auth] [DEBUG] token=${token ? '已配置' : '未配置'}`);
    console.log(`[cclawd-mfa-auth] [DEBUG] userId=${session.userId}`);

    // 动态导入 WebSocket
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsModule = await import('ws');
    const WebSocket = wsModule.default || (wsModule as any).WebSocket;

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = new WebSocket(`ws://${host}:${port}`);

      const handshakeId = `mfa-handshake-${Date.now()}`;
      const sessionsListId = `mfa-sessions-${Date.now()}`;
      let currentInjectId = '';
      let candidateSessionKeys: string[] = [];
      let injectIndex = 0;

      /**
       * 发送消息注入请求
       */
      const sendInject = (targetSessionKey: string) => {
        currentInjectId = `mfa-req-${Date.now()}-${injectIndex}`;
        const payload = {
          type: 'req',
          id: currentInjectId,
          method: 'chat.inject',
          params: {
            sessionKey: targetSessionKey,
            message,
            label: 'MFA Auth',
          },
        };
        ws.send(JSON.stringify(payload));
      };

      ws.on('open', () => {
        console.log(`[cclawd-mfa-auth] [DEBUG] WebSocket 连接已建立`);
        const handshake = {
          type: 'req',
          id: handshakeId,
          method: 'connect',
          params: {
            minProtocol: 1,
            maxProtocol: 3,
            client: {
              id: 'gateway-client',
              version: '1.0.0',
              platform: 'node',
              mode: 'backend',
            },
            auth: token ? { token } : undefined,
            role: 'operator',
            scopes: ['operator.admin'],
          },
        };
        console.log(`[cclawd-mfa-auth] [DEBUG] 发送握手请求: id=${handshakeId}`);
        ws.send(JSON.stringify(handshake));
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.on('message', (data: any) => {
        try {
          const response = JSON.parse(data.toString());

          // 握手响应
          if (response.id === handshakeId) {
            console.log(`[cclawd-mfa-auth] [DEBUG] 收到握手响应`);
            if (!response.ok) {
              ws.close();
              reject(new Error(`Handshake failed: ${JSON.stringify(response.error)}`));
              return;
            }

            // 获取会话列表
            const listPayload = {
              type: 'req',
              id: sessionsListId,
              method: 'sessions.list',
              params: {
                limit: 200,
                includeGlobal: true,
                includeUnknown: true,
              },
            };
            console.log(`[cclawd-mfa-auth] [DEBUG] 发送会话列表请求: id=${sessionsListId}`);
            ws.send(JSON.stringify(listPayload));
            return;
          }

          // 会话列表响应
          if (response.id === sessionsListId) {
            console.log(`[cclawd-mfa-auth] [DEBUG] 收到会话列表响应`);
            if (!response.ok) {
              ws.close();
              reject(new Error(`sessions.list failed: ${JSON.stringify(response.error)}`));
              return;
            }

            // 响应格式: { ok: true, payload: { sessions: [...] } }
            const payload = response.payload as Record<string, unknown> | undefined;
            const sessionsRaw = Array.isArray(payload?.sessions) ? payload.sessions : [];
                    
            console.log(`[cclawd-mfa-auth] [DEBUG] 会话列表详情 (${sessionsRaw.length} 个):`);
            for (const s of sessionsRaw) {
              if (s && typeof s === 'object') {
                const dc = (s as any).deliveryContext;
                console.log(`[cclawd-mfa-auth] [DEBUG] - key=${(s as any).key}, channel=${(s as any).channel}, dc.channel=${dc?.channel}`);
              }
            }

            // 解析候选会话
            candidateSessionKeys = this.resolveWebchatSessionCandidates({
              requestedSessionKey: sessionKey,
              userId: session.userId,
              targetTo: session.originalContext.to,
              sessionsListResult: { sessions: sessionsRaw },
            });

            console.log(
              `[cclawd-mfa-auth] [DEBUG] 找到 ${candidateSessionKeys.length} 个候选会话: ${candidateSessionKeys.join(', ')}`,
            );

            if (candidateSessionKeys.length === 0) {
              ws.close();
              reject(new Error('No candidate webchat sessions found'));
              return;
            }

            // 尝试注入到第一个候选会话
            injectIndex = 0;
            console.log(`[cclawd-mfa-auth] [DEBUG] 尝试注入到会话: ${candidateSessionKeys[injectIndex]}`);
            sendInject(candidateSessionKeys[injectIndex]);
            return;
          }

          // 注入响应
          if (response.id === currentInjectId) {
            console.log(
              `[cclawd-mfa-auth] [DEBUG] 收到注入响应: ok=${response.ok}, error=${JSON.stringify(response.error)}`,
            );

            if (response.ok && !response.error) {
              console.log(`[cclawd-mfa-auth] [DEBUG] 消息注入成功！`);
              ws.close();
              resolve();
              return;
            }

            // 如果注入失败，尝试下一个候选会话
            const errMsg = String(response?.error?.message ?? '').toLowerCase();
            const shouldTryNext = errMsg.includes('session not found');

            if (shouldTryNext && injectIndex + 1 < candidateSessionKeys.length) {
              injectIndex += 1;
              console.log(`[cclawd-mfa-auth] [DEBUG] 尝试下一个会话: ${candidateSessionKeys[injectIndex]}`);
              sendInject(candidateSessionKeys[injectIndex]);
              return;
            }

            ws.close();
            reject(
              new Error(
                `Chat inject failed after trying [${candidateSessionKeys.join(', ')}]: ${JSON.stringify(response.error)}`,
              ),
            );
          }
        } catch (e) {
          console.error(`[cclawd-mfa-auth] [DEBUG] 解析消息失败:`, e);
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.on('error', (err: any) => {
        console.log(`[cclawd-mfa-auth] [DEBUG] WebSocket 错误: ${err}`);
        reject(err);
      });

      // 超时处理
      setTimeout(() => {
        console.log(`[cclawd-mfa-auth] [DEBUG] WebSocket 超时 (5秒)`);
        try {
          ws.terminate();
        } catch (e) {}
        reject(new Error('WebSocket timeout'));
      }, 5000);
    });
  }

  /**
   * 解析 WebChat 候选会话
   */
  private resolveWebchatSessionCandidates(params: {
    requestedSessionKey?: string;
    userId: string;
    targetTo?: string;
    sessionsListResult: unknown;
  }): string[] {
    const normalizedTarget = String(params.targetTo || params.userId || '')
      .trim()
      .toLowerCase();

    const resultObject =
      params.sessionsListResult && typeof params.sessionsListResult === 'object'
        ? (params.sessionsListResult as Record<string, unknown>)
        : undefined;

    const sessionsRaw = Array.isArray(resultObject?.sessions) ? resultObject.sessions : [];

    // 过滤 webchat 会话
    const webchatRows = sessionsRaw
      .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : undefined))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => {
        const ch = String(row.channel ?? '')
          .trim()
          .toLowerCase();
        const dc = row.deliveryContext as Record<string, unknown> | undefined;
        const dcChannel = String(dc?.channel ?? '')
          .trim()
          .toLowerCase();
        return ch === 'webchat' || ch === 'web' || dcChannel === 'webchat' || dcChannel === 'web';
      });

    // 精确匹配
    const exactRows = webchatRows.filter((row) => {
      const dc = row.deliveryContext as Record<string, unknown> | undefined;
      const peer = String(dc?.to ?? row.lastTo ?? '')
        .trim()
        .toLowerCase();
      return peer.length > 0 && peer === normalizedTarget;
    });

    // 回退匹配
    const fallbackRows = webchatRows.filter((row) => !exactRows.includes(row));

    // 模糊匹配
    const fuzzyRows = webchatRows.filter((row) => {
      const key = String(row.key ?? '').toLowerCase();
      return (
        key.includes(normalizedTarget) && !exactRows.includes(row) && !fallbackRows.includes(row)
      );
    });

    // 按更新时间降序排序
    const sortByUpdatedAtDesc = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aa = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
      const bb = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
      return bb - aa;
    };

    exactRows.sort(sortByUpdatedAtDesc);
    fallbackRows.sort(sortByUpdatedAtDesc);
    fuzzyRows.sort(sortByUpdatedAtDesc);

    // 构建候选会话列表
    const keys = [
      params.requestedSessionKey,
      ...exactRows.map((row) => String(row.key ?? '').trim()),
      ...fallbackRows.map((row) => String(row.key ?? '').trim()),
      ...fuzzyRows.map((row) => String(row.key ?? '').trim()),
      // 标准模式
      `agent:main:${normalizedTarget}`,
      `webchat:${normalizedTarget}`,
      normalizedTarget,
      'main',
    ];

    // 去重
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const key of keys) {
      const normalized = String(key ?? '').trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduped.push(normalized);
    }

    return deduped;
  }

  /**
   * 发送消息到飞书
   */
  private async sendToFeishu(session: AuthSession, message: string): Promise<void> {
    const { accountId, to } = session.originalContext;

    if (!this.cfg) {
      console.warn('[cclawd-mfa-auth] Config not set, cannot send Feishu message');
      return;
    }

    if (!to) {
      console.warn('[cclawd-mfa-auth] Feishu target "to" is missing, cannot send message');
      return;
    }

    try {
      // TODO: 实现 resolveFeishuSendTarget
      console.log(`[cclawd-mfa-auth] Feishu message would be sent to ${to}`);
      // 临时实现，后续需要根据实际需求补充
    } catch (error) {
      console.error(`[cclawd-mfa-auth] Failed to send Feishu message: ${error}`);
      throw error;
    }
  }

  /**
   * 构建飞书消息负载
   */
  private buildFeishuPostMessagePayload(params: { messageText: string }): {
    content: string;
    msgType: string;
  } {
    const { messageText } = params;
    return {
      content: JSON.stringify({
        zh_cn: {
          content: [
            [
              {
                tag: 'md',
                text: messageText,
              },
            ],
          ],
        },
      }),
      msgType: 'post',
    };
  }
}

export { NotificationService };
