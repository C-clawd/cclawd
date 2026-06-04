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
  riskPolicy: "block" as const,
  riskApprovalTimeoutMs: 5000,
  pluginVersion: "test",
};

function getUserIntent(detector: BehaviorDetector, sessionKey: string): string {
  return (detector as unknown as { sessions: Map<string, { userIntent: string }> }).sessions.get(
    sessionKey,
  )?.userIntent ?? "";
}

function getContentFindings(
  detector: BehaviorDetector,
  sessionKey: string,
): Array<{ category: string; matchedText: string }> {
  return (
    detector as unknown as {
      sessions: Map<string, { contentInjectionFindings: Array<{ category: string; matchedText: string }> }>;
    }
  ).sessions.get(sessionKey)?.contentInjectionFindings ?? [];
}

describe("BehaviorDetector content findings", () => {
  it("recordContentScanFindings dedupes and caps findings for assess", () => {
    const detector = new BehaviorDetector(config, log);
    const scanResult = {
      detected: true,
      categories: ["WEB-01", "PI-01"],
      findings: [
        {
          scanner: "WEB-01",
          name: "Web Exploits",
          matchedText: "<script>alert(1)</script>",
          confidence: "high" as const,
        },
        {
          scanner: "WEB-01",
          name: "Web Exploits",
          matchedText: "<script>alert(1)</script>",
          confidence: "high" as const,
        },
        {
          scanner: "PI-01",
          name: "Instruction Hijack",
          matchedText: "ignore all previous instructions",
          confidence: "low" as const,
        },
      ],
      summary: "Detected categories: WEB-01,PI-01",
      latency_ms: 3,
    };

    detector.recordContentScanFindings("session-content", "web_fetch", scanResult);
    const findings = getContentFindings(detector, "session-content");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("WEB-01");
    expect(findings[0]?.matchedText).toContain("<script>");
  });
});

describe("BehaviorDetector approve policy (fast-fail)", () => {
  it("registers approval and blocks immediately without waiting", async () => {
    vi.resetModules();
    vi.doMock("./risk-approval-client.js", () => ({
      registerRiskApprovalRequest: vi.fn().mockResolvedValue({
        id: "risk-test-id-full",
        slug: "risk-test-id",
        expiresAtMs: Date.now() + 120_000,
      }),
      getRiskApprovalDecision: vi.fn(),
    }));
    const { BehaviorDetector: Detector } = await import("./behavior-detector.js");
    const detector = new Detector(
      { ...config, riskPolicy: "approve" as const },
      log,
    );
    const decision = await detector.onBeforeToolCall(
      { sessionKey: "session-approve" },
      { toolName: "exec", params: { command: "powershell -enc abc" } },
    );
    expect(decision?.block).toBe(true);
    expect(decision?.blockReason).toContain("/approve risk-test-id");
    expect(decision?.blockReason).not.toContain("timed out");
    vi.doUnmock("./risk-approval-client.js");
  });
});

describe("BehaviorDetector local hard block without core credentials", () => {
  it("blocks local P0 rules even when core credentials are missing", async () => {
    const detector = new BehaviorDetector(config, log);
    const decision = await detector.onBeforeToolCall(
      { sessionKey: "session-local" },
      { toolName: "exec", params: { command: "powershell -enc abc" } },
    );
    expect(decision?.block).toBe(true);
    expect(decision?.blockReason).toContain("local rule RCE-PS-ENC");
  });

  it("blocks bare rm -rf without a root path suffix", async () => {
    const detector = new BehaviorDetector(
      { ...config, riskPolicy: "approve" as const },
      log,
    );
    vi.doMock("./risk-approval-client.js", () => ({
      registerRiskApprovalRequest: vi.fn().mockResolvedValue({
        id: "risk-rm-test",
        slug: "risk-rm-test",
        expiresAtMs: Date.now() + 120_000,
      }),
      getRiskApprovalDecision: vi.fn(),
    }));
    const { BehaviorDetector: Detector } = await import("./behavior-detector.js");
    const approveDetector = new Detector({ ...config, riskPolicy: "approve" as const }, log);
    const decision = await approveDetector.onBeforeToolCall(
      { sessionKey: "session-rm" },
      { toolName: "exec", params: { command: "rm -rf" } },
    );
    expect(decision?.block).toBe(true);
    expect(decision?.blockReason).toContain("local rule DESTRUCTIVE-RM");
    vi.doUnmock("./risk-approval-client.js");
  });
});

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
