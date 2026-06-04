# Guard risk approvals

When **CClawd Guard** detects risky tool calls, it can ask a human to approve instead of hard-blocking.

## Enable

```json5
{
  plugins: {
    entries: {
      "cclawd-guard": {
        config: {
          riskPolicy: "approve", // block | approve | allow
        },
      },
    },
  },
  approvals: {
    risk: {
      enabled: true,
      mode: "session", // session | targets | both
    },
  },
}
```

- **block** (default): deny risky tools (same as legacy `blockOnRisk: true`).
- **approve**: register approval, block immediately, allow after `/approve` on retry.
- **allow**: log only (`blockOnRisk: false`).

## Respond

Forwarded chats receive a message with a short id. Reply:

```
/approve <short-id> allow-once
/approve <short-id> allow-always
/approve <short-id> deny
```

Control UI and WebSocket clients with `operator.approvals` also receive `risk.approval.requested` events.

## Gateway methods

When `riskPolicy` is `approve`, the guard uses a **fast-fail** flow:

1. `risk.approval.request` with `twoPhase: true` — registers the approval and injects the notify message into chat; returns immediately.
2. `before_tool_call` **blocks right away** with `/approve <slug> …` in the error (no 120s wait in the hook).
3. After the operator runs `/approve`, Gateway **automatically runs** the approved command (exec/shell) and posts the result back to the agent — same pattern as exec approvals.

Legacy clients may still use `risk.approval.waitDecision` (blocks until timeout).

- `risk.approval.request` — register (use `twoPhase: true` for fast-fail)
- `risk.approval.getDecision` — poll decision without blocking the hook
- `risk.approval.waitDecision` — block until decision or expiry (legacy)
- `risk.approval.resolve` — operator decision

Approval ids use the `risk-` prefix.
