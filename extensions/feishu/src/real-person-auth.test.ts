import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockHomedir,
  mockDotenvConfig,
  authStoreState,
} = vi.hoisted(() => {
  const state = {
    content: "{}",
  };

  return {
    mockReadFile: vi.fn(async () => state.content),
    mockWriteFile: vi.fn(async (_path: string, content: string) => {
      state.content = content;
    }),
    mockMkdir: vi.fn(async () => undefined),
    mockHomedir: vi.fn(() => "C:/mock-home"),
    mockDotenvConfig: vi.fn(() => undefined),
    authStoreState: state,
  };
});

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  },
}));

vi.mock("node:os", () => ({
  default: {
    homedir: mockHomedir,
  },
}));

vi.mock("dotenv", () => ({
  config: mockDotenvConfig,
}));

import {
  checkFeishuRealPersonAuthStatus,
  resolveFeishuRealPersonAuthGate,
} from "./real-person-auth.js";

function setAuthStore(value: unknown) {
  authStoreState.content = JSON.stringify(value, null, 2);
}

function readAuthStore() {
  return JSON.parse(authStoreState.content) as Record<string, unknown>;
}

function createParams() {
  return {
    accountId: "default",
    senderId: "ou_user_1",
    log: vi.fn(),
    error: vi.fn(),
  };
}

describe("real-person auth QR refresh", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MFA_AUTH_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    process.env.MFA_AUTH_API_KEY = "test-api-key";
    delete process.env.DABBY_AUTH_H5_BASE_URL;
    setAuthStore({});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MFA_AUTH_API_KEY;
    } else {
      process.env.MFA_AUTH_API_KEY = originalApiKey;
    }
  });

  it("reuses an unexpired pending certToken within five minutes", async () => {
    const now = Date.UTC(2026, 3, 28, 10, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    setAuthStore({
      ou_user_1: {
        authenticated: false,
        certToken: "pending-token",
        issuedAt: now - 4 * 60 * 1_000,
        successNotified: false,
      },
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ retCode: 4401, data: { authSuccess: false } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await resolveFeishuRealPersonAuthGate(createParams());

    expect(result).toEqual({
      action: "block",
      certToken: "pending-token",
      verificationUrl:
        "https://h5.dabby.com.cn/authhtml/index.html#/auth?certToken=pending-token&fromSource=Cclawd",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/checkAuthStatus");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("requests a new QR code when the stored certToken is expired", async () => {
    const now = Date.UTC(2026, 3, 28, 10, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    setAuthStore({
      ou_user_1: {
        authenticated: false,
        certToken: "expired-token",
        issuedAt: now - 5 * 60 * 1_000 - 1,
        successNotified: false,
      },
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            certToken: "fresh-token",
            qrCodeUrl: "https://qr.example/fresh-token",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await resolveFeishuRealPersonAuthGate(createParams());

    expect(result).toEqual({
      action: "block",
      certToken: "fresh-token",
      verificationUrl:
        "https://h5.dabby.com.cn/authhtml/index.html#/auth?certToken=fresh-token&fromSource=Cclawd",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/getVerifyCode");
    expect(readAuthStore()).toEqual({
      ou_user_1: {
        authenticated: false,
        certToken: "fresh-token",
        issuedAt: now,
        successNotified: false,
      },
    });
  });

  it("treats legacy records without issuedAt as expired and clears them on status checks", async () => {
    setAuthStore({
      ou_user_1: {
        authenticated: false,
        certToken: "legacy-token",
        successNotified: false,
      },
    });

    const result = await checkFeishuRealPersonAuthStatus(createParams());

    expect(result).toEqual({ status: "failed" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(readAuthStore()).toEqual({
      ou_user_1: {
        authenticated: false,
        successNotified: false,
      },
    });
  });
});
