---
name: mfa-auth-webchat-fix
overview: 修复 mfa-auth 插件在 webchat 渠道无法正常工作的三个问题
todos:
  - id: fix-first-message-auth
    content: 修复 message_received 中 webchat 首次消息认证，直接发送认证链接
    status: completed
  - id: remove-webchat-pending-users
    content: 移除 message_sending 中无效的 webchat pendingAuthUsers 逻辑
    status: completed
    dependencies:
      - fix-first-message-auth
  - id: verify-sessionkey-passing
    content: 确保 sessionKey 正确保存到 session.originalContext
    status: completed
    dependencies:
      - fix-first-message-auth
  - id: test-all-scenarios
    content: 测试首次认证、/reauth、敏感操作三个场景
    status: completed
    dependencies:
      - fix-first-message-auth
      - remove-webchat-pending-users
      - verify-sessionkey-passing
---

## 问题分析

用户在 webchat 测试 mfa-auth 插件时遇到三个问题：

1. **首次认证消息不显示**: `message_sending` hook 对 webchat 渠道永远不会触发
2. **认证成功无回复**: sessionKey 传递和会话解析可能有问题
3. **敏感操作无认证链接**: 需要验证触发条件

### 根本原因

**问题1**: 当前代码在 `message_received` 中检测到首次消息需要认证后，将用户添加到 `pendingAuthUsers`，然后 `return`，期望 `message_sending` 事件来发送认证链接。但 `message_sending` hook 只在 `src/infra/outbound/deliver.ts` 的外部交付流程中触发，webchat 是内部渠道，不走这个流程。

**问题2**: `PluginHookMessageContext` 类型不包含 `sessionKey` 字段，导致 `ctx.sessionKey` 为 `undefined`。session 创建时的 sessionKey 可能没有正确保存到 `originalContext`。

**问题3**: `before_tool_call` 中的敏感操作检测逻辑存在，但需要确保正确触发和发送。

## 解决方案

1. 在 `message_received` 中，对 webchat 直接调用 `sendAuthMessage` 发送认证链接
2. 确保 session 的 `originalContext.sessionKey` 正确设置
3. 简化代码逻辑，移除对 `message_sending` hook 的依赖（针对 webchat）

## 修改文件

### extensions/mfa-auth/index.ts

#### 修改1: message_received 事件处理（约第523行）

对于 webchat 渠道，直接调用 `sendAuthMessage` 发送认证链接，而不是等待 `message_sending`：

```typescript
if (parsedChannel === "webchat" || parsedChannel === "web") {
  // 直接发送认证消息
  const messageText = `🔐 首次对话需要进行认证\n\n为了您的账户安全，首次对话前需要完成身份验证。\n\n📱 请点击以下链接完成扫码认证:\n${session.qrCodeUrl}\n\n验证有效期: ${Math.floor(config.timeout / 60000)} 分钟`;
  
  await sendAuthMessage(
    parsedChannel,
    parsedAccountId,
    parsedTo || userId,
    messageText,
    userId,
    sessionKey,
  );
  
  startPollingForAuth(api, userId, session.sessionId, {
    triggerType: "first_message",
    isReauth: false,
    channel: parsedChannel,
    accountId: parsedAccountId,
    to: parsedTo,
    sessionKey: sessionKey,
  });
  
  return;
}
```

#### 修改2: 移除 message_sending 中的 webchat 相关逻辑

`message_sending` hook 对于 webchat 永远不会触发，可以移除或简化其中的 webchat 相关代码。

#### 修改3: 确保 sessionKey 正确保存到 session.originalContext

在 `authManager.generateSession` 调用时，确保 sessionKey 正确传递。

### extensions/mfa-auth/src/notification-service.ts

#### 验证 sendToWebChat 会话解析逻辑

确保 `resolveWebchatSessionCandidates` 方法能正确找到目标会话。

## 实现策略

1. **直接发送方案**: 在 `message_received` 和 `before_tool_call` 中，对 webchat 直接调用 `sendAuthMessage`，不依赖 `message_sending` hook
2. **保持兼容性**: 飞书等其他渠道保持原有逻辑不变
3. **简化代码**: 移除 `pendingAuthUsers` 相关的 webchat 逻辑（因为这个方案对 webchat 无效）