```
#  Cclawd — 个人 AI 安全助手

**Cclawd** 是一款运行在你自己设备上的_个人 安全AI 助手_。
它可以通过你已经在使用的频道（WhatsApp、Telegram、Slack、Discord、Google Chat、Signal、iMessage、BlueBubbles、IRC、Microsoft Teams、Matrix、飞书、LINE、Mattermost、Nextcloud Talk、Nostr、Synology Chat、Tlon、Twitch、Zalo、Zalo Personal、WebChat）与你交流。它支持在 macOS/iOS/Android 上语音对话，并能渲染一个你可控制的实时 Canvas。网关（Gateway）只是控制平面——产品的核心是这个助手本身。

如果你想要一个私人的、单用户的、感觉本地化、响应快速、始终在线的助手，这就是你要找的。

[官网](https://openclaw.ai) · [文档](https://docs.openclaw.ai) · [愿景](VISION.md) · [DeepWiki](https://deepwiki.com/openclaw/openclaw) · [快速开始](https://docs.openclaw.ai/start/getting-started) · [更新](https://docs.openclaw.ai/install/updating) · [展示](https://docs.openclaw.ai/start/showcase) · [常见问题](https://docs.openclaw.ai/help/faq) · [向导](https://docs.openclaw.ai/start/wizard) · [Nix](https://github.com/openclaw/nix-openclaw) · [Docker](https://docs.openclaw.ai/install/docker) · [Discord](https://discord.gg/clawd)

推荐的安装方式：在终端中运行引导向导（`openclaw onboard`）。
向导会逐步引导你完成网关、工作区、频道和技能的配置。CLI 向导是推荐路径，支持 **macOS、Linux 和 Windows（通过 WSL2，强烈推荐）**。
支持 npm、pnpm 或 bun。
全新安装？从这里开始：[快速开始](https://docs.openclaw.ai/start/getting-started)

## 赞助商

| OpenAI                                                            | Vercel                                                            | Blacksmith                                                                   | Convex                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [![OpenAI](docs/assets/sponsors/openai.svg)](https://openai.com/) | [![Vercel](docs/assets/sponsors/vercel.svg)](https://vercel.com/) | [![Blacksmith](docs/assets/sponsors/blacksmith.svg)](https://blacksmith.sh/) | [![Convex](docs/assets/sponsors/convex.svg)](https://www.convex.dev/) |

**订阅（OAuth）：**

- **[OpenAI](https://openai.com/)** （ChatGPT/Codex）

模型说明：虽然支持多种提供商和模型，但为获得最佳体验并降低提示注入风险，建议使用你能获取到的最强最新一代模型。详见[引导说明](https://docs.openclaw.ai/start/onboarding)。

## 模型（选择 + 认证）

- 模型配置 + CLI：[模型](https://docs.openclaw.ai/concepts/models)
- 认证配置轮换（OAuth 与 API 密钥）+ 故障转移：[模型故障转移](https://docs.openclaw.ai/concepts/model-failover)

## 安装（推荐方式）

运行时：**Node ≥22**。

```bash
npm install -g openclaw@latest
# 或: pnpm add -g openclaw@latest

openclaw onboard --install-daemon
```

向导会安装网关守护进程（launchd/systemd 用户服务）以保持其持续运行。

## 快速开始（TL;DR）

运行时：**Node ≥22**。

完整的初学者指南（认证、配对、频道）：[快速开始](https://docs.openclaw.ai/start/getting-started)

```bash
openclaw onboard --install-daemon

openclaw gateway --port 18789 --verbose

# 发送消息
openclaw message send --to +1234567890 --message "Hello from OpenClaw"

