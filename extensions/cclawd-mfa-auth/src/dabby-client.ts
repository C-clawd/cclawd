/**
 * Cclawd MFA Auth Plugin - Dabby API Client
 */

import { dabbyConfig } from './config.js';
import type {
  DabbyConfig,
  DabbyVerifyCodeResponse,
  DabbyCheckAuthStatusResponse,
} from './types.js';

/**
 * 获取 fetch 函数
 */
const resolveFetch = (): typeof fetch => {
  const resolved = globalThis.fetch;
  if (!resolved) {
    throw new Error('fetch is not available in this environment');
  }
  return resolved;
};

/**
 * Dabby API 客户端
 */
export class DabbyClient {
  constructor(private config: DabbyConfig = dabbyConfig) {}

  /**
   * 获取验证码（二维码）
   */
  async getVerifyCode(): Promise<DabbyVerifyCodeResponse['data']> {
    if (!this.config.apiKey) {
      throw new Error('MFA_AUTH_API_KEY is not configured');
    }

    const fetch = resolveFetch();
    const url = `${this.config.apiBaseUrl}/api/v1/getVerifyCode`;

    const requestBody = {
      apiKey: this.config.apiKey,
      authType: 'ScanAuth',
      mode: '66',
    };

    console.log(`[cclawd-mfa-auth] Fetching verify code from: ${url}`);
    console.log(`[cclawd-mfa-auth] Request body:`, JSON.stringify(requestBody, null, 2));

    // 重试机制
    let lastError: Error | undefined;
    for (let i = 0; i < 3; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Cclawd/1.0 (mfa-auth)',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as DabbyVerifyCodeResponse;

        console.log(`[cclawd-mfa-auth] API response:`, JSON.stringify(data, null, 2));

        if (data.retCode !== 0) {
          throw new Error(`Dabby API error: ${data.message || data.retMessage} (code: ${data.retCode})`);
        }

        if (!data.data) {
          throw new Error('Dabby API returned empty data');
        }

        console.log(
          `[cclawd-mfa-auth] Verify code generated, certToken: ${data.data.certToken}, qrCodeUrl: ${data.data.qrCodeUrl}`,
        );

        // 追加 fromSource 参数
        const qrCodeUrlWithSource = data.data.qrCodeUrl.includes('?')
          ? `${data.data.qrCodeUrl}&fromSource=Cclawd`
          : `${data.data.qrCodeUrl}?fromSource=Cclawd`;

        console.log(`[cclawd-mfa-auth] QR code URL with fromSource: ${qrCodeUrlWithSource}`);

        return {
          ...data.data,
          qrCodeUrl: qrCodeUrlWithSource,
        };
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[cclawd-mfa-auth] Attempt ${i + 1} failed to get verify code: ${err.message}`);
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.error(`[cclawd-mfa-auth] Failed to get verify code after 3 attempts`);
    throw lastError;
  }

  /**
   * 获取二维码（别名，向后兼容）
   */
  async getQrCode(): Promise<DabbyVerifyCodeResponse['data']> {
    return this.getVerifyCode();
  }

  /**
   * 检查认证结果
   */
  async getAuthResult(certToken: string): Promise<{
    status: 'pending' | 'verified' | 'failed' | 'expired';
    error?: string;
    authObject?: { idNum: string; fullName: string };
  }> {
    if (!this.config.apiKey) {
      return { status: 'failed', error: 'MFA_AUTH_API_KEY is not configured' };
    }

    try {
      const fetch = resolveFetch();
      const url = `${this.config.apiBaseUrl}/api/v1/checkAuthStatus`;

      const requestBody = {
        apiKey: this.config.apiKey,
        certToken,
      };

      console.log(`[cclawd-mfa-auth] Checking auth status for certToken: ${certToken}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Cclawd/1.0 (mfa-auth)',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as DabbyCheckAuthStatusResponse;

      console.log(`[cclawd-mfa-auth] CheckAuthStatus response:`, JSON.stringify(data, null, 2));

      if (data.retCode !== 0) {
        // 4401: 认证未完成
        if (data.retCode === 4401) {
          return { status: 'pending' };
        }
        throw new Error(`Dabby API error: ${data.message} (code: ${data.retCode})`);
      }

      if (data.data.authSuccess) {
        return { status: 'verified', authObject: data.data.authResult };
      }

      return { status: 'failed', error: data.data.message || '认证失败' };
    } catch (error: unknown) {
      const err = error as Error;
      console.error(`[cclawd-mfa-auth] Failed to get auth result: ${err.message}`);
      return { status: 'failed', error: err.message };
    }
  }

  /**
   * 检查二维码是否过期
   */
  async checkQrCodeExpired(certToken: string, expireTimeMs: number): Promise<boolean> {
    return Date.now() > expireTimeMs;
  }
}

/**
 * Dabby 客户端工厂
 */
class DabbyClientFactory {
  private static instance: DabbyClient | null = null;

  static getInstance(): DabbyClient {
    if (!this.instance) {
      this.instance = new DabbyClient();
      console.log('[DabbyClientFactory] Created new DabbyClient instance');
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log('[DabbyClientFactory] Reset DabbyClient instance');
  }
}

export const dabbyClient = DabbyClientFactory.getInstance();
