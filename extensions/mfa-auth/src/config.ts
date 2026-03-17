import type { MfaConfig, DabbyConfig } from "./types.js";

function parseBooleanEnv(envValue?: string): boolean {
  if (!envValue) return false;
  const value = envValue.toLowerCase().trim();
  return value === "true" || value === "1" || value === "yes";
}

function parseStringArray(envValue?: string): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export const config: MfaConfig = {
  debug: true,
  timeout: 5 * 60 * 1000,
  verificationDuration:
    Number.parseInt(process.env.MFA_VERIFICATION_DURATION || "", 10) || 2 * 60 * 1000,
  domain: process.env.MFA_AUTH_DOMAIN || "",
  allowlistUsers: [],
  enabledAuthMethods: ["qr-code"],
  defaultAuthMethod: "qr-code",
  persistAuthStateDir: process.env.MFA_AUTH_STATE_DIR || "~/.openclaw/mfa-auth/",
  requireAuthOnSensitiveOperation:
    process.env.MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION === undefined
      ? true
      : parseBooleanEnv(process.env.MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION),
  sensitiveKeywords: parseStringArray(process.env.MFA_SENSITIVE_KEYWORDS) || [],
  requireAuthOnFirstMessage: parseBooleanEnv(process.env.MFA_REQUIRE_AUTH_ON_FIRST_MESSAGE) ?? true,
  firstMessageAuthDuration:
    Number.parseInt(process.env.MFA_FIRST_MESSAGE_AUTH_DURATION || "", 10) || 24 * 60 * 60 * 1000,
  gatewayHost: process.env.MFA_GATEWAY_HOST || "127.0.0.1",
  enableAuthNotification: parseBooleanEnv(process.env.MFA_ENABLE_AUTH_NOTIFICATION) ?? false,
};

export const dabbyConfig: DabbyConfig = {
  apiKey: process.env.MFA_AUTH_API_KEY || "",
  apiBaseUrl: process.env.DABBY_API_BASE_URL || "",
  pollInterval: 2000,
};
