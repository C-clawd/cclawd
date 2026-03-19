/**
 * Cclawd MFA Auth Plugin - Type Definitions
 */

// ==================== 认证方法类型 ====================

export type AuthMethodType = 'qr-code' | 'image-captcha' | 'sms' | 'email';

export type AuthStatus = 'pending' | 'scanned' | 'verified' | 'failed' | 'expired';

// ==================== 认证会话 ====================

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

// ==================== 认证触发类型 ====================

export type AuthTriggerType = 'first_message' | 'sensitive_operation';

// ==================== 待认证上下文 ====================

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

// ==================== 配置类型 ====================

export interface MfaConfig {
  timeout: number;
  verificationDuration: number;
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

export interface DabbyConfig {
  apiKey: string;
  apiBaseUrl: string;
  pollInterval: number;
}

// ==================== 认证提供者接口 ====================

export interface AuthMethodProvider {
  readonly methodType: AuthMethodType;
  readonly name: string;
  readonly description: string;

  initialize(session: AuthSession): Promise<void>;
  verify(sessionId: string, userInput?: string): Promise<AuthResult>;
  cleanup(sessionId: string): void;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  status?: AuthStatus;
}

// ==================== Dabby API 响应类型 ====================

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

// ==================== 轮询管理 ====================

export interface PollingTask {
  taskId: string;
  sessionId: string;
  userId: string;
  triggerType: AuthTriggerType;
  startTime: number;
  interval: NodeJS.Timeout;
  context: {
    channel?: string;
    accountId?: string;
    to?: string;
    sessionKey?: string;
    isReauth: boolean;
  };
}

// ==================== 会话解析 ====================

export interface ResolvedSession {
  userId: string;
  channel?: string;
  accountId?: string;
  to?: string;
  sessionKey: string;
}

// ==================== 敏感操作检测 ====================

export interface SensitiveCheckResult {
  isSensitive: boolean;
  preview: string;
  matchedKeywords?: string[];
}

// ==================== 通知信息 ====================

export interface NotificationInfo {
  triggerType: AuthTriggerType;
  isReauth: boolean;
}
