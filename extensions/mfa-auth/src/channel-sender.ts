import type { PluginLogger, PluginRuntime } from "@openclaw/plugin-sdk";

export class ChannelMessageSender {
  private static instance: ChannelMessageSender;
  private runtime: PluginRuntime | null = null;
  private logger: PluginLogger | null = null;

  private constructor() {}

  static getInstance(): ChannelMessageSender {
    if (!ChannelMessageSender.instance) {
      ChannelMessageSender.instance = new ChannelMessageSender();
    }
    return ChannelMessageSender.instance;
  }

  setRuntime(runtime: PluginRuntime): void {
    this.runtime = runtime;
  }

  setLogger(logger: PluginLogger): void {
    this.logger = logger;
  }

  private ensureInitialized(): void {
    if (!this.runtime) {
      throw new Error("ChannelMessageSender not initialized: runtime not set");
    }
    if (!this.logger) {
      throw new Error("ChannelMessageSender not initialized: logger not set");
    }
  }

  async sendToChannel(
    channel: string,
    accountId: string | undefined,
    to: string | undefined,
    message: string,
  ): Promise<void> {
    if (!to) {
      throw new Error("Target 'to' is missing");
    }
    this.ensureInitialized();

    try {
      this.logger?.info?.(`Sending MFA notification to channel ${channel}, to: ${to}`);

      switch (channel) {
        case "discord":
          await this.runtime!.channel.discord.sendMessageDiscord({
            text: message,
            to,
            accountId: accountId ?? undefined,
          });
          break;

        case "slack":
          await this.runtime!.channel.slack.sendMessageSlack({
            text: message,
            to,
            accountId: accountId ?? undefined,
          });
          break;

        case "telegram":
          await this.runtime!.channel.telegram.sendMessageTelegram({
            text: message,
            chatId: to,
            accountId: accountId ?? undefined,
          });
          break;

        case "signal":
          await this.runtime!.channel.signal.sendMessageSignal({
            text: message,
            to,
            accountId: accountId ?? undefined,
          });
          break;

        case "imessage":
          await this.runtime!.channel.imessage.sendMessageIMessage({
            text: message,
            to,
            accountId: accountId ?? undefined,
          });
          break;

        case "whatsapp":
          await this.runtime!.channel.whatsapp.sendMessageWhatsApp({
            text: message,
            to,
            accountId: accountId ?? undefined,
          });
          break;

        case "line":
          await this.runtime!.channel.line.sendMessageLine({
            text: message,
            to,
            accountId: accountId ?? undefined,
          });
          break;

        default:
          throw new Error(`Channel ${channel} not supported for outbound messaging`);
      }

      this.logger?.info?.(`MFA notification sent successfully to ${channel}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger?.error?.(
        `Failed to send MFA notification to channel ${channel}: ${errorMessage}`,
      );
      throw error;
    }
  }
}
