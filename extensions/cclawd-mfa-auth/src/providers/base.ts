/**
 * Cclawd MFA Auth Plugin - Base Auth Provider
 */

import type { AuthMethodProvider, AuthSession, AuthResult } from '../types.js';

/**
 * 认证提供者基类
 */
export abstract class BaseAuthProvider implements AuthMethodProvider {
  abstract readonly methodType: AuthSession['authMethod'];
  abstract readonly name: string;
  abstract readonly description: string;

  abstract initialize(session: AuthSession): Promise<void>;
  abstract verify(sessionId: string, userInput?: string): Promise<AuthResult>;

  /**
   * 清理会话资源
   */
  cleanup(sessionId: string): void {
    // 子类可以重写此方法以清理资源
    console.log(`[cclawd-mfa-auth] Cleanup called for session: ${sessionId}`);
  }
}