# 与助手对话（可选择回传至任意已连接频道：WhatsApp/Telegram/Slack/Discord/Google Chat/Signal/iMessage/BlueBubbles/IRC/Microsoft Teams/Matrix/飞书/LINE/Mattermost/Nextcloud Talk/Nostr/Synology Chat/Tlon/Twitch/Zalo/Zalo Personal/WebChat）
openclaw agent --message "Ship checklist" --thinking high
```

需要升级？[更新指南](https://docs.openclaw.ai/install/updating)（并运行 `openclaw doctor`）。

## 开发频道

- **stable（稳定版）**：已打标签的发布版本（`vYYYY.M.D` 或 `vYYYY.M.D-<patch>`），npm dist-tag 为 `latest`。
- **beta（测试版）**：预发布标签（`vYYYY.M.D-beta.N`），npm dist-tag 为 `beta`（可能缺少 macOS 应用）。
- **dev（开发版）**：`main` 分支的最新提交，npm dist-tag 为 `dev`（发布时有效）。

切换频道（git + npm）：`openclaw update --channel stable|beta|dev`。
详情：[开发频道](https://docs.openclaw.ai/install/development-channels)。

## 从源码构建（开发）

从源码构建推荐使用 `pnpm`。Bun 可选，用于直接运行 TypeScript。

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw

pnpm install
pnpm ui:build # 首次运行时自动安装 UI 依赖
pnpm build

pnpm openclaw onboard --install-daemon

# 开发循环（TS 文件变更时自动重载）
pnpm gateway:watch
```

注意：`pnpm openclaw ...` 直接通过 `tsx` 运行 TypeScript。`pnpm build` 会生成 `dist/` 目录，供 Node 或打包后的 `openclaw` 二进制文件使用。

## 安全默认设置（私信访问）

OpenClaw 连接到真实的消息平台。请将收到的私信视为**不可信输入**。

