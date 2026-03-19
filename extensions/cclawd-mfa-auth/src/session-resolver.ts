/**
 * Cclawd MFA Auth Plugin - Session Resolver
 * 
 * 统一的会话解析器，处理不同渠道的 sessionKey 解析
 */

import type { ResolvedSession } from './types.js';

/**
 * 会话解析器
 */
export class SessionResolver {
  /**
   * 从 sessionKey 解析会话信息
   */
  static resolveFromSessionKey(sessionKey: string): ResolvedSession {
    const parts = sessionKey.split(':').filter(Boolean);

    // 格式 1: agent:main:<userId>
    if (parts.length === 3 && parts[0] === 'agent' && parts[1] === 'main') {
      return {
        userId: parts[2],
        channel: 'webchat',
        sessionKey,
      };
    }

    // 格式 2: webchat:<userId>
    if (parts.length === 2 && parts[0] === 'webchat') {
      return {
        userId: parts[1],
        channel: 'webchat',
        sessionKey,
      };
    }

    // 格式 3: <channel>:<accountId>:<userId>
    if (parts.length === 3) {
      return {
        userId: parts[2],
        channel: parts[0],
        accountId: parts[1],
        sessionKey,
      };
    }

    // 格式 4: <channel>:<accountId>:<peerKind>:<userId>
    if (parts.length === 4) {
      return {
        userId: parts[3],
        channel: parts[0],
        accountId: parts[1] === 'direct' || parts[1] === 'group' || parts[1] === 'dm' ? undefined : parts[1],
        sessionKey,
      };
    }

    // 格式 5: 单独的 userId
    if (parts.length === 1) {
      return {
        userId: parts[0],
        sessionKey,
      };
    }

    // 默认返回原始 sessionKey 作为 userId
    return {
      userId: sessionKey,
      sessionKey,
    };
  }

  /**
   * 从事件上下文解析会话信息
   */
  static resolveFromContext(params: {
    sessionKey?: string;
    channelId?: string;
    conversationId?: string;
    accountId?: string;
    from?: string;
    senderId?: string;
  }): ResolvedSession {
    // 优先使用 sessionKey
    if (params.sessionKey) {
      return this.resolveFromSessionKey(params.sessionKey);
    }

    // 使用 conversationId
    if (params.conversationId) {
      return {
        userId: params.conversationId,
        channel: params.channelId,
        accountId: params.accountId,
        sessionKey: params.conversationId,
      };
    }

    // 使用 from 或 senderId
    const userId = params.from || params.senderId || 'unknown';
    const channel = params.channelId;

    // 构建会话键
    let sessionKey = userId;
    if (channel && channel !== 'webchat' && channel !== 'web') {
      const accountId = params.accountId || '';
      sessionKey = `${channel}:${accountId}:${userId}`;
    }

    return {
      userId,
      channel,
      accountId: params.accountId,
      sessionKey,
    };
  }

  /**
   * 构建 sessionKey
   */
  static buildSessionKey(params: {
    channel?: string;
    accountId?: string;
    userId: string;
  }): string {
    const { channel, accountId, userId } = params;

    // Web/WebChat 直接使用 userId
    if (channel === 'webchat' || channel === 'web') {
      return userId;
    }

    // 其他渠道使用完整格式
    if (channel && accountId) {
      return `${channel}:${accountId}:${userId}`;
    }

    if (channel) {
      return `${channel}::${userId}`;
    }

    return userId;
  }

  /**
   * 判断是否为 Web/WebChat 渠道
   */
  static isWebChannel(channel?: string): boolean {
    return channel === 'webchat' || channel === 'web';
  }

  /**
   * 获取 Web/WebChat 标准化的会话键
   */
  static normalizeWebchatSessionKey(userId: string): string {
    return userId;
  }
}

export { SessionResolver };
