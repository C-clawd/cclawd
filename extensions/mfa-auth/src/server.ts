import type { AuthSession } from "./types.js";

let notifyCallback: ((session: AuthSession) => void | Promise<void>) | null = null;

export function setNotifyCallback(callback: (session: AuthSession) => void | Promise<void>): void {
  console.log("[mfa-auth] setNotifyCallback called");
  notifyCallback = callback;
}

export async function notifyVerificationSuccess(session: AuthSession): Promise<void> {
  if (notifyCallback) {
    await notifyCallback(session);
  }
}
