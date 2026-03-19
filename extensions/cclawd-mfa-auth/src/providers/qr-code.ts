/**
 * Cclawd MFA Auth Plugin - QR Code Auth Provider
 */

import { authManager } from '../auth-manager.js';
import { dabbyClient } from '../dabby-client.js';
import type { AuthSession, AuthResult } from '../types.js';
import { BaseAuthProvider } from './base.js';

/**
 * QR 码认证提供者
 */
export class QrCodeAuthProvider extends BaseAuthProvider {
  readonly methodType = 'qr-code' as const;
  readonly name = 'QR Code Authentication';
  readonly description = 'Scan QR code to authenticate';

  /**
   * 初始化二维码认证
   */
  async initialize(session: AuthSession): Promise<void> {
    try {
      const tokenInfo = await dabbyClient.getVerifyCode();

      authManager.updateAuthStatus(session.sessionId, 'pending');
      session.certToken = tokenInfo.certToken;
      session.qrCodeUrl = tokenInfo.qrCodeUrl;
      session.expireTimeMs = Date.now() + 5 * 60 * 1000; // 5 分钟有效期
      session.authStatus = 'pending';

      console.log(`[cclawd-mfa-auth] QR code initialized for session ${session.sessionId}`);
    } catch (error) {
      console.error(`[cclawd-mfa-auth] Failed to initialize QR code: ${error}`);
      throw error;
    }
  }

  /**
   * 验证二维码扫描状态
   */
  async verify(sessionId: string, userInput?: string): Promise<AuthResult> {
    const session = authManager.getSession(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found', status: 'failed' };
    }

    if (!session.certToken) {
      return { success: false, error: 'QR code not initialized', status: 'failed' };
    }

    // 检查是否过期
    if (session.expireTimeMs && Date.now() > session.expireTimeMs) {
      authManager.updateAuthStatus(sessionId, 'expired');
      return { success: false, error: 'QR code expired', status: 'expired' };
    }

    try {
      const result = await dabbyClient.getAuthResult(session.certToken);

      if (result.status === 'verified') {
        authManager.updateAuthStatus(sessionId, 'verified');
        return { success: true, status: 'verified' };
      }

      if (result.status === 'failed') {
        authManager.updateAuthStatus(sessionId, 'failed');
        return { success: false, error: result.error || 'Authentication failed', status: 'failed' };
      }

      return { success: false, status: result.status };
    } catch (error) {
      console.error(`[cclawd-mfa-auth] Failed to verify QR code: ${error}`);
      return { success: false, error: String(error), status: 'failed' };
    }
  }
}

/**
 * QR 码认证提供者工厂
 */
class QrCodeAuthProviderFactory {
  private static instance: QrCodeAuthProvider | null = null;

  static getInstance(): QrCodeAuthProvider {
    if (!this.instance) {
      this.instance = new QrCodeAuthProvider();
      console.log('[QrCodeAuthProviderFactory] Created new QrCodeAuthProvider instance');
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log('[QrCodeAuthProviderFactory] Reset QrCodeAuthProvider instance');
  }
}

export const qrCodeAuthProvider = QrCodeAuthProviderFactory.getInstance();
