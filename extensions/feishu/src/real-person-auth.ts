import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";

const REAL_PERSON_AUTH_API_BASE_URL = "https://cclawd.dbhl.cn";
const REAL_PERSON_AUTH_H5_BASE_URL = "https://h5.dabby.com.cn";
const MFA_AUTH_API_KEY = "MFA_AUTH_API_KEY";
const REAL_PERSON_AUTH_REQUEST_TIMEOUT_MS = 12_000;

type RealPersonApiResponse = {
  code?: number;
  retCode?: number;
  message?: string;
  msg?: string;
  data?: {
    certToken?: string;
    qrCodeUrl?: string;
    apiKey?: string;
    authSuccess?: boolean;
    message?: string;
  };
};

type RealPersonAuthRecord = {
  authenticated?: boolean;
  certToken?: string;
  successNotified?: boolean;
};

type RealPersonAuthStore = Record<string, RealPersonAuthRecord>;

function getResponseMessage(payload: RealPersonApiResponse, fallback: string): string {
  if (typeof payload.data?.message === "string" && payload.data.message.trim()) {
    return payload.data.message;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload.msg === "string" && payload.msg.trim()) {
    return payload.msg;
  }
  return fallback;
}

async function parseJsonResponse(response: Response, fallbackMessage: string): Promise<RealPersonApiResponse> {
  let payload: RealPersonApiResponse = {};
  try {
    payload = await response.json() as RealPersonApiResponse;
  } catch {
    if (!response.ok) {
      throw new Error(`${fallbackMessage}: ${response.status} ${response.statusText}`);
    }
    return {};
  }

  if (!response.ok) {
    throw new Error(getResponseMessage(payload, `${fallbackMessage}: ${response.status} ${response.statusText}`));
  }

  return payload;
}

async function requestJson(
  input: string | URL,
  init: RequestInit | undefined,
  fallbackMessage: string,
): Promise<RealPersonApiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REAL_PERSON_AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await parseJsonResponse(response, fallbackMessage);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`${fallbackMessage}: request timed out after ${REAL_PERSON_AUTH_REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function getVerifyCode(apiKey: string): Promise<{ certToken: string; qrCodeUrl: string }> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error("MFA_AUTH_API_KEY is required");
  }

  const payload = await requestJson(
    new URL("/api/v1/getVerifyCode", REAL_PERSON_AUTH_API_BASE_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: trimmedApiKey,
        authType: "ScanAuth",
        mode: "66",
      }),
    },
    "Failed to create verification QR code",
  );

  const certToken = typeof payload.data?.certToken === "string" ? payload.data.certToken : "";
  const qrCodeUrl = typeof payload.data?.qrCodeUrl === "string" ? payload.data.qrCodeUrl : "";
  if (!certToken || !qrCodeUrl) {
    throw new Error(getResponseMessage(payload, "Verification QR code response was incomplete"));
  }

  return { certToken, qrCodeUrl };
}

async function checkAuthStatus(apiKey: string, certToken: string): Promise<"success" | "pending" | "failed"> {
  const trimmedApiKey = apiKey.trim();
  const trimmedCertToken = certToken.trim();
  if (!trimmedApiKey) {
    throw new Error("MFA_AUTH_API_KEY is required");
  }
  if (!trimmedCertToken) {
    throw new Error("certToken is required");
  }

  const payload = await requestJson(
    new URL("/api/v1/checkAuthStatus", REAL_PERSON_AUTH_API_BASE_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: trimmedApiKey,
        certToken: trimmedCertToken,
      }),
    },
    "Failed to check verification status",
  );

  if (payload.data?.authSuccess === true) {
    return "success";
  }
  if (payload.retCode === 4401) {
    return "pending";
  }
  return "failed";
}

export type FeishuRealPersonAuthGateAction = "allow" | "allow-with-success" | "block";

export type FeishuRealPersonAuthGateResult =
  | { action: "allow" }
  | { action: "allow-with-success" }
  | { action: "block"; verificationUrl: string; certToken: string };

export type FeishuRealPersonAuthGateParams = {
  accountId: string;
  senderId: string;
  log: (message: string) => void;
  error: (message: string, err?: unknown) => void;
};

export type FeishuRealPersonAuthStatusParams = FeishuRealPersonAuthGateParams;
export type FeishuRealPersonAuthStatusResult =
  | { status: "success" }
  | { status: "pending"; verificationUrl: string; certToken: string }
  | { status: "failed" }
  | { status: "missing" };

function resolveRealPersonAuthStorePath(): string {
  return path.join(
    os.homedir(),
    ".openclaw",
    "cclawd-guard",
    "feishu-real-person-auth.json",
  );
}

async function readRealPersonAuthStore(
  authFilePath: string,
  error: (message: string, err?: unknown) => void,
): Promise<RealPersonAuthStore> {
  try {
    const content = await fs.readFile(authFilePath, "utf-8");
    return JSON.parse(content) as RealPersonAuthStore;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.mkdir(path.dirname(authFilePath), { recursive: true });
      await fs.writeFile(authFilePath, "{}", "utf-8");
      return {};
    }
    error(`Failed to read auth file: ${err.message}`, err);
    return {};
  }
}

async function writeRealPersonAuthStore(authFilePath: string, data: RealPersonAuthStore): Promise<void> {
  await fs.writeFile(authFilePath, JSON.stringify(data, null, 2), "utf-8");
}

function resolveMfaApiKey(log: (message: string) => void, error: (message: string, err?: unknown) => void): string {
  const envPath = path.join(os.homedir(), ".openclaw", ".env");
  dotenvConfig({ path: envPath });
  const apiKey = process.env[MFA_AUTH_API_KEY];
  log(`[real-person-auth] MFA_AUTH_API_KEY exists: ${!!apiKey}`);
  if (!apiKey) {
    error("MFA_AUTH_API_KEY not found in environment variables", undefined);
    throw new Error("MFA_AUTH_API_KEY not configured");
  }
  return apiKey;
}

function resolveVerificationUrl(certToken: string): string {
  const authH5BaseUrl = process.env.DABBY_AUTH_H5_BASE_URL || REAL_PERSON_AUTH_H5_BASE_URL;
  return `${authH5BaseUrl}/authhtml/index.html#/auth?certToken=${certToken}&fromSource=Cclawd`;
}

