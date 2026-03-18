import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { config } from "./config.js";
import { resolveFeishuSendTarget } from "./feishu-support/index.js";
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
    const { channel } = session.originalContext;

    if (!this.cfg) {
      console.warn("[mfa-auth] Config not set, skipping notification");
      return;
    }

    const normalizedChannel = String(channel || "")
      .trim()
      .toLowerCase();

    if (normalizedChannel === "feishu") {
      try {
        await this.sendToFeishu(session, message);
      } catch (error) {
        // Fallback to gateway injection to avoid silent message loss when channel API
        // permissions are temporarily missing.
        console.warn(
          `[mfa-auth] Feishu direct send failed, falling back to gateway inject: ${String(error)}`,
        );
        await this.sendViaGatewayInject(session, message, normalizedChannel);
      }
      return;
    }

    await this.sendViaGatewayInject(session, message, normalizedChannel);
  }

  private async sendViaGatewayInject(
    session: AuthSession,
    message: string,
    channelHint?: string,
  ): Promise<void> {
    const { sessionKey, accountId } = session.originalContext;
    const port = this.cfg?.gateway?.port || 18789;
    const token = this.cfg?.gateway?.auth?.token;
    const host = config.gatewayHost || "127.0.0.1";

    console.log(
      `[mfa-auth] sendViaGatewayInject: channel=${channelHint || "unknown"}, sessionKey=${sessionKey}, host=${host}, port=${port}`,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsModule = await import("ws");
    const WebSocket = wsModule.default || (wsModule as any).WebSocket;

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = new WebSocket(`ws://${host}:${port}`);

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
            candidateSessionKeys = this.resolveSessionCandidates({
              channelHint,
              accountId,
              requestedSessionKey: sessionKey,
              userId: session.userId,
              targetTo: session.originalContext.to,
              sessionsListResult: response.result,
            });
            if (candidateSessionKeys.length === 0) {
              ws.close();
              reject(new Error("No candidate sessions found for gateway inject"));
              return;
            }
            console.log(
              `[mfa-auth] candidate sessions (${channelHint || "any"}): ${candidateSessionKeys.join(", ")}`,
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
            const shouldTryNext =
              errMsg.includes("session not found") ||
              errMsg.includes("transcript file not found") ||
              errMsg.includes("failed to write transcript") ||
              errMsg.includes("unavailable");
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
        } catch (e) {}
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

  private resolveSessionCandidates(params: {
    channelHint?: string;
    accountId?: string;
    requestedSessionKey?: string;
    userId: string;
    targetTo?: string;
    sessionsListResult: unknown;
  }): string[] {
    const normalizedChannelHint = String(params.channelHint || "")
      .trim()
      .toLowerCase();
    const normalizedAccountId = String(params.accountId || "")
      .trim()
      .toLowerCase();
    const normalizedTarget = String(params.targetTo || params.userId || "")
      .trim()
      .toLowerCase();
    const resultObject =
      params.sessionsListResult && typeof params.sessionsListResult === "object"
        ? (params.sessionsListResult as Record<string, unknown>)
        : undefined;
    const sessionsRaw = Array.isArray(resultObject?.sessions) ? resultObject.sessions : [];
    const matchingRows = sessionsRaw
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : undefined))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => {
        const ch = String(row.channel ?? "")
          .trim()
          .toLowerCase();
        const dc = row.deliveryContext as Record<string, unknown> | undefined;
        const dcChannel = String(dc?.channel ?? "")
          .trim()
          .toLowerCase();

        if (!normalizedChannelHint) {
          return true;
        }

        if (normalizedChannelHint === "web" || normalizedChannelHint === "webchat") {
          return ch === "webchat" || ch === "web" || dcChannel === "webchat" || dcChannel === "web";
        }

        return ch === normalizedChannelHint || dcChannel === normalizedChannelHint;
      })
      .filter((row) => {
        if (!normalizedAccountId) return true;
        const dc = row.deliveryContext as Record<string, unknown> | undefined;
        const rowAccount = String(row.accountId ?? "")
          .trim()
          .toLowerCase();
        const dcAccount = String(dc?.accountId ?? "")
          .trim()
          .toLowerCase();
        return rowAccount === normalizedAccountId || dcAccount === normalizedAccountId;
      });

    const exactRows = matchingRows.filter((row) => {
      const dc = row.deliveryContext as Record<string, unknown> | undefined;
      const peer = String(dc?.to ?? row.lastTo ?? "")
        .trim()
        .toLowerCase();
      return peer.length > 0 && peer === normalizedTarget;
    });
    const fallbackRows = matchingRows.filter((row) => !exactRows.includes(row));

    // Fuzzy match: include any session whose key contains the target id.
    const fuzzyRows = matchingRows.filter((row) => {
      const key = String(row.key ?? "").toLowerCase();
      // Ensure we don't duplicate rows already found
      return (
        key.includes(normalizedTarget) && !exactRows.includes(row) && !fallbackRows.includes(row)
      );
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
      // Common fallback patterns.
      `agent:main:${normalizedTarget}`,
      `${normalizedChannelHint}:${normalizedTarget}`,
      normalizedAccountId ? `${normalizedChannelHint}:${normalizedAccountId}:${normalizedTarget}` : "",
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
      // Use local implementation
      const { client, receiveId, receiveIdType } = resolveFeishuSendTarget({
        cfg: this.cfg,
        to,
        accountId,
      });

      // Simplified message handling (no markdown table conversion for now)
      const messageText = message;

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

      // Simplified assertion
      if (response.code !== 0) {
        throw new Error(`Feishu API error ${response.code}: ${response.msg}`);
      }

      const messageId = response.data?.message_id || "unknown";
      console.log(`[mfa-auth] Feishu message sent: ${messageId} to ${to}`);
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
