import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { resolveFeishuAccount } from "../../feishu/src/accounts.js";
import { createFeishuClient } from "../../feishu/src/client.js";
import { getFeishuRuntime } from "../../feishu/src/runtime.js";
import { assertFeishuMessageApiSuccess, toFeishuSendResult } from "../../feishu/src/send-result.js";
import { resolveFeishuSendTarget } from "../../feishu/src/send-target.js";
import type { AuthSession } from "./types.js";

class NotificationService {
  private static instance: NotificationService;
  private cfg?: ClawdbotConfig;

  private constructor() {}

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  setConfig(cfg: ClawdbotConfig): void {
    this.cfg = cfg;
  }

  async sendAuthNotification(session: AuthSession, message: string): Promise<void> {
    const { channel, accountId, to } = session.originalContext;

    if (!this.cfg) {
      console.warn("[mfa-auth] Config not set, skipping notification");
      return;
    }

    if (channel === "webchat" || channel === "web") {
      console.log(`[mfa-auth] Web/webchat channel: sending notification via WebSocket`);
      await this.sendToWebChat(session, message);
      return;
    }

    if (channel === "feishu") {
      await this.sendToFeishu(session, message);
      return;
    }

    console.warn(`[mfa-auth] Unsupported channel: ${channel}`);
  }

