import { dabbyConfig } from "./config.js";
import type {
  DabbyConfig,
  DabbyVerifyCodeResponse,
  DabbyCheckAuthStatusResponse,
} from "./types.js";

const resolveFetch = (): typeof fetch => {
  const resolved = globalThis.fetch;
  if (!resolved) {
    throw new Error("fetch is not available in this environment");
  }
  return resolved;
};

export class DabbyClient {
  constructor(private config: DabbyConfig = dabbyConfig) {}

  async getVerifyCode(): Promise<DabbyVerifyCodeResponse["data"]> {
    if (!this.config.apiKey) {
      throw new Error("MFA_AUTH_API_KEY is not configured");
    }

    const fetch = resolveFetch();
    const url = `${this.config.apiBaseUrl}/api/v1/getVerifyCode`;

    const requestBody = {
      apiKey: this.config.apiKey,
      authType: "ScanAuth",
      mode: "66",
    };

    console.log(`[mfa-auth] Fetching verify code from: ${url}`);
    console.log(`[mfa-auth] Request body:`, JSON.stringify(requestBody, null, 2));

    let lastError: any;
    for (let i = 0; i < 3; i++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "OpenClaw/1.0 (mfa-auth)",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = (await response.json()) as DabbyVerifyCodeResponse;

        console.log(`[mfa-auth] API response:`, JSON.stringify(data, null, 2));

        if (data.retCode !== 0) {
          throw new Error(`Dabby API error: ${data.message} (code: ${data.retCode})`);
        }

        if (!data.data) {
          throw new Error("Dabby API returned empty data");
        }

        console.log(
          `[mfa-auth] Verify code generated, certToken: ${data.data.certToken}, qrCodeUrl: ${data.data.qrCodeUrl}`,
        );

        // Append fromSource parameter to qrCodeUrl
        const qrCodeUrlWithSource = data.data.qrCodeUrl.includes("?")
          ? `${data.data.qrCodeUrl}&fromSource=Cclawd`
          : `${data.data.qrCodeUrl}?fromSource=Cclawd`;

        console.log(`[mfa-auth] QR code URL with fromSource: ${qrCodeUrlWithSource}`);

        return {
          ...data.data,
          qrCodeUrl: qrCodeUrlWithSource,
        };
      } catch (error: any) {
        console.error(`[mfa-auth] Attempt ${i + 1} failed to get verify code: ${error.message}`);
        if (error.cause) {
          console.error(`[mfa-auth] Failure cause:`, error.cause);
        }
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.error(`[mfa-auth] Failed to get verify code after 3 attempts`);
    throw lastError;
  }

  // Alias for backward compatibility if needed by other files, or just refactor them too.
  // The plan said "Rename or keep original name". I'll keep this alias to minimize changes in other files for now,
  // but I'll also update the other files to use getVerifyCode if I can.
  // Actually, I'll update other files to use getVerifyCode as per plan step 4.
  // But keeping it as alias is safer during transition.
  async getQrCode(): Promise<DabbyVerifyCodeResponse["data"]> {
    return this.getVerifyCode();
  }

  async getAuthResult(certToken: string): Promise<{
    status: "pending" | "verified" | "failed" | "expired";
    error?: string;
    authObject?: { idNum: string; fullName: string };
  }> {
    if (!this.config.apiKey) {
      return { status: "failed", error: "MFA_AUTH_API_KEY is not configured" };
    }

    try {
      const fetch = resolveFetch();
      const url = `${this.config.apiBaseUrl}/api/v1/checkAuthStatus`;

      const requestBody = {
        apiKey: this.config.apiKey,
        certToken,
      };

      console.log(`[mfa-auth] Checking auth status for certToken: ${certToken}`);
      console.log(`[mfa-auth] CheckAuthStatus request body:`, JSON.stringify(requestBody, null, 2));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OpenClaw/1.0 (mfa-auth)",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as DabbyCheckAuthStatusResponse;

      console.log(`[mfa-auth] CheckAuthStatus response:`, JSON.stringify(data, null, 2));

      if (data.retCode !== 0) {
        if (data.retCode === 4401) {
          return { status: "pending" };
        }
        throw new Error(`Dabby API error: ${data.message} (code: ${data.retCode})`);
      }

      if (data.data.authSuccess) {
        return { status: "verified", authObject: data.data.authResult };
      }

      return { status: "failed", error: data.data.message || "认证失败" };
    } catch (error: any) {
      console.error(`[mfa-auth] Failed to get auth result: ${error.message}`);
      return { status: "failed", error: error.message };
    }
  }

  async checkQrCodeExpired(certToken: string, expireTimeMs: number): Promise<boolean> {
    return Date.now() > expireTimeMs;
  }
}

class DabbyClientFactory {
  private static instance: DabbyClient | null = null;

  static getInstance(): DabbyClient {
    if (!this.instance) {
      this.instance = new DabbyClient();
      console.log("[DabbyClientFactory] Created new DabbyClient instance");
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log("[DabbyClientFactory] Reset DabbyClient instance");
  }
}

export const dabbyClient = DabbyClientFactory.getInstance();
