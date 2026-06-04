import { describe, expect, it } from "vitest";
import {
  extractExecCommand,
  parseRiskApprovalToolParams,
} from "./risk-approval-followup.js";

describe("risk-approval-followup helpers", () => {
  it("parses tool params from paramsPreview", () => {
    const params = parseRiskApprovalToolParams(
      "exec",
      'exec {"command":"powershell -enc dGVzdA=="}',
    );
    expect(params?.command).toBe("powershell -enc dGVzdA==");
  });

  it("extracts exec command from tool params", () => {
    expect(
      extractExecCommand("exec", { command: "powershell -enc dGVzdA==" }),
    ).toBe("powershell -enc dGVzdA==");
  });
});
