import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(async () => ({ ok: true })),
}));

let callGatewayTool: typeof import("./tools/gateway.js").callGatewayTool;
let sendExecApprovalFollowup: typeof import("./bash-tools.exec-approval-followup.js").sendExecApprovalFollowup;

async function loadModules() {
  vi.resetModules();
  ({ callGatewayTool } = await import("./tools/gateway.js"));
  ({ sendExecApprovalFollowup } = await import("./bash-tools.exec-approval-followup.js"));
}

describe("sendExecApprovalFollowup", () => {
  beforeEach(async () => {
    await loadModules();
    vi.mocked(callGatewayTool).mockClear();
    vi.mocked(callGatewayTool).mockResolvedValue({ ok: true });
  });

  it("uses deliver=false for webchat sessions without outbound channel", async () => {
    await sendExecApprovalFollowup({
      approvalId: "risk-test",
      sessionKey: "agent:main:main",
      resultText: "Exec finished (code 0)\ntest",
    });
    expect(callGatewayTool).toHaveBeenCalledWith(
      "agent",
      expect.any(Object),
      expect.objectContaining({
        sessionKey: "agent:main:main",
        deliver: false,
        bestEffortDeliver: false,
      }),
      expect.any(Object),
    );
  });

  it("uses deliver=true when turn source channel and to are present", async () => {
    await sendExecApprovalFollowup({
      approvalId: "risk-test",
      sessionKey: "agent:main:main",
      turnSourceChannel: "telegram",
      turnSourceTo: "12345",
      resultText: "done",
    });
    expect(callGatewayTool).toHaveBeenCalledWith(
      "agent",
      expect.any(Object),
      expect.objectContaining({
        deliver: true,
        channel: "telegram",
        to: "12345",
      }),
      expect.any(Object),
    );
  });
});
