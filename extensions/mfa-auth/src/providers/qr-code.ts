import { authManager } from "../auth-manager.js";
import { config } from "../config.js";
import { dabbyClient } from "../dabby-client.js";
import type { AuthSession, AuthResult } from "../types.js";
import { BaseAuthProvider } from "./base.js";

export class QrCodeAuthProvider extends BaseAuthProvider {
  readonly methodType = "qr-code" as const;
  readonly name = "QR Code Authentication";
  readonly description = "Scan QR code to authenticate";

  async initialize(session: AuthSession): Promise<void> {
    try {
      const tokenInfo = await dabbyClient.getVerifyCode();

      authManager.updateAuthStatus(session.sessionId, "pending");
      session.certToken = tokenInfo.certToken;
      session.qrCodeUrl = tokenInfo.qrCodeUrl;
      session.expireTimeMs = Date.now() + 5 * 60 * 1000;
      session.authStatus = "pending";

      console.log(`[mfa-auth] QR code initialized for session ${session.sessionId}`);
    } catch (error) {
      console.error(`[mfa-auth] Failed to initialize QR code: ${error}`);
      throw error;
    }
  }

  async verify(sessionId: string, userInput?: string): Promise<AuthResult> {
    const session = authManager.getSession(sessionId);
    if (!session) {
      return { success: false, error: "Session not found", status: "failed" };
    }

    if (!session.certToken) {
      return { success: false, error: "QR code not initialized", status: "failed" };
    }

    if (session.expireTimeMs && Date.now() > session.expireTimeMs) {
      authManager.updateAuthStatus(sessionId, "expired");
      return { success: false, error: "QR code expired", status: "expired" };
    }

    try {
      const result = await dabbyClient.getAuthResult(session.certToken);

      if (result.status === "verified") {
        authManager.updateAuthStatus(sessionId, "verified");
        return { success: true, status: "verified" };
      }

      if (result.status === "failed") {
        authManager.updateAuthStatus(sessionId, "failed");
        return { success: false, error: result.error || "Authentication failed", status: "failed" };
      }

      return { success: false, status: result.status };
    } catch (error) {
      console.error(`[mfa-auth] Failed to verify QR code: ${error}`);
      return { success: false, error: String(error), status: "failed" };
    }
  }
}

class QrCodeAuthProviderFactory {
  private static instance: QrCodeAuthProvider | null = null;

  static getInstance(): QrCodeAuthProvider {
    if (!this.instance) {
      this.instance = new QrCodeAuthProvider();
      console.log("[QrCodeAuthProviderFactory] Created new QrCodeAuthProvider instance");
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log("[QrCodeAuthProviderFactory] Reset QrCodeAuthProvider instance");
  }
}

export const qrCodeAuthProvider = QrCodeAuthProviderFactory.getInstance();