完整安全指南：[安全](https://docs.openclaw.ai/gateway/security)

在 Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack 上的默认行为：

- **私信配对**（`dmPolicy="pairing"` / `channels.discord.dmPolicy="pairing"` / `channels.slack.dmPolicy="pairing"`；旧版：`channels.discord.dm.policy`，`channels.slack.dm.policy`）：未知发送者将收到一个短配对码，机器人不会处理其消息。
- 审批命令：`openclaw pairing approve <channel> <code>`（之后发送者会被添加到本地白名单）。
- 公开的入站私信需要明确选择开启：设置 `dmPolicy="open"` 并在频道白名单中包含 `"*"`（`allowFrom` / `channels.discord.allowFrom` / `channels.slack.allowFrom`；旧版：`channels.discord.dm.allowFrom`，`channels.slack.dm.allowFrom`）。

运行 `openclaw doctor` 可检查有风险或配置错误的私信策略。

## 核心亮点

- **[本地优先网关](https://docs.openclaw.ai/gateway)** — 统一管理会话、频道、工具和事件的控制平面。
- **[多频道收件箱](https://docs.openclaw.ai/channels)** — 支持 WhatsApp、Telegram、Slack、Discord、Google Chat、Signal、BlueBubbles（iMessage）、iMessage（旧版）、IRC、Microsoft Teams、Matrix、飞书、LINE、Mattermost、Nextcloud Talk、Nostr、Synology Chat、Tlon、Twitch、Zalo、Zalo Personal、WebChat、macOS、iOS/Android。
- **[多智能体路由](https://docs.openclaw.ai/gateway/configuration)** — 将入站频道/账户/对等节点路由到隔离的智能体（工作区 + 每智能体独立会话）。
- **[语音唤醒](https://docs.openclaw.ai/nodes/voicewake) + [对话模式](https://docs.openclaw.ai/nodes/talk)** — macOS/iOS 上的唤醒词，Android 上的持续语音（ElevenLabs + 系统 TTS 备用）。
- **[实时 Canvas](https://docs.openclaw.ai/platforms/mac/canvas)** — 由智能体驱动的可视化工作区，支持 [A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui)。
- **[一流工具](https://docs.openclaw.ai/tools)** — 浏览器、canvas、节点、定时任务、会话，以及 Discord/Slack 操作。
- **[伴侣应用](https://docs.openclaw.ai/platforms/macos)** — macOS 菜单栏应用 + iOS/Android [节点](https://docs.openclaw.ai/nodes)。
- **[引导向导](https://docs.openclaw.ai/start/wizard) + [技能系统](https://docs.openclaw.ai/tools/skills)** — 向导驱动的配置流程，支持内置/托管/工作区技能。

## 已完成功能总览

### 核心平台

- [网关 WebSocket 控制平面](https://docs.openclaw.ai/gateway)，包含会话、在线状态、配置、定时任务、Webhook、[控制界面](https://docs.openclaw.ai/web)和 [Canvas 宿主](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui)。
- [CLI 接口](https://docs.openclaw.ai/tools/agent-send)：网关、智能体、发送、[向导](https://docs.openclaw.ai/start/wizard)和 [doctor](https://docs.openclaw.ai/gateway/doctor)。
- [Pi 智能体运行时](https://docs.openclaw.ai/concepts/agent)，支持 RPC 模式、工具流式传输和块流式传输。
- [会话模型](https://docs.openclaw.ai/concepts/session)：`main` 用于直接聊天，支持群组隔离、激活模式、队列模式、回复等。群组规则：[群组](https://docs.openclaw.ai/channels/groups)。
- [媒体管线](https://docs.openclaw.ai/nodes/images)：图片/音频/视频、转录钩子、大小限制、临时文件生命周期。音频详情：[音频](https://docs.openclaw.ai/nodes/audio)。

### 频道

- [频道](https://docs.openclaw.ai/channels)：[WhatsApp](https://docs.openclaw.ai/channels/whatsapp)（Baileys）、[Telegram](https://docs.openclaw.ai/channels/telegram)（grammY）、[Slack](https://docs.openclaw.ai/channels/slack)（Bolt）、[Discord](https://docs.openclaw.ai/channels/discord)（discord.js）、[Google Chat](https://docs.openclaw.ai/channels/googlechat)（Chat API）、[Signal](https://docs.openclaw.ai/channels/signal)（signal-cli）、[BlueBubbles](https://docs.openclaw.ai/channels/bluebubbles)（iMessage，推荐）、[iMessage](https://docs.openclaw.ai/channels/imessage)（旧版 imsg）、[IRC](https://docs.openclaw.ai/channels/irc)、[Microsoft Teams](https://docs.openclaw.ai/channels/msteams)、[Matrix](https://docs.openclaw.ai/channels/matrix)、[飞书](https://docs.openclaw.ai/channels/feishu)、[LINE](https://docs.openclaw.ai/channels/line)、[Mattermost](https://docs.openclaw.ai/channels/mattermost)、[Nextcloud Talk](https://docs.openclaw.ai/channels/nextcloud-talk)、[Nostr](https://docs.openclaw.ai/channels/nostr)、[Synology Chat](https://docs.openclaw.ai/channels/synology-chat)、[Tlon](https://docs.openclaw.ai/channels/tlon)、[Twitch](https://docs.openclaw.ai/channels/twitch)、[Zalo](https://docs.openclaw.ai/channels/zalo)、[Zalo Personal](https://docs.openclaw.ai/channels/zalouser)、[WebChat](https://docs.openclaw.ai/web/webchat)。
- [群组路由](https://docs.openclaw.ai/channels/group-messages)：@提及过滤、回复标签、每频道分块与路由。频道规则：[频道](https://docs.openclaw.ai/channels)。

### 应用 + 节点

- [macOS 应用](https://docs.openclaw.ai/platforms/macos)：菜单栏控制平面、[语音唤醒](https://docs.openclaw.ai/nodes/voicewake)/PTT、[对话模式](https://docs.openclaw.ai/nodes/talk)叠加层、[WebChat](https://docs.openclaw.ai/web/webchat)、调试工具、[远程网关](https://docs.openclaw.ai/gateway/remote)控制。
- [iOS 节点](https://docs.openclaw.ai/platforms/ios)：[Canvas](https://docs.openclaw.ai/platforms/mac/canvas)、[语音唤醒](https://docs.openclaw.ai/nodes/voicewake)、[对话模式](https://docs.openclaw.ai/nodes/talk)、相机、屏幕录制、Bonjour + 设备配对。
- [Android 节点](https://docs.openclaw.ai/platforms/android)：连接标签（配置码/手动）、聊天会话、语音标签、[Canvas](https://docs.openclaw.ai/platforms/mac/canvas)、相机/屏幕录制，以及 Android 设备命令（通知/位置/短信/照片/联系人/日历/运动/应用更新）。
- [macOS 节点模式](https://docs.openclaw.ai/nodes)：system.run/notify + canvas/相机暴露。

### 工具 + 自动化

- [浏览器控制](https://docs.openclaw.ai/tools/browser)：专用的 openclaw Chrome/Chromium，支持快照、操作、上传、配置文件。
- [Canvas](https://docs.openclaw.ai/platforms/mac/canvas)：[A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui) 推送/重置、执行、快照。
- [节点](https://docs.openclaw.ai/nodes)：相机拍照/录制、屏幕录制、[location.get](https://docs.openclaw.ai/nodes/location-command)、通知。
- [定时任务 + 唤醒](https://docs.openclaw.ai/automation/cron-jobs)；[Webhook](https://docs.openclaw.ai/automation/webhook)；[Gmail Pub/Sub](https://docs.openclaw.ai/automation/gmail-pubsub)。
- [技能平台](https://docs.openclaw.ai/tools/skills)：内置、托管和工作区技能，支持安装控制 + 界面。

### 运行时 + 安全

- [频道路由](https://docs.openclaw.ai/channels/channel-routing)、[重试策略](https://docs.openclaw.ai/concepts/retry)和[流式传输/分块](https://docs.openclaw.ai/concepts/streaming)。
- [在线状态](https://docs.openclaw.ai/concepts/presence)、[正在输入指示器](https://docs.openclaw.ai/concepts/typing-indicators)和[用量追踪](https://docs.openclaw.ai/concepts/usage-tracking)。
- [模型](https://docs.openclaw.ai/concepts/models)、[模型故障转移](https://docs.openclaw.ai/concepts/model-failover)和[会话裁剪](https://docs.openclaw.ai/concepts/session-pruning)。
- [安全](https://docs.openclaw.ai/gateway/security)和[故障排查](https://docs.openclaw.ai/channels/troubleshooting)。

### 运维 + 打包

- [控制界面](https://docs.openclaw.ai/web) + [WebChat](https://docs.openclaw.ai/web/webchat) 直接由网关提供服务。
- [Tailscale Serve/Funnel](https://docs.openclaw.ai/gateway/tailscale) 或 [SSH 隧道](https://docs.openclaw.ai/gateway/remote)，支持 token/密码认证。
- [Nix 模式](https://docs.openclaw.ai/install/nix)用于声明式配置；[Docker](https://docs.openclaw.ai/install/docker) 安装方式。
- [Doctor](https://docs.openclaw.ai/gateway/doctor) 迁移、[日志记录](https://docs.openclaw.ai/logging)。

## 工作原理（简述）

```
飞书/ WhatsApp / Telegram / Slack / Discord / Google Chat / Signal / iMessage / BlueBubbles / IRC / Microsoft Teams / Matrix / LINE / Mattermost / Nextcloud Talk / Nostr / Synology Chat / Tlon / Twitch / Zalo / Zalo Personal / WebChat
               │
               ▼
┌───────────────────────────────┐
│            网关（Gateway）     │
│         （控制平面）           │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi 智能体（RPC）
               ├─ CLI（openclaw …）
               ├─ WebChat 界面
               ├─ macOS 应用
               └─ iOS / Android 节点
```

## 核心子系统

- **[网关 WebSocket 网络](https://docs.openclaw.ai/concepts/architecture)** — 统一的 WS 控制平面，用于客户端、工具和事件（运维参考：[网关手册](https://docs.openclaw.ai/gateway)）。
- **[Tailscale 暴露](https://docs.openclaw.ai/gateway/tailscale)** — 通过 Serve/Funnel 对外暴露网关仪表盘 + WS（远程访问：[远程](https://docs.openclaw.ai/gateway/remote)）。
- **[浏览器控制](https://docs.openclaw.ai/tools/browser)** — 由 openclaw 管理的 Chrome/Chromium，使用 CDP 控制。
- **[Canvas + A2UI](https://docs.openclaw.ai/platforms/mac/canvas)** — 智能体驱动的可视化工作区（A2UI 宿主：[Canvas/A2UI](https://docs.openclaw.ai/platforms/mac/canvas#canvas-a2ui)）。
- **[语音唤醒](https://docs.openclaw.ai/nodes/voicewake) + [对话模式](https://docs.openclaw.ai/nodes/talk)** — macOS/iOS 上的唤醒词，Android 上的持续语音。
- **[节点](https://docs.openclaw.ai/nodes)** — Canvas、相机拍照/录制、屏幕录制、`location.get`、通知，以及 macOS 独有的 `system.run`/`system.notify`。

## Tailscale 访问（网关仪表盘）

OpenClaw 可自动配置 Tailscale **Serve**（仅限 tailnet）或 **Funnel**（公开），同时让网关保持绑定在回环地址。通过 `gateway.tailscale.mode` 进行配置：

- `off`：不自动配置 Tailscale（默认）。
- `serve`：通过 `tailscale serve` 实现仅 tailnet 的 HTTPS（默认使用 Tailscale 身份标头）。
- `funnel`：通过 `tailscale funnel` 实现公开 HTTPS（需要共享密码认证）。

注意事项：

- 启用 Serve/Funnel 时，`gateway.bind` 必须保持为 `loopback`（OpenClaw 会强制执行此限制）。
- 可通过设置 `gateway.auth.mode: "password"` 或 `gateway.auth.allowTailscale: false` 来强制 Serve 使用密码。
- 除非设置了 `gateway.auth.mode: "password"`，否则 Funnel 将拒绝启动。
- 可选：`gateway.tailscale.resetOnExit` 在关闭时撤销 Serve/Funnel 配置。

详情：[Tailscale 指南](https://docs.openclaw.ai/gateway/tailscale) · [Web 接口](https://docs.openclaw.ai/web)

## 远程网关（Linux 是个好选择）

在小型 Linux 实例上运行网关完全没问题。客户端（macOS 应用、CLI、WebChat）可通过 **Tailscale Serve/Funnel** 或 **SSH 隧道**连接，同时仍可将设备节点（macOS/iOS/Android）与网关配对，以便在需要时执行设备本地操作。

- **网关主机** 默认运行执行工具和频道连接。
- **设备节点** 通过 `node.invoke` 运行设备本地操作（`system.run`、相机、屏幕录制、通知）。
  简而言之：执行操作在网关所在的地方运行，设备操作在设备所在的地方运行。

详情：[远程访问](https://docs.openclaw.ai/gateway/remote) · [节点](https://docs.openclaw.ai/nodes) · [安全](https://docs.openclaw.ai/gateway/security)

## 通过网关协议获取 macOS 权限

macOS 应用可以在**节点模式**下运行，并通过网关 WebSocket（`node.list` / `node.describe`）广播其能力和权限映射。客户端可通过 `node.invoke` 执行本地操作：

- `system.run` 运行本地命令并返回 stdout/stderr/退出码；设置 `needsScreenRecording: true` 可要求屏幕录制权限（否则会收到 `PERMISSION_MISSING`）。
- `system.notify` 发送用户通知，如果通知被拒绝则失败。
- `canvas.*`、`camera.*`、`screen.record` 和 `location.get` 也通过 `node.invoke` 路由，并遵循 TCC 权限状态。

提升的 bash 权限（宿主权限）与 macOS TCC 是独立的：

- 使用 `/elevated on|off` 可在启用并白名单的情况下切换每会话的提升访问权限。
- 网关通过 `sessions.patch`（WS 方法）持久化每会话的切换状态，与 `thinkingLevel`、`verboseLevel`、`model`、`sendPolicy` 和 `groupActivation` 并列保存。

详情：[节点](https://docs.openclaw.ai/nodes) · [macOS 应用](https://docs.openclaw.ai/platforms/macos) · [网关协议](https://docs.openclaw.ai/concepts/architecture)

## 智能体间通信（sessions\_\* 工具）

- 使用这些工具可以跨会话协调工作，无需在不同聊天界面之间切换。
- `sessions_list` — 发现活跃会话（智能体）及其元数据。
- `sessions_history` — 获取会话的历史记录。
- `sessions_send` — 向另一个会话发送消息；支持可选的回复乒乓 + 通知步骤（`REPLY_SKIP`、`ANNOUNCE_SKIP`）。

详情：[会话工具](https://docs.openclaw.ai/concepts/session-tool)

## 技能注册表（ClawHub）

ClawHub 是一个轻量级的技能注册表。启用 ClawHub 后，智能体可以自动搜索技能并按需引入新技能。

[ClawHub](https://clawhub.com)

## 聊天命令

在 WhatsApp/Telegram/Slack/Google Chat/Microsoft Teams/WebChat 中发送这些命令（群组命令仅限所有者）：

- `/status` — 紧凑的会话状态（模型 + token 数，有时含费用）
- `/new` 或 `/reset` — 重置会话
- `/compact` — 压缩会话上下文（生成摘要）
- `/think <level>` — off|minimal|low|medium|high|xhigh（仅 GPT-5.2 + Codex 模型）
- `/verbose on|off`
- `/usage off|tokens|full` — 每条回复的用量统计脚注
- `/restart` — 重启网关（群组中仅限所有者）
- `/activation mention|always` — 群组激活模式切换（仅群组）

## 应用（可选）

网关本身就能提供出色的体验。所有应用都是可选的，安装后可获得额外功能。

如果你计划构建/运行伴侣应用，请参阅下方各平台的操作手册。

### macOS（OpenClaw.app）（可选）

- 菜单栏控制网关状态和健康监测。
- 语音唤醒 + 按键通话叠加层。
- WebChat + 调试工具。
- 通过 SSH 控制远程网关。

注意：在重新构建后若要让 macOS 权限持续生效，需要使用已签名的构建版本（见 `docs/mac/permissions.md`）。

### iOS 节点（可选）

- 通过网关 WebSocket 配对为节点（设备配对）。
- 语音触发转发 + Canvas 界面。
- 通过 `openclaw nodes …` 控制。

操作手册：[iOS 连接](https://docs.openclaw.ai/platforms/ios)。

### Android 节点（可选）

- 通过设备配对连接为 WS 节点（`openclaw devices ...`）。
- 提供连接/聊天/语音标签，以及 Canvas、相机、屏幕录制和 Android 设备命令系列。
- 操作手册：[Android 连接](https://docs.openclaw.ai/platforms/android)。

## 智能体工作区 + 技能

- 工作区根目录：`~/.openclaw/workspace`（可通过 `agents.defaults.workspace` 配置）。
- 注入的提示文件：`AGENTS.md`、`SOUL.md`、`TOOLS.md`。
- 技能：`~/.openclaw/workspace/skills/<skill>/SKILL.md`。

## 配置

最简 `~/.openclaw/openclaw.json`（模型 + 默认值）：

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
}
```

[完整配置参考（所有键名 + 示例）。](https://docs.openclaw.ai/gateway/configuration)

## 安全模型（重要）

- **默认：** 工具在**主**会话的宿主上运行，因此当只有你一个人使用时，智能体拥有完全访问权限。
- **群组/频道安全：** 设置 `agents.defaults.sandbox.mode: "non-main"` 可将**非主会话**（群组/频道）置于每会话 Docker 沙箱中运行；这些会话中的 bash 命令将在 Docker 中执行。
- **沙箱默认值：** 白名单包括 `bash`、`process`、`read`、`write`、`edit`、`sessions_list`、`sessions_history`、`sessions_send`、`sessions_spawn`；黑名单包括 `browser`、`canvas`、`nodes`、`cron`、`discord`、`gateway`。

详情：[安全指南](https://docs.openclaw.ai/gateway/security) · [Docker + 沙箱](https://docs.openclaw.ai/install/docker) · [沙箱配置](https://docs.openclaw.ai/gateway/configuration)

### [WhatsApp](https://docs.openclaw.ai/channels/whatsapp)

- 连接设备：`pnpm openclaw channels login`（凭据存储在 `~/.openclaw/credentials`）。
- 通过 `channels.whatsapp.allowFrom` 设置允许与助手对话的白名单。
- 如果设置了 `channels.whatsapp.groups`，则成为群组白名单；包含 `"*"` 可允许所有群组。

### [Telegram](https://docs.openclaw.ai/channels/telegram)

- 设置 `TELEGRAM_BOT_TOKEN` 或 `channels.telegram.botToken`（环境变量优先）。
- 可选：设置 `channels.telegram.groups`（含 `channels.telegram.groups."*".requireMention`）；若已设置，则成为群组白名单（包含 `"*"` 可允许所有群组）。还可按需设置 `channels.telegram.allowFrom` 或 `channels.telegram.webhookUrl` + `channels.telegram.webhookSecret`。

```json5
{
  channels: {
    telegram: {
      botToken: "123456:ABCDEF",
    },
  },
}
```

### [Slack](https://docs.openclaw.ai/channels/slack)

- 设置 `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`（或 `channels.slack.botToken` + `channels.slack.appToken`）。

### [Discord](https://docs.openclaw.ai/channels/discord)

- 设置 `DISCORD_BOT_TOKEN` 或 `channels.discord.token`（环境变量优先）。
- 可选：按需设置 `commands.native`、`commands.text` 或 `commands.useAccessGroups`，以及 `channels.discord.allowFrom`、`channels.discord.guilds` 或 `channels.discord.mediaMaxMb`。

```json5
{
  channels: {
    discord: {
      token: "1234abcd",
    },
  },
}
```

### [Signal](https://docs.openclaw.ai/channels/signal)

- 需要安装 `signal-cli` 并配置 `channels.signal` 部分。

### [BlueBubbles（iMessage）](https://docs.openclaw.ai/channels/bluebubbles)

- **推荐**的 iMessage 集成方案。
- 配置 `channels.bluebubbles.serverUrl` + `channels.bluebubbles.password` 以及 Webhook（`channels.bluebubbles.webhookPath`）。
- BlueBubbles 服务端运行在 macOS 上；网关可运行在 macOS 或其他地方。

### [iMessage（旧版）](https://docs.openclaw.ai/channels/imessage)

- 仅 macOS 的旧版集成，通过 `imsg` 实现（"信息"应用需处于已登录状态）。
- 如果设置了 `channels.imessage.groups`，则成为群组白名单；包含 `"*"` 可允许所有群组。

### [Microsoft Teams](https://docs.openclaw.ai/channels/msteams)

- 配置 Teams 应用 + Bot Framework，然后添加 `msteams` 配置部分。
- 通过 `msteams.allowFrom` 设置允许对话的白名单；通过 `msteams.groupAllowFrom` 或 `msteams.groupPolicy: "open"` 设置群组访问权限。

### [WebChat](https://docs.openclaw.ai/web/webchat)

- 使用网关的 WebSocket，无需单独的 WebChat 端口或配置。

浏览器控制（可选）：

```json5
{
  browser: {
    enabled: true,
    color: "#FF4500",
  },
}
```

## 文档

完成引导流程后，可参考以下深度参考文档。

- [从文档索引开始，了解导航结构和内容分布。](https://docs.openclaw.ai)
- [阅读架构概览，了解网关 + 协议模型。](https://docs.openclaw.ai/concepts/architecture)
- [使用完整配置参考，查询所有键名和示例。](https://docs.openclaw.ai/gateway/configuration)
- [按照运维手册规范运行网关。](https://docs.openclaw.ai/gateway)
- [了解控制界面/Web 接口的工作方式及安全暴露方法。](https://docs.openclaw.ai/web)
- [了解通过 SSH 隧道或 tailnet 进行远程访问。](https://docs.openclaw.ai/gateway/remote)
- [遵循引导向导流程进行引导式配置。](https://docs.openclaw.ai/start/wizard)
- [通过 Webhook 接口接入外部触发器。](https://docs.openclaw.ai/automation/webhook)
- [设置 Gmail Pub/Sub 触发器。](https://docs.openclaw.ai/automation/gmail-pubsub)
- [了解 macOS 菜单栏伴侣应用详情。](https://docs.openclaw.ai/platforms/mac/menu-bar)
- [平台指南：Windows（WSL2）](https://docs.openclaw.ai/platforms/windows)、[Linux](https://docs.openclaw.ai/platforms/linux)、[macOS](https://docs.openclaw.ai/platforms/macos)、[iOS](https://docs.openclaw.ai/platforms/ios)、[Android](https://docs.openclaw.ai/platforms/android)
- [通过故障排查指南调试常见问题。](https://docs.openclaw.ai/channels/troubleshooting)
- [在对外暴露任何服务前，请查阅安全指南。](https://docs.openclaw.ai/gateway/security)

## 高级文档（发现 + 控制）

- [发现 + 传输](https://docs.openclaw.ai/gateway/discovery)
- [Bonjour/mDNS](https://docs.openclaw.ai/gateway/bonjour)
- [网关配对](https://docs.openclaw.ai/gateway/pairing)
- [远程网关 README](https://docs.openclaw.ai/gateway/remote-gateway-readme)
- [控制界面](https://docs.openclaw.ai/web/control-ui)
- [仪表盘](https://docs.openclaw.ai/web/dashboard)

## 运维与故障排查

- [健康检查](https://docs.openclaw.ai/gateway/health)
- [网关锁](https://docs.openclaw.ai/gateway/gateway-lock)
- [后台进程](https://docs.openclaw.ai/gateway/background-process)
- [浏览器故障排查（Linux）](https://docs.openclaw.ai/tools/browser-linux-troubleshooting)
- [日志记录](https://docs.openclaw.ai/logging)

## 深度解析

- [智能体循环](https://docs.openclaw.ai/concepts/agent-loop)
- [在线状态](https://docs.openclaw.ai/concepts/presence)
- [TypeBox 模式](https://docs.openclaw.ai/concepts/typebox)
- [RPC 适配器](https://docs.openclaw.ai/reference/rpc)
- [队列](https://docs.openclaw.ai/concepts/queue)

## 工作区 + 技能

- [技能配置](https://docs.openclaw.ai/tools/skills-config)
- [默认 AGENTS](https://docs.openclaw.ai/reference/AGENTS.default)
- [模板：AGENTS](https://docs.openclaw.ai/reference/templates/AGENTS)
- [模板：BOOTSTRAP](https://docs.openclaw.ai/reference/templates/BOOTSTRAP)
- [模板：IDENTITY](https://docs.openclaw.ai/reference/templates/IDENTITY)
- [模板：SOUL](https://docs.openclaw.ai/reference/templates/SOUL)
- [模板：TOOLS](https://docs.openclaw.ai/reference/templates/TOOLS)
- [模板：USER](https://docs.openclaw.ai/reference/templates/USER)

## 平台内部机制

- [macOS 开发环境配置](https://docs.openclaw.ai/platforms/mac/dev-setup)
- [macOS 菜单栏](https://docs.openclaw.ai/platforms/mac/menu-bar)
- [macOS 语音唤醒](https://docs.openclaw.ai/platforms/mac/voicewake)
- [iOS 节点](https://docs.openclaw.ai/platforms/ios)
- [Android 节点](https://docs.openclaw.ai/platforms/android)
- [Windows（WSL2）](https://docs.openclaw.ai/platforms/windows)
- [Linux 应用](https://docs.openclaw.ai/platforms/linux)


```
