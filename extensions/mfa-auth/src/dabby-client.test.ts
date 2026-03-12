import { describe, it, expect, vi, beforeEach } from "vitest";
import { dabbyConfig } from "./config.js";
import { DabbyClient } from "./dabby-client.js";

describe("DabbyClient", () => {
  let client: DabbyClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
    // Ensure apiKey is set for tests
    dabbyConfig.apiKey = "test-api-key";
    client = new DabbyClient(dabbyConfig);
  });

  describe("getVerifyCode", () => {
    it("should fetch verify code with API key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          retCode: 0,
          retMessage: "成功",
          apiVersion: "3.3.0",
          data: {
            authType: "ScanAuth",
            certToken: "cert-token-789",
            createdAt: "2024-01-01 00:00:00",
            expireAt: "2024-01-01 00:05:00",
            expireTimeMs: Date.now() + 5 * 60 * 1000,
            qrcodeContent: "https://h5.dabby.com.cn/authhtml/#/auth?certToken=cert-token-789",
            timestamp: Date.now(),
          },
        }),
      });

      const result = await client.getVerifyCode();
      expect(result.certToken).toBe("cert-token-789");
      expect(result.qrcodeContent).toContain("h5.dabby.com.cn");
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/getVerifyCode"),
        expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"apiKey":"test-api-key"'),
        })
      );
    });

    it("should throw error when API returns non-zero retCode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          retCode: 1001,
          retMessage: "生成二维码失败",
          apiVersion: "3.3.0",
          data: null,
        }),
      });

      await expect(client.getVerifyCode()).rejects.toThrow("Dabby API error: 生成二维码失败");
    });
  });

  describe("getAuthResult", () => {
    it("should return verified status when authSuccess is true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          retCode: 0,
          retMessage: "成功",
          data: {
            authSuccess: true,
            authResult: {
              idNum: "44000000000000",
              fullName: "张三",
            },
            message: "成功",
          },
        }),
      });

      const result = await client.getAuthResult("cert-token-789");
      expect(result.status).toBe("verified");
      expect(result.authObject?.fullName).toBe("张三");
      
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/checkAuthStatus"),
        expect.objectContaining({
            method: "POST",
            body: expect.stringContaining('"apiKey":"test-api-key"'),
        })
      );
    });

    it("should return failed status when authSuccess is false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          retCode: 0,
          retMessage: "成功",
          data: {
            authSuccess: false,
            authResult: {},
            message: "认证失败或超时",
          },
        }),
      });

      const result = await client.getAuthResult("cert-token-789");
      expect(result.status).toBe("failed");
      expect(result.error).toContain("认证失败或超时");
    });
    
    it("should return pending status when retCode is 4401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          retCode: 4401,
          retMessage: "等待认证",
          data: null,
        }),
      });

      const result = await client.getAuthResult("cert-token-789");
      expect(result.status).toBe("pending");
    });

    it("should return failed status on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          retCode: 500,
          retMessage: "服务器错误",
          data: null,
        }),
      });

      const result = await client.getAuthResult("cert-token-789");
      expect(result.status).toBe("failed");
      expect(result.error).toContain("服务器错误");
    });
  });

  describe("checkQrCodeExpired", () => {
    // This is not using config so we need to instantiate client
    it("should return true when QR code is expired", async () => {
      const expiredTime = Date.now() - 1000;
      const isExpired = await client.checkQrCodeExpired("cert-token", expiredTime);
      expect(isExpired).toBe(true);
    });

    it("should return false when QR code is not expired", async () => {
      const futureTime = Date.now() + 5 * 60 * 1000;
      const isExpired = await client.checkQrCodeExpired("cert-token", futureTime);
      expect(isExpired).toBe(false);
    });
  });
});
