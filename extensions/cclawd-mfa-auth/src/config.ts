/**
 * Cclawd MFA Auth Plugin - Configuration Management
 */

import type { MfaConfig, DabbyConfig } from './types.js';

/**
 * 解析布尔类型环境变量
 */
function parseBooleanEnv(envValue?: string): boolean {
  if (!envValue) return false;
  const value = envValue.toLowerCase().trim();
  return value === 'true' || value === '1' || value === 'yes';
}

/**
 * 解析字符串数组环境变量
 */
function parseStringArray(envValue?: string): string[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * MFA 配置
 */
export const config: MfaConfig = {
  debug: parseBooleanEnv(process.env.MFA_DEBUG) || true,
  timeout: 5 * 60 * 1000, // 5 分钟
  verificationDuration:
    Number.parseInt(process.env.MFA_VERIFICATION_DURATION || '', 10) || 2 * 60 * 1000, // 2 分钟
  domain: process.env.MFA_AUTH_DOMAIN || '',
  allowlistUsers: parseStringArray(process.env.MFA_ALLOWLIST_USERS),
  enabledAuthMethods: ['qr-code'],
  defaultAuthMethod: 'qr-code',
  persistAuthStateDir: process.env.MFA_AUTH_STATE_DIR || '~/.openclaw/mfa-auth/',
  requireAuthOnSensitiveOperation:
    process.env.MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION === undefined
      ? true
      : parseBooleanEnv(process.env.MFA_REQUIRE_AUTH_ON_SENSITIVE_OPERATION),
  sensitiveKeywords: parseStringArray(process.env.MFA_SENSITIVE_KEYWORDS) || [
    'rm',
    'delete',
    'drop',
    'shutdown',
    'reboot',
    'format',
    'fdisk',
  ],
  requireAuthOnFirstMessage:
    parseBooleanEnv(process.env.MFA_REQUIRE_AUTH_ON_FIRST_MESSAGE) ?? true,
  firstMessageAuthDuration:
    Number.parseInt(process.env.MFA_FIRST_MESSAGE_AUTH_DURATION || '', 10) || 24 * 60 * 60 * 1000, // 24 小时
  gatewayHost: process.env.MFA_GATEWAY_HOST || '127.0.0.1',
  enableAuthNotification: parseBooleanEnv(process.env.MFA_ENABLE_AUTH_NOTIFICATION) ?? true,
};

/**
 * Dabby API 配置
 */
export const dabbyConfig: DabbyConfig = {
  apiKey: process.env.MFA_AUTH_API_KEY || '',
  apiBaseUrl: process.env.DABBY_API_BASE_URL || '',
  pollInterval: 2000, // 2 秒
};

/**
 * 打印配置信息（调试模式）
 */
if (config.debug) {
  console.log('[cclawd-mfa-auth] Configuration loaded:');
  console.log(`  - requireAuthOnFirstMessage: ${config.requireAuthOnFirstMessage}`);
  console.log(`  - requireAuthOnSensitiveOperation: ${config.requireAuthOnSensitiveOperation}`);
  console.log(`  - sensitiveKeywords: ${config.sensitiveKeywords.join(', ')}`);
  console.log(`  - firstMessageAuthDuration: ${config.firstMessageAuthDuration}ms`);
  console.log(`  - verificationDuration: ${config.verificationDuration}ms`);
  console.log(`  - gatewayHost: ${config.gatewayHost}`);
  console.log(`  - enableAuthNotification: ${config.enableAuthNotification}`);
}