  private async sendToWebChat(session: AuthSession, message: string): Promise<void> {
    const { sessionKey } = session.originalContext;
    const port = this.cfg?.gateway?.port || 18789;
    const token = this.cfg?.gateway?.auth?.token;

    console.log(`[mfa-auth] sendToWebChat: sessionKey=${sessionKey}, port=${port}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsModule = await import("ws");
    const WebSocket = wsModule.default || (wsModule as any).WebSocket;

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = new WebSocket(`ws://127.0.0.1:${port}`);

      const handshakeId = `mfa-handshake-${Date.now()}`;
      const sessionsListId = `mfa-sessions-${Date.now()}`;
      let currentInjectId = "";
      let candidateSessionKeys: string[] = [];
      let injectIndex = 0;

      const sendInject = (targetSessionKey: string) => {
        currentInjectId = `mfa-req-${Date.now()}-${injectIndex}`;
        const payload = {
          type: "req",
          id: currentInjectId,
          method: "chat.inject",
          params: {
            sessionKey: targetSessionKey,
            message,
            label: "MFA Auth",
          },
        };
        ws.send(JSON.stringify(payload));
      };

      ws.on("open", () => {
        const handshake = {
          type: "req",
          id: handshakeId,
          method: "connect",
          params: {
            minProtocol: 1,
            maxProtocol: 3,
            client: {
              id: "gateway-client",
              version: "1.0.0",
              platform: "node",
              mode: "backend",
            },
            auth: token ? { token } : undefined,
            role: "operator",
            scopes: ["operator.admin"],
          },
        };
        ws.send(JSON.stringify(handshake));
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.on("message", (data: any) => {
        try {
          const response = JSON.parse(data.toString());

          if (response.id === handshakeId) {
            if (!response.ok) {
              ws.close();
              reject(new Error(`Handshake failed: ${JSON.stringify(response.error)}`));
              return;
            }
            const listPayload = {
              type: "req",
              id: sessionsListId,
              method: "sessions.list",
              params: {
                limit: 200,
                includeGlobal: true,
                includeUnknown: true,
              },
            };
            ws.send(JSON.stringify(listPayload));
            return;
          }

          if (response.id === sessionsListId) {
            if (!response.ok) {
              ws.close();
              reject(new Error(`sessions.list failed: ${JSON.stringify(response.error)}`));
              return;
            }
            candidateSessionKeys = this.resolveWebchatSessionCandidates({
              requestedSessionKey: sessionKey,
              userId: session.userId,
              targetTo: session.originalContext.to,
              sessionsListResult: response.result,
            });
            if (candidateSessionKeys.length === 0) {
              ws.close();
              reject(new Error("No candidate webchat sessions found"));
              return;
            }
            console.log(
              `[mfa-auth] candidate webchat sessions: ${candidateSessionKeys.join(", ")}`,
            );
            injectIndex = 0;
            sendInject(candidateSessionKeys[injectIndex]);
            return;
          }

          if (response.id === currentInjectId) {
            if (response.ok && !response.error) {
              ws.close();
              resolve();
              return;
            }
            const errMsg = String(response?.error?.message ?? "").toLowerCase();
            const shouldTryNext = errMsg.includes("session not found");
            if (shouldTryNext && injectIndex + 1 < candidateSessionKeys.length) {
              injectIndex += 1;
              sendInject(candidateSessionKeys[injectIndex]);
              return;
            }
            ws.close();
            reject(
              new Error(
                `Chat inject failed after trying [${candidateSessionKeys.join(", ")}]: ${JSON.stringify(response.error)}`,
              ),
            );
          }
        } catch (e) {
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.on("error", (err: any) => {
        reject(err);
      });

      setTimeout(() => {
        try {
          ws.terminate();
        } catch (e) {}
        reject(new Error("WebSocket timeout"));
      }, 5000);
    });
  }

  private resolveWebchatSessionCandidates(params: {
    requestedSessionKey?: string;
    userId: string;
    targetTo?: string;
    sessionsListResult: unknown;
  }): string[] {
    const normalizedTarget = String(params.targetTo || params.userId || "")
      .trim()
      .toLowerCase();
    const resultObject =
      params.sessionsListResult && typeof params.sessionsListResult === "object"
        ? (params.sessionsListResult as Record<string, unknown>)
        : undefined;
    const sessionsRaw = Array.isArray(resultObject?.sessions) ? resultObject.sessions : [];
    const webchatRows = sessionsRaw
      .map((row) =>
        row && typeof row === "object" ? (row as Record<string, unknown>) : undefined,
      )
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => {
        const ch = String(row.channel ?? "").trim().toLowerCase();
        const dc = row.deliveryContext as Record<string, unknown> | undefined;
        const dcChannel = String(dc?.channel ?? "").trim().toLowerCase();
        return ch === "webchat" || ch === "web" || dcChannel === "webchat" || dcChannel === "web";
      });

    const exactRows = webchatRows.filter((row) => {
      const dc = row.deliveryContext as Record<string, unknown> | undefined;
      const peer = String(dc?.to ?? row.lastTo ?? "").trim().toLowerCase();
      return peer.length > 0 && peer === normalizedTarget;
    });
    const fallbackRows = webchatRows.filter((row) => !exactRows.includes(row));
    
    // Fuzzy match: include any webchat session that contains the userId in its key
    const fuzzyRows = webchatRows.filter((row) => {
      const key = String(row.key ?? "").toLowerCase();
      // Ensure we don't duplicate rows already found
      return key.includes(normalizedTarget) && !exactRows.includes(row) && !fallbackRows.includes(row);
    });

    const sortByUpdatedAtDesc = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aa = typeof a.updatedAt === "number" ? a.updatedAt : 0;
      const bb = typeof b.updatedAt === "number" ? b.updatedAt : 0;
      return bb - aa;
    };
    exactRows.sort(sortByUpdatedAtDesc);
    fallbackRows.sort(sortByUpdatedAtDesc);
    fuzzyRows.sort(sortByUpdatedAtDesc);

    const keys = [
      params.requestedSessionKey,
      ...exactRows.map((row) => String(row.key ?? "").trim()),
      ...fallbackRows.map((row) => String(row.key ?? "").trim()),
      ...fuzzyRows.map((row) => String(row.key ?? "").trim()),
      // Add standard webchat patterns
      `agent:main:${normalizedTarget}`,
      `webchat:${normalizedTarget}`,
      normalizedTarget,
      "main",
    ];
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const key of keys) {
      const normalized = String(key ?? "").trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduped.push(normalized);
    }
    return deduped;
  }

  private async sendToFeishu(session: AuthSession, message: string): Promise<void> {
    const { accountId, to } = session.originalContext;

    if (!this.cfg) {
      console.warn("[mfa-auth] Config not set, cannot send Feishu message");
      return;
    }

    if (!to) {
      console.warn("[mfa-auth] Feishu target 'to' is missing, cannot send message");
      return;
    }

    try {
      const { client, receiveId, receiveIdType } = resolveFeishuSendTarget({
        cfg: this.cfg,
        to,
        accountId,
      });

      let messageText = message;

      try {
        const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
          cfg: this.cfg,
          channel: "feishu",
        });

        messageText = getFeishuRuntime().channel.text.convertMarkdownTables(message, tableMode);
      } catch (error) {
        if (error instanceof Error && error.message === "Feishu runtime not initialized") {
          console.warn(
            "[mfa-auth] Feishu runtime not initialized yet, using original message text",
          );
          messageText = message;
        } else {
          throw error;
        }
      }

      const { content, msgType } = this.buildFeishuPostMessagePayload({
        messageText,
      });

      const response = await client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: {
          receive_id: receiveId,
          content,
          msg_type: msgType,
        },
      });

      assertFeishuMessageApiSuccess(response, "Feishu send failed");
      const result = toFeishuSendResult(response, receiveId);
      console.log(`[mfa-auth] Feishu message sent: ${result.messageId} to ${to}`);
    } catch (error) {
      console.error(`[mfa-auth] Failed to send Feishu message: ${error}`);
      throw error;
    }
  }

  private buildFeishuPostMessagePayload(params: { messageText: string }): {
    content: string;
    msgType: string;
  } {
    const { messageText } = params;
    return {
      content: JSON.stringify({
        zh_cn: {
          content: [
            [
              {
                tag: "md",
                text: messageText,
              },
            ],
          ],
        },
      }),
      msgType: "post",
    };
  }
}

export { NotificationService };
