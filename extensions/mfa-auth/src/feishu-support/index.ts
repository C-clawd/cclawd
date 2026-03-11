import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/feishu";

// --- Types ---

export type FeishuDomain = "feishu" | "lark" | (string & {});

export type FeishuConfig = {
  appId?: string;
  appSecret?: string | { source: string; id: string };
  domain?: FeishuDomain;
  accounts?: Record<string, FeishuAccountConfig>;
  defaultAccount?: string;
  // 其他字段忽略
};

export type FeishuAccountConfig = {
  appId?: string;
  appSecret?: string | { source: string; id: string };
  domain?: FeishuDomain;
  // 其他字段忽略
};

export type ResolvedFeishuAccount = {
  accountId: string;
  configured: boolean;
  appId?: string;
  appSecret?: string;
  domain: FeishuDomain;
};

// --- Secret Handling ---

function resolveSecret(value: unknown, path: string): string | undefined {
  return normalizeResolvedSecretInputString({ value, path });
}

// --- Accounts ---

const DEFAULT_ACCOUNT_ID = "default";

function normalizeAccountId(id: string): string {
  return id.trim().toLowerCase();
}

export function resolveFeishuAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedFeishuAccount {
  const feishuCfg = params.cfg.channels?.feishu as FeishuConfig | undefined;
  const accounts = feishuCfg?.accounts || {};

  // 1. Determine Account ID
  let accountId = DEFAULT_ACCOUNT_ID;
  if (params.accountId && params.accountId.trim()) {
    accountId = normalizeAccountId(params.accountId);
  } else if (feishuCfg?.defaultAccount) {
    accountId = normalizeAccountId(feishuCfg.defaultAccount);
  } else if (Object.keys(accounts).length > 0) {
    // Sort keys to be deterministic
    const ids = Object.keys(accounts).sort();
    accountId = ids[0];
  }

  // 2. Merge Config
  // Base config
  const baseAppId = feishuCfg?.appId;
  const baseAppSecret = feishuCfg?.appSecret;
  const baseDomain = feishuCfg?.domain || "feishu";

  // Account config
  const accountCfg = accounts[accountId];

  // Merge: Account overrides Base
  const appIdRaw = accountCfg?.appId || baseAppId;
  const appSecretRaw = accountCfg?.appSecret || baseAppSecret;
  const domainRaw = accountCfg?.domain || baseDomain;

  // 3. Resolve Secrets
  const appId = typeof appIdRaw === "string" ? appIdRaw.trim() : undefined;
  const appSecret = resolveSecret(appSecretRaw, `channels.feishu.accounts.${accountId}.appSecret`);

  const configured = !!(appId && appSecret);

  return {
    accountId,
    configured,
    appId,
    appSecret,
    domain: domainRaw,
  };
}

// --- Client ---

// Simple cache to avoid recreating clients
const clientCache = new Map<string, Lark.Client>();

export function createFeishuClient(account: ResolvedFeishuAccount): Lark.Client {
  if (!account.appId || !account.appSecret) {
    throw new Error(`Feishu credentials not configured for account "${account.accountId}"`);
  }

  const cacheKey = `${account.accountId}:${account.appId}`;
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!;
  }

  let domain = Lark.Domain.Feishu;
  if (account.domain === "lark") {
    domain = Lark.Domain.Lark;
  } else if (account.domain && account.domain !== "feishu") {
    // Custom domain support not strictly typed in SDK enum but supported in constructor
    domain = account.domain as any;
  }

  const client = new Lark.Client({
    appId: account.appId,
    appSecret: account.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain,
    // Disable default logger to avoid noise, or use console
    loggerLevel: Lark.LoggerLevel.info,
  });

  clientCache.set(cacheKey, client);
  return client;
}

// --- Utils ---

export function resolveFeishuSendTarget(params: {
  cfg: ClawdbotConfig;
  to: string;
  accountId?: string;
}) {
  const target = params.to.trim();
  const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId });

  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);

  // 1. Strip common provider prefixes like "feishu:", "lark:"
  let rawTarget = target.replace(/^(feishu|lark):/i, "");

  // 2. Strip "user:" prefix which might be present in OpenClaw user IDs
  if (
    rawTarget.toLowerCase().startsWith("user:") &&
    !rawTarget.toLowerCase().startsWith("user_id:")
  ) {
    rawTarget = rawTarget.substring(5);
  }

  // 3. Determine receive_id_type and strip specific type prefixes
  let receiveIdType: "open_id" | "user_id" | "union_id" | "chat_id" | "email" = "open_id";
  let receiveId = rawTarget;

  if (rawTarget.toLowerCase().startsWith("chat_id:")) {
    receiveIdType = "chat_id";
    receiveId = rawTarget.substring(8);
  } else if (rawTarget.toLowerCase().startsWith("user_id:")) {
    receiveIdType = "user_id";
    receiveId = rawTarget.substring(8);
  } else if (rawTarget.toLowerCase().startsWith("union_id:")) {
    receiveIdType = "union_id";
    receiveId = rawTarget.substring(9);
  } else if (rawTarget.toLowerCase().startsWith("email:")) {
    receiveIdType = "email";
    receiveId = rawTarget.substring(6);
  } else if (rawTarget.toLowerCase().startsWith("open_id:")) {
    receiveIdType = "open_id";
    receiveId = rawTarget.substring(8);
  } else {
    // No explicit prefix, try to infer from format
    if (rawTarget.startsWith("ou_")) {
      receiveIdType = "open_id";
    } else if (rawTarget.startsWith("oc_")) {
      receiveIdType = "chat_id";
    } else if (rawTarget.startsWith("on_")) {
      receiveIdType = "union_id";
    } else if (rawTarget.includes("@")) {
      receiveIdType = "email";
    }
    // Default fallback is open_id, and receiveId remains rawTarget
  }

  return {
    client,
    receiveId,
    receiveIdType,
  };
}

export { normalizeResolvedSecretInputString };
