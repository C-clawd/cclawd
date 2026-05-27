import { describe, expect, it, vi } from "vitest";
import { BehaviorDetector } from "./behavior-detector.js";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const config = {
  coreUrl: "http://test",
  assessTimeoutMs: 1000,
  blockOnRisk: true,
  pluginVersion: "test",
};

function getUserIntent(detector: BehaviorDetector, sessionKey: string): string {
  return (detector as unknown as { sessions: Map<string, { userIntent: string }> }).sessions.get(
    sessionKey,
  )?.userIntent ?? "";
}

describe("BehaviorDetector user intent", () => {
  it("updates userIntent on each user message instead of keeping the first", () => {
    const detector = new BehaviorDetector(config, log);
    detector.setUserIntent("session-1", "rm -rf /");
    expect(getUserIntent(detector, "session-1")).toBe("rm -rf /");

    detector.setUserIntent("session-1", "read README.md");
    expect(getUserIntent(detector, "session-1")).toBe("read README.md");
  });

  it("handleAuthBypassMarker sets bypass without overwriting userIntent", () => {
    const detector = new BehaviorDetector(config, log);
    detector.setUserIntent("session-1", "read README.md");
    detector.handleAuthBypassMarker(
      "session-1",
      "[System: cclawd-guard-bypass:real-person-auth-once]",
    );

    expect(getUserIntent(detector, "session-1")).toBe("read README.md");
    const state = (detector as unknown as {
      sessions: Map<string, { realPersonAuthBypassOncePending?: boolean }>;
    }).sessions.get("session-1");
    expect(state?.realPersonAuthBypassOncePending).toBe(true);
  });
});
