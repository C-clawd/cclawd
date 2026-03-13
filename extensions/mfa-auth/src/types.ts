export type AuthMethodType = "qr-code" | "image-captcha" | "sms" | "email";

export type AuthStatus = "pending" | "scanned" | "verified" | "failed" | "expired";

export interface AuthSession {
  sessionId: string;
  userId: string;
  authMethod: AuthMethodType;
  timestamp: number;
  originalContext: PendingAuthContext;
  certToken?: string;
  qrCodeUrl?: string;
  expireTimeMs?: number;
  authStatus?: AuthStatus;
  metadata?: Record<string, unknown>;
}

export type AuthTriggerType = "first_message" | "sensitive_operation";

export interface PendingAuthContext {
  sessionKey: string;
  senderId: string;
  commandBody: string;
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: number;
  toolName: string;
  toolParams: Record<string, unknown>;
  timestamp: number;
  pendingExecutionId?: string;
  triggerType?: AuthTriggerType;
}

export interface MfaConfig {
  timeout: number;
  verificationDuration: number;
  port: number;
  domain?: string;
  debug: boolean;
  sensitiveKeywords: string[];
  allowlistUsers: string[];
  enabledAuthMethods: AuthMethodType[];
  defaultAuthMethod: AuthMethodType;
  persistAuthStateDir?: string;
  requireAuthOnSensitiveOperation?: boolean;
  requireAuthOnFirstMessage?: boolean;
  firstMessageAuthDuration?: number;
  gatewayHost?: string;
  enableAuthNotification?: boolean;
}

export interface AuthMethodProvider {
  readonly methodType: AuthMethodType;
  readonly name: string;
  readonly description: string;

  initialize(session: AuthSession): Promise<void>;
  verify(sessionId: string, userInput?: string): Promise<AuthResult>;
  cleanup(sessionId: string): void;
  generateAuthPage(session: AuthSession, authUrl: string): Promise<string>;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  status?: AuthStatus;
}

export interface DabbyConfig {
  apiKey: string;
  apiBaseUrl: string;
  pollInterval: number;
}

export interface DabbyVerifyCodeResponse {
  retCode: number;
  retMessage: string;
  message?: string;
  data: {
    certToken: string;
    qrCodeUrl: string;
  };
}

export interface DabbyCheckAuthStatusResponse {
  retCode: number;
  message: string;
  data: {
    authSuccess: boolean;
    authResult: {
      idNum: string;
      fullName: string;
    };
    message: string;
  };
}
