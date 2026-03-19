/**
 * Cclawd MFA Auth Plugin - Authentication Session Manager
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type {
  AuthSession,
  AuthMethodProvider,
  AuthResult,
  PendingAuthContext,
  NotificationInfo,
} from './types.js';

/**
 * 首次消息认证记录
 */
interface FirstMessageAuthRecord {
  verifiedAt: number;
}

/**
 * 认证管理器
 */
export class AuthManager {
  // 会话存储
  private sessions = new Map<string, AuthSession>();
  
  // 敏感操作认证状态
  public verifiedForSensitiveOps = new Map<string, number>();
  
  // 首次消息认证状态
  private verifiedForFirstMessage = new Map<string, number>();
  
  // 待发送的通知
  private pendingNotifications = new Map<string, NotificationInfo>();
  
  // 认证提供者注册表
  private providers = new Map<string, AuthMethodProvider>();
  
  // 待执行的操作
  private pendingExecutions = new Map<string, { sessionId: string; timestamp: number }>();
  
  // 配置
  private config = config;
  
  // 持久化目录
  private persistDir: string;
  
  // 初始化状态
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.persistDir = this.resolvePersistDir();
    // 定期清理过期数据
    setInterval(() => this.cleanup(), 30000);
  }

  /**
   * 异步初始化
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        this.loadPersistedFirstMessageAuth();
        this.initialized = true;
        console.log('[cclawd-mfa-auth] AuthManager initialized successfully');
      } catch (error) {
        console.error('[cclawd-mfa-auth] Failed to initialize AuthManager:', error);
      }
    })();

    return this.initPromise;
  }

  /**
   * 解析持久化目录路径
   */
  private resolvePersistDir(): string {
    const dir = this.config.persistAuthStateDir || '~/.openclaw/mfa-auth/';
    if (dir.startsWith('~/')) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      return dir.replace('~', homeDir);
    }
    return dir;
  }

  /**
   * 获取持久化文件路径
   */
  private getPersistFilePath(): string {
    return `${this.persistDir}/first-message-auth.json`;
  }

  /**
   * 注册认证提供者
   */
  registerProvider(provider: AuthMethodProvider): void {
    this.providers.set(provider.methodType, provider);
    console.log(`[cclawd-mfa-auth] Registered auth provider: ${provider.methodType}`);
  }

  /**
   * 加载持久化的首次消息认证状态
   */
  loadPersistedFirstMessageAuth(): void {
    const filePath = this.getPersistFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const records = JSON.parse(content) as Record<string, FirstMessageAuthRecord>;
        const now = Date.now();
        const duration = this.config.firstMessageAuthDuration || 24 * 60 * 60 * 1000;

        for (const [userId, record] of Object.entries(records)) {
          if (now - record.verifiedAt < duration) {
            this.verifiedForFirstMessage.set(userId, record.verifiedAt);
          }
        }

        if (this.config.debug) {
          console.log(
            `[cclawd-mfa-auth] Loaded ${this.verifiedForFirstMessage.size} first message auth records from ${filePath}`,
          );
        }
      }
    } catch (error) {
      console.error(`[cclawd-mfa-auth] Failed to load persisted auth state: ${String(error)}`);
    }
  }

  /**
   * 持久化首次消息认证状态
   */
  persistFirstMessageAuth(userId: string): void {
    const filePath = this.getPersistFilePath();
    try {
      const records: Record<string, FirstMessageAuthRecord> = {};
      this.verifiedForFirstMessage.forEach((timestamp, id) => {
        records[id] = { verifiedAt: timestamp };
      });

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');

      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] Persisted first message auth state for ${userId}`);
      }
    } catch (error) {
      console.error(`[cclawd-mfa-auth] Failed to persist auth state: ${String(error)}`);
    }
  }

  /**
   * 清除用户的首次消息认证状态
   */
  clearFirstMessageAuth(userId: string): void {
    this.verifiedForFirstMessage.delete(userId);
    this.persistFirstMessageAuth(userId);
    if (this.config.debug) {
      console.log(`[cclawd-mfa-auth] Cleared first message auth for user ${userId}`);
    }
  }

  /**
   * 检查用户是否已通过首次消息认证
   */
  isUserVerifiedForFirstMessage(userId: string): boolean {
    if (!this.initialized) {
      if (this.config.debug) {
        console.log('[cclawd-mfa-auth] AuthManager not yet initialized, allowing first message check');
      }
      return false;
    }

    const verifiedTime = this.verifiedForFirstMessage.get(userId);
    if (!verifiedTime) return false;

    const duration = this.config.firstMessageAuthDuration || 24 * 60 * 60 * 1000;
    if (Date.now() - verifiedTime > duration) {
      this.verifiedForFirstMessage.delete(userId);
      this.persistFirstMessageAuth(userId);
      return false;
    }

    return true;
  }

  /**
   * 检查用户是否已通过敏感操作认证
   */
  isUserVerifiedForSensitiveOps(userId: string): boolean {
    if (!this.initialized) {
      if (this.config.debug) {
        console.log('[cclawd-mfa-auth] AuthManager not yet initialized, allowing sensitive ops check');
      }
      return false;
    }

    const verifiedTime = this.verifiedForSensitiveOps.get(userId);
    if (!verifiedTime) return false;

    if (Date.now() - verifiedTime > this.config.verificationDuration) {
      this.verifiedForSensitiveOps.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * 确保已初始化
   */
  async ensureInitialized(): Promise<void> {
    await this.initialize();
  }

  /**
   * 获取认证提供者
   */
  getProvider(methodType: string): AuthMethodProvider | undefined {
    return this.providers.get(methodType);
  }

  /**
   * 生成认证会话
   */
  async generateSession(
    userId: string,
    originalContext: PendingAuthContext,
    authMethod: string = this.config.defaultAuthMethod,
    extraFields?: Partial<AuthSession>,
  ): Promise<AuthSession | null> {
    const provider = this.getProvider(authMethod);
    if (!provider) {
      console.error(`[cclawd-mfa-auth] Auth provider not found: ${authMethod}`);
      return null;
    }

    const sessionId = crypto.randomUUID();
    const session: AuthSession = {
      sessionId,
      userId,
      authMethod: authMethod as AuthSession['authMethod'],
      timestamp: Date.now(),
      originalContext,
      ...extraFields,
    };

    this.sessions.set(sessionId, session);

    try {
      await provider.initialize(session);
    } catch (error) {
      console.error(`[cclawd-mfa-auth] Failed to initialize session: ${error}`);
      this.sessions.delete(sessionId);
      return null;
    }

    if (this.config.debug) {
      console.log(`[cclawd-mfa-auth] Generated session: ${sessionId}`);
      console.log(`[cclawd-mfa-auth] User ID: ${userId}`);
      console.log(`[cclawd-mfa-auth] Auth method: ${authMethod}`);
      console.log(`[cclawd-mfa-auth] Total sessions: ${this.sessions.size}`);
    }

    return session;
  }

  /**
   * 验证会话
   */
  async verifySession(sessionId: string, userInput?: string): Promise<AuthResult> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (Date.now() - session.timestamp > this.config.timeout) {
      this.sessions.delete(sessionId);
      return { success: false, error: 'Session expired' };
    }

    const provider = this.getProvider(session.authMethod);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const result = await provider.verify(sessionId, userInput);

    if (result.success) {
      const triggerType = session.originalContext.triggerType || 'sensitive_operation';
      const isReauth = session.originalContext.commandBody.trim() === '/reauth';

      this.markUserVerified(session.userId, triggerType, isReauth);

      this.sessions.delete(sessionId);

      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] Session verified and deleted: ${sessionId}`);
        console.log(`[cclawd-mfa-auth] User ${session.userId} marked as verified (${triggerType})`);
      }
    }

    return result;
  }

  /**
   * 检查并消费通知
   */
  checkAndConsumeNotification(userId: string): NotificationInfo | null {
    const info = this.pendingNotifications.get(userId);
    if (info) {
      this.pendingNotifications.delete(userId);
      return info;
    }
    return null;
  }

  /**
   * 检查用户是否已认证（通用方法）
   */
  isUserVerified(userId: string): boolean {
    return this.isUserVerifiedForSensitiveOps(userId);
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): AuthSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 获取所有会话ID
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * 根据用户ID获取最新的会话
   */
  getLatestSessionByUserId(userId: string): AuthSession | undefined {
    let latestSession: AuthSession | undefined;
    let latestTimestamp = 0;

    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.timestamp > latestTimestamp) {
        latestSession = session;
        latestTimestamp = session.timestamp;
      }
    }

    return latestSession;
  }

  /**
   * 设置会话元数据
   */
  setSessionMetadata(sessionId: string, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.metadata = { ...session.metadata, ...metadata };
      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] Set metadata for session ${sessionId}:`, metadata);
      }
    }
  }

  /**
   * 更新认证状态
   */
  updateAuthStatus(
    sessionId: string,
    status: 'pending' | 'scanned' | 'verified' | 'failed' | 'expired',
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.authStatus = status;
      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] Session ${sessionId} status updated to: ${status}`);
      }
    }
  }

  /**
   * 获取证书令牌
   */
  getCertToken(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.certToken;
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    // 清理过期会话
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.config.timeout) {
        const provider = this.getProvider(session.authMethod);
        if (provider) {
          provider.cleanup(id);
        }
        this.sessions.delete(id);
        cleanedCount++;
      }
    }

    // 清理过期的敏感操作认证
    for (const [userId, verifiedTime] of this.verifiedForSensitiveOps.entries()) {
      if (now - verifiedTime > this.config.verificationDuration) {
        this.verifiedForSensitiveOps.delete(userId);
        cleanedCount++;
      }
    }

    // 清理过期的首次消息认证
    const firstMessageDuration = this.config.firstMessageAuthDuration || 24 * 60 * 60 * 1000;
    for (const [userId, verifiedTime] of this.verifiedForFirstMessage.entries()) {
      if (now - verifiedTime > firstMessageDuration) {
        this.verifiedForFirstMessage.delete(userId);
        this.persistFirstMessageAuth(userId);
        cleanedCount++;
      }
    }

    // 清理过期的待执行操作
    for (const [userId, pending] of this.pendingExecutions.entries()) {
      if (now - pending.timestamp > 10 * 60 * 1000) {
        this.pendingExecutions.delete(userId);
        cleanedCount++;
      }
    }

    if (this.config.debug && cleanedCount > 0) {
      console.log(`[cclawd-mfa-auth] Cleanup: removed ${cleanedCount} expired entries`);
    }
  }

  /**
   * 注册待执行操作
   */
  registerPendingExecution(userId: string, sessionId: string): void {
    this.pendingExecutions.set(userId, { sessionId, timestamp: Date.now() });
    if (this.config.debug) {
      console.log(`[cclawd-mfa-auth] Registered pending execution for user ${userId}: ${sessionId}`);
    }
  }

  /**
   * 获取并清除待执行操作
   */
  getAndClearPendingExecution(userId: string): string | null {
    const pending = this.pendingExecutions.get(userId);
    if (pending) {
      this.pendingExecutions.delete(userId);
      if (this.config.debug) {
        console.log(
          `[cclawd-mfa-auth] Cleared pending execution for user ${userId}: ${pending.sessionId}`,
        );
      }
      return pending.sessionId;
    }
    return null;
  }

  /**
   * 检查是否有待执行操作
   */
  hasPendingExecution(userId: string): boolean {
    const pending = this.pendingExecutions.get(userId);
    if (!pending) return false;
    const now = Date.now();
    return now - pending.timestamp < 10 * 60 * 1000;
  }

  /**
   * 标记用户已验证
   */
  markUserVerified(
    userId: string,
    triggerType: 'first_message' | 'sensitive_operation' = 'sensitive_operation',
    isReauth: boolean = false,
  ): void {
    if (triggerType === 'first_message') {
      this.verifiedForFirstMessage.set(userId, Date.now());
      this.persistFirstMessageAuth(userId);
    } else {
      this.verifiedForSensitiveOps.set(userId, Date.now());
    }
    this.pendingNotifications.set(userId, { triggerType, isReauth });
    if (this.config.debug) {
      console.log(
        `[cclawd-mfa-auth] Marked user ${userId} as verified (${triggerType}, reauth=${isReauth})`,
      );
    }
  }
}

/**
 * 认证管理器工厂
 */
class AuthManagerFactory {
  private static instance: AuthManager | null = null;

  static getInstance(): AuthManager {
    if (!this.instance) {
      this.instance = new AuthManager();
      console.log('[AuthManagerFactory] Created new AuthManager instance');
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log('[AuthManagerFactory] Reset AuthManager instance');
  }
}

export const authManager = AuthManagerFactory.getInstance();
