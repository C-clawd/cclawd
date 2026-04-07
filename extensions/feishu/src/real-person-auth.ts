export type FeishuRealPersonAuthGateAction = "allow" | "allow-with-success" | "block";

export type FeishuRealPersonAuthGateResult =
  | { action: "allow" }
  | { action: "allow-with-success" }
  | { action: "block"; verificationUrl: string };

export type FeishuRealPersonAuthGateParams = {
  accountId: string;
  senderId: string;
  log: (message: string) => void;
  error: (message: string, err?: unknown) => void;
};

// Open-source stub: real-person auth is not enabled without a configured gate.
// Always allow so DM onboarding remains functional by default.
export async function resolveFeishuRealPersonAuthGate(
  params: FeishuRealPersonAuthGateParams,
): Promise<FeishuRealPersonAuthGateResult> {
  void params;
  return { action: "allow" };
}