export async function checkFeishuRealPersonAuthStatus(
  params: FeishuRealPersonAuthStatusParams,
): Promise<FeishuRealPersonAuthStatusResult> {
  const authFilePath = resolveRealPersonAuthStorePath();
  const authData = await readRealPersonAuthStore(authFilePath, params.error);
  const userAuth = authData[params.senderId];
  if (!userAuth) {
    return { status: "missing" };
  }
  if (userAuth.authenticated) {
    return { status: "success" };
  }

  const certToken = userAuth.certToken?.trim() ?? "";
  if (!certToken) {
    return { status: "missing" };
  }

  const apiKey = resolveMfaApiKey(params.log, params.error);
  params.log(`[real-person-auth] checking auth status for certToken: ${certToken.slice(0, 8)}...`);
  const status = await checkAuthStatus(apiKey, certToken);
  params.log(`[real-person-auth] auth status: ${status}`);
  if (status === "success") {
    authData[params.senderId] = {
      authenticated: true,
      certToken,
      // Polling path will send success immediately.
      successNotified: true,
    };
    await writeRealPersonAuthStore(authFilePath, authData);
    return { status: "success" };
  }
  if (status === "pending") {
    return {
      status: "pending",
      verificationUrl: resolveVerificationUrl(certToken),
      certToken,
    };
  }
  return { status: "failed" };
}

export async function resolveFeishuRealPersonAuthGate(
  params: FeishuRealPersonAuthGateParams,
): Promise<FeishuRealPersonAuthGateResult> {
  try {
    const authFilePath = resolveRealPersonAuthStorePath();
    const authData = await readRealPersonAuthStore(authFilePath, params.error);
    const apiKey = resolveMfaApiKey(params.log, params.error);
    const authH5BaseUrl = process.env.DABBY_AUTH_H5_BASE_URL || REAL_PERSON_AUTH_H5_BASE_URL;
    params.log(`[real-person-auth] authH5BaseUrl: ${authH5BaseUrl}`);

    const userAuth = authData[params.senderId];
    if (userAuth?.authenticated) {
      if (!userAuth.successNotified) {
        authData[params.senderId] = {
          ...userAuth,
          successNotified: true,
        };
        await writeRealPersonAuthStore(authFilePath, authData);
        return { action: "allow-with-success" };
      }
      return { action: "allow" };
    }

    if (userAuth?.certToken) {
      params.log(`[real-person-auth] checking auth status for certToken: ${userAuth.certToken.slice(0, 8)}...`);
      const status = await checkAuthStatus(apiKey, userAuth.certToken);
      params.log(`[real-person-auth] auth status: ${status}`);

      if (status === "success") {
        authData[params.senderId] = {
          authenticated: true,
          certToken: userAuth.certToken,
          successNotified: true,
        };
        await writeRealPersonAuthStore(authFilePath, authData);
        return { action: "allow-with-success" };
      }

      if (status === "pending") {
        return {
          action: "block",
          verificationUrl: `${authH5BaseUrl}/authhtml/index.html#/auth?certToken=${userAuth.certToken}&fromSource=Cclawd`,
          certToken: userAuth.certToken,
        };
      }
    }

    params.log("[real-person-auth] calling getVerifyCode API...");
    const { certToken } = await getVerifyCode(apiKey);
    params.log(`[real-person-auth] got certToken: ${certToken.slice(0, 8)}...`);

    authData[params.senderId] = {
      authenticated: false,
      certToken,
      successNotified: false,
    };
    await writeRealPersonAuthStore(authFilePath, authData);

    return {
      action: "block",
      verificationUrl: `${authH5BaseUrl}/authhtml/index.html#/auth?certToken=${certToken}&fromSource=Cclawd`,
      certToken,
    };
  } catch (err: any) {
    params.error(`resolveFeishuRealPersonAuthGate error: ${err.message}`, err);
    throw err;
  }
}
