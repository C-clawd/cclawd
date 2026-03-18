---
summary: "WebChat MFA 最小侵入改造计划（先接入门禁与兼容，再扩展到多渠道）"
read_when:
  - 需要在 Gateway WebSocket 与 chat.send 上增加 MFA 二次认证
  - 需要以最小改动接入现有 mfa-auth 插件能力
title: "WebChat MFA 改造计划"
---

# WebChat MFA 改造计划

## 目标与边界

- 目标：为 WebChat 增加可灰度开启的 MFA 二次认证，并保证 `chat.send` 与 `web.login.*` 不可绕过。
- 边界：本计划优先覆盖 Gateway 与 WebChat；通知渠道先复用现有飞书实现，不在本阶段一次性实现全渠道发送。
- 约束：保持老客户端在关闭 MFA 开关时行为不变，避免破坏现有 token/password/device token 流程。

## 现状基线

- 握手路径：服务端先发 `connect.challenge`，客户端再发 `connect`。
- 鉴权路径：`connect` 阶段已完成 origin、共享凭证、设备签名与配对审批等校验。
- 方法路径：`chat.send` 进入统一 RPC 分发后执行，权限由 `method-scopes` 控制。
- 结论：当前缺少 MFA 维度的连接态与方法态门禁。

## 里程碑计划

### 里程碑 1：协议与能力声明

- 在 `connect` 请求结构增加可选 MFA 字段：`mfaToken`、`mfaCode`、`mfaMethod`。
- 在 `hello-ok` 响应增加能力位：`features.mfa`，用于前端按能力分支。
- 设计兼容策略：字段全部可选；仅当配置要求 MFA 时才强制校验。
- 验收标准：协议变更通过类型检查，关闭 MFA 时现有客户端无行为变化。

### 里程碑 2：握手阶段 MFA 门禁

- 在 `connect` 鉴权成功后、`hello-ok` 前执行 `verifyMfa(...)`。
- 认证通过后写入连接态：`mfaVerifiedAt`、`mfaMethod`、`mfaSessionId`、`mfaExpireAt`。
- 认证失败返回统一错误码：`MFA_REQUIRED`、`MFA_INVALID`、`MFA_EXPIRED`。
- 验收标准：开启 MFA 时，无有效 MFA 无法完成握手；有效 MFA 可正常进入 `hello-ok`。

### 里程碑 3：方法分发层兜底

- 在统一 RPC 分发层增加高风险方法前置检查。
- 首批纳管方法：`chat.send`、`web.login.start`、`web.login.wait`。
- 规则：连接态不存在或已过期的 MFA 认证记录时，直接拒绝方法调用。
- 验收标准：在异常连接态下，目标方法被一致性拒绝，非纳管方法不受影响。

### 里程碑 4：WebChat 前端 MFA 交互

- 在收到挑战与握手失败时处理 MFA 场景，支持提示与重试。
- 增加错误码映射：按 `MFA_REQUIRED/MFA_INVALID/MFA_EXPIRED` 给出可操作反馈。
- 在会话过程中出现过期时，触发重新认证并允许重发当前输入。
- 验收标准：用户可在 UI 内完成 MFA 重试，消息发送链路可恢复。

### 里程碑 5：插件对接与策略配置

- 新增网关侧 `MfaVerifier` 适配层，对接现有 `extensions/mfa-auth` 的验证能力。
- 增加配置项：`gateway.auth.mfa.enabled`、`gateway.auth.mfa.requiredForWebchat`、`gateway.auth.mfa.requiredMethods`、`gateway.auth.mfa.ttlSeconds`。
- 默认策略：`enabled=false`，先灰度到指定环境或指定方法。
- 验收标准：配置开关可独立控制启停，日志可区分策略拒绝与业务失败。

### 里程碑 6：测试与灰度发布

- 单元测试：握手成功/失败、过期校验、方法兜底拒绝、兼容模式回归。
- 集成测试：WebChat 握手到 `chat.send` 的完整流程，覆盖 MFA 成功与失败路径。
- 灰度策略：先启用 `chat.send`，稳定后扩展 `web.login.*` 与更多高风险方法。
- 验收标准：灰度期可观测关键指标，未出现老流程回归故障。

## 任务拆分（执行顺序）

1. 协议 schema 与类型扩展（connect/hello）。
2. 网关握手阶段接入 `verifyMfa(...)` 与连接态字段。
3. RPC 分发层接入 `requiredMethods` 门禁。
4. WebChat UI 增加 MFA 错误处理与重试流程。
5. 接入 `mfa-auth` 适配器与配置项。
6. 补齐测试并执行灰度验证。

## 风险与缓解

- 风险：老客户端不识别 MFA 错误导致反复重连。
- 缓解：默认关闭开关；`hello-ok` 明确下发 `features.mfa`，前端按能力开启流程。

- 风险：仅握手校验可能被会话劫持或状态漂移绕过。
- 缓解：在方法分发层做兜底校验，并引入 `mfaExpireAt` 过期判断。

- 风险：外部验证服务抖动导致登录可用性下降。
- 缓解：失败分级、限流与短时回退策略，先对关键方法灰度开启。

## 完成定义（DoD）

- 开启 MFA 后，WebChat 未通过 MFA 无法调用纳管高风险方法。
- 关闭 MFA 后，现有 WebChat 与网关流程完全兼容。
- 全部新增错误码、配置项、审计字段具备文档与测试覆盖。
