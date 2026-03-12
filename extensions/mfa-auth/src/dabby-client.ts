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
          throw new Error(`Dabby API error: ${data.retMessage} (code: ${data.retCode})`);
        }

        // data.data might be null if failed, but retCode check handles it usually.
        // Checking just in case typescript needs it or API behavior is weird.
        if (!data.data) {
          throw new Error("Dabby API returned empty data");
        }

        console.log(`[mfa-auth] Verify code generated, certToken: ${data.data.certToken}`);

        return data.data;
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

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OpenClaw/1.0 (mfa-auth)",
        },
        body: JSON.stringify({
          apiKey: this.config.apiKey,
          certToken,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as DabbyCheckAuthStatusResponse;

      // retCode !== 0 implies failure or pending?
      // User said: "retCode 为 0是成功，其他状态都是失败"
      // And "这个 /api/v1/checkAuthStatus 接口参考 旧的接口 /v2/api/authhist 的写法及状态码"
      // Old interface had 4401 for pending.
      // If new interface strictly follows "0 is success, others are failure", does it have a pending state?
      // Usually polling interfaces need a pending state.
      // The user instruction implies the structure is similar.
      // If the user says "refer to old interface", maybe they mean the LOGIC is similar, but retCode 0 is success.
      // BUT if "others are failure", then there is no pending code?
      // Wait, if it returns failure immediately, polling stops.
      // "接口都是：retCode 为 0是成功，其他状态都是失败" -> This sounds like immediate success/fail.
      // However, for QR code scanning, it must be async.
      // Maybe "失败" here includes "not verified yet"?
      // Let's look at the old code:
      // if (data.retCode !== 0) { if (data.retCode === 4401) return { status: "pending" }; ... }
      // If the new API has NO pending code, how do we poll?
      // Maybe retCode is 0, but authSuccess is false?
      // Let's check the user provided example:
      // 返回：
      // {
      //     "code": 200,
      //     "message": "success",
      //     "data": {
      //         "authSuccess": true,
      //         "authResult": {},
      //         "message": "成功"
      //     }
      // }
      // Wait, the user provided example uses `code: 200`.
      // BUT later the user said "接口都是：retCode 为 0是成功".
      // I should follow "retCode 为 0是成功".
      // The user might have given an example that contradicts the "retCode" statement or I should look at the specific example field names.
      // User example 1:
      // { "code": 500, "message": "...", "data": null }
      // User example 2:
      // { "code": 200, "message": "success", "data": { "authSuccess": true ... } }
      //
      // BUT then user said: "接口都是：retCode 为 0是成功，其他状态都是失败"
      // AND "这个 /api/v1/checkAuthStatus 接口参考 旧的接口 /v2/api/authhist 的写法及状态码"
      // This is conflicting.
      //
      // Possibility A: The user's provided JSON example in the first prompt was from their wrapper or proxy, and the REAL backend returns retCode.
      // Possibility B: The user is correcting me that I should expect `retCode` instead of `code`.
      //
      // Let's assume the user's latest instruction is the source of truth: "retCode 为 0是成功".
      // And for checkAuthStatus, it mimics `authhist`.
      // In `authhist` (old):
      // retCode 0 -> success (check authData.resCode)
      // retCode 4401 -> pending
      //
      // If the new API follows `authhist` structure:
      // It might return retCode 4401 for pending too?
      // User said "其他状态都是失败" (others are failure). This suggests NO pending state in retCode?
      //
      // OR, maybe "authSuccess" in data indicates if it's finished?
      //
      // Let's look at the user's example response for `checkAuthStatus` again:
      // {
      //     "code": 200, (Maybe this is retCode in reality?)
      //     "message": "success",
      //     "data": {
      //         "authSuccess": true,
      //         "authResult": {},
      //         "message": "成功"
      //     }
      // }
      //
      // If I treat `retCode` as the top level status.
      // If `retCode` != 0, it's an API error (or pending if I assume it mimics old one exactly).
      // But if "其他状态都是失败", then maybe pending is NOT a failure, or maybe it IS a failure code that we treat as pending?
      //
      // Let's assume for now:
      // 1. We check `retCode`. If it is 4401, treat as pending (referencing old `authhist` behavior as requested).
      // 2. If it is 0, we check `data.authSuccess`.
      // 3. If `data.authSuccess` is false, is it pending or failed?
      //    In the old `authhist`, `resCode` 0 was success.
      //    Here we have `authSuccess` boolean.
      //    If `authSuccess` is false, it probably means "not verified yet" (pending) OR "verification failed".
      //    The user didn't clarify this.
      //    However, usually `checkAuthStatus` polling implies that if it's not success, we continue polling UNLESS it's a definitive failure (like rejected).
      //
      // Let's look at the types I added:
      // data: { authSuccess: boolean; authResult: ...; message: string; }
      //
      // Strategy:
      // - If retCode == 4401 -> Pending (Trusting "refer to old interface")
      // - If retCode != 0 && retCode != 4401 -> Error/Fail.
      // - If retCode == 0:
      //   - If data.authSuccess == true -> Verified.
      //   - If data.authSuccess == false ->
      //     - Is this pending or failed?
      //     - If the user says "others are failure", maybe authSuccess=false is failure.
      //     - BUT if it's polling, we need a pending state.
      //     - Let's assume authSuccess=false means "not successful YET" or "failed".
      //     - I will treat it as "failed" for now based on "others are failure" logic applied to authSuccess?
      //     - Wait, if I return "failed", polling stops.
      //     - If the user is scanning the QR code, it takes time. We MUST have a pending state.
      //
      // Let's try to be robust:
      // If retCode == 4401 -> Pending.
      // If retCode == 0 and authSuccess == false ->
      //    Check `data.message`. If it says "waiting" or similar? No reliable way.
      //    Let's assume `authSuccess: false` means "failed" or "expired" or "rejected", stopping the poll.
      //    AND `retCode: 4401` is the ONLY way to signal "pending".
      //
      // This seems to match "refer to old interface" (where 4401 was pending).

      const responseData = (await response.json()) as DabbyCheckAuthStatusResponse;

      if (responseData.retCode !== 0) {
        if (responseData.retCode === 4401) {
          return { status: "pending" };
        }
        throw new Error(
          `Dabby API error: ${responseData.retMessage} (code: ${responseData.retCode})`,
        );
      }

      if (responseData.data.authSuccess) {
        return { status: "verified", authObject: responseData.data.authResult };
      }

      // If retCode is 0 but authSuccess is false.
      // We'll return failed.
      return { status: "failed", error: responseData.data.message || "认证失败" };
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
