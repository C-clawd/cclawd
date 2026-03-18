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
    const host = config.gatewayHost || "127.0.0.1";

    console.log(`[mfa-auth] sendToWebChat: sessionKey=${sessionKey}, host=${host}, port=${port}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsModule = await import("ws");
    const WebSocket = wsModule.default || (wsModule as any).WebSocket;

    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: any = new WebSocket(`ws://${host}:${port}`);

      const handshakeId = `mfa-handshake-${Date.now()}`;
      const injectId = `mfa-inject-${Date.now()}`;
      let injectSent = false;

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
            console.log(`[mfa-auth] Handshake successful, injecting message to sessionKey=${sessionKey}`);
            const injectPayload = {
              type: "req",
              id: injectId,
              method: "chat.inject",
              params: {
                sessionKey,
                message,
                label: "MFA Auth",
              },
            };
            ws.send(JSON.stringify(injectPayload));
            injectSent = true;
            return;
          }

          if (response.id === injectId) {
            if (response.ok && !response.error) {
              console.log(`[mfa-auth] Chat inject successful for sessionKey=${sessionKey}`);
              ws.close();
              resolve();
            } else {
              console.warn(`[mfa-auth] Chat inject failed for sessionKey=${sessionKey}: ${JSON.stringify(response.error)}`);
              ws.close();
              reject(new Error(`Chat inject failed: ${JSON.stringify(response.error)}`));
            }
          }
        } catch (e) {
          console.error(`[mfa-auth] Error processing WebSocket message: ${e}`);
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.on("error", (err: any) => {
        reject(err);
      });

      setTimeout(() => {
        if (!injectSent) {
          console.warn(`[mfa-auth] WebSocket timeout: inject not sent to sessionKey=${sessionKey}`);
        }
        try {
          ws.terminate();
        } catch (e) {}
        reject(new Error("WebSocket timeout"));
      }, 5000);
    });
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
