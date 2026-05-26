import os from "node:os";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";

export const CCLAWD_REAL_PERSON_AUTH_ENABLED_KEY = "CCLAWD_REAL_PERSON_AUTH_ENABLED";

export function parseRealPersonAuthEnabledFlag(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function isRealPersonAuthEnabled(): boolean {
  const envPath = path.join(os.homedir(), ".openclaw", ".env");
  dotenvConfig({ path: envPath });
  return parseRealPersonAuthEnabledFlag(process.env[CCLAWD_REAL_PERSON_AUTH_ENABLED_KEY]);
}
