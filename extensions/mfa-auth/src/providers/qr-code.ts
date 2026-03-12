import { authManager } from "../auth-manager.js";
import { config } from "../config.js";
import { dabbyClient } from "../dabby-client.js";
import { renderQrPngBase64 } from "../qr.js";
import type { AuthSession, AuthResult } from "../types.js";
import { BaseAuthProvider } from "./base.js";

export class QrCodeAuthProvider extends BaseAuthProvider {
  readonly methodType = "qr-code" as const;
  readonly name = "QR Code Authentication";
  readonly description = "Scan QR code to authenticate";

  async initialize(session: AuthSession): Promise<void> {
    try {
      const tokenInfo = await dabbyClient.getVerifyCode();

      authManager.updateAuthStatus(session.sessionId, "pending");
      session.certToken = tokenInfo.certToken;
      session.qrcodeContent = tokenInfo.qrcodeContent;
      session.expireTimeMs = tokenInfo.expireTimeMs;
      session.authStatus = "pending";

      console.log(`[mfa-auth] QR code initialized for session ${session.sessionId}`);
    } catch (error) {
      console.error(`[mfa-auth] Failed to initialize QR code: ${error}`);
      throw error;
    }
  }

  async verify(sessionId: string, userInput?: string): Promise<AuthResult> {
    const session = authManager.getSession(sessionId);
    if (!session) {
      return { success: false, error: "Session not found", status: "failed" };
    }

    if (!session.certToken) {
      return { success: false, error: "QR code not initialized", status: "failed" };
    }

    if (session.expireTimeMs && Date.now() > session.expireTimeMs) {
      authManager.updateAuthStatus(sessionId, "expired");
      return { success: false, error: "QR code expired", status: "expired" };
    }

    try {
      const result = await dabbyClient.getAuthResult(session.certToken);

      if (result.status === "verified") {
        authManager.updateAuthStatus(sessionId, "verified");
        return { success: true, status: "verified" };
      }

      if (result.status === "failed") {
        authManager.updateAuthStatus(sessionId, "failed");
        return { success: false, error: result.error || "Authentication failed", status: "failed" };
      }

      return { success: false, status: result.status };
    } catch (error) {
      console.error(`[mfa-auth] Failed to verify QR code: ${error}`);
      return { success: false, error: String(error), status: "failed" };
    }
  }

  async generateAuthPage(session: AuthSession, authUrl: string): Promise<string> {
    const remainingTime = Math.max(
      0,
      Math.ceil((config.timeout - (Date.now() - session.timestamp)) / 1000),
    );
    const triggerType = session.originalContext.triggerType || "sensitive_operation";
    const commandPreview =
      session.originalContext.commandBody.length > 100
        ? session.originalContext.commandBody.substring(0, 100) + "..."
        : session.originalContext.commandBody;

    const qrCode = session.qrcodeContent ? await renderQrPngBase64(session.qrcodeContent) : "";
    const isReauth = session.originalContext.commandBody.trim() === "/reauth";

    return this.renderHtml(
      session.sessionId,
      commandPreview,
      qrCode,
      remainingTime,
      triggerType,
      isReauth,
      authUrl,
      session.qrcodeContent || "",
    );
  }

  private renderHtml(
    sessionId: string,
    commandPreview: string,
    qrCode: string,
    remainingTime: number,
    triggerType: "first_message" | "sensitive_operation" = "sensitive_operation",
    isReauth: boolean = false,
    authUrl: string,
    qrCodeContent: string,
  ): string {
    const escapedPreview = this.escapeHtml(commandPreview);
    const isFirstMessageAuth = triggerType === "first_message";
    const pageTitle = isFirstMessageAuth ? (isReauth ? "重新认证" : "首次认证") : "二次认证";
    const pageTitleWithIcon = isFirstMessageAuth
      ? isReauth
        ? "🔐 重新认证"
        : "🔐 首次认证"
      : "🔐 二次认证";

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 400px;
      width: 90%;
    }
    h1 {
      color: #333;
      margin-top: 0;
      font-size: 24px;
      text-align: center;
    }
    .info {
      background: #f7fafc;
      padding: 15px;
      border-radius: 6px;
      margin: 20px 0;
      font-size: 14px;
      color: #4a5568;
    }
    .info strong {
      color: #2d3748;
    }
    .timer {
      text-align: center;
      color: #e53e3e;
      font-weight: 600;
      margin: 10px 0;
    }
    .status {
      text-align: center;
      padding: 10px;
      border-radius: 6px;
      margin: 10px 0;
      font-weight: 600;
      display: none;
    }
    .status.error {
      background: #fed7d7;
      color: #742a2a;
      display: block;
    }
    .result {
      text-align: center;
      padding: 15px;
      border-radius: 6px;
      margin-top: 20px;
      font-weight: 600;
      display: none;
      white-space: pre-line;
    }
    .result.success {
      background: transparent;
      color: #111827;
      padding: 0;
      white-space: normal;
    }
    .result.error {
      background: #fed7d7;
      color: #742a2a;
    }
    .qr-section {
      text-align: center;
      margin: 20px 0;
      padding: 15px;
      background: #f7fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .qr-section h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #4a5568;
    }
    .qr-image {
      display: inline-block;
      padding: 10px;
      background: white;
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .qr-actions {
      margin-top: 15px;
    }
    .refresh-btn {
      background: white;
      border: 1px solid #dcdfe6;
      color: #606266;
      padding: 8px 15px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .refresh-btn:hover {
      color: #409eff;
      border-color: #c6e2ff;
      background-color: #ecf5ff;
    }
    .refresh-btn:disabled {
      color: #c0c4cc;
      cursor: not-allowed;
      border-color: #ebeef5;
      background-color: #fff;
    }
    .qr-link {
      margin-top: 15px;
      text-align: center;
      padding: 10px;
      background: #f7fafc;
      border-radius: 6px;
    }
    .qr-link-label {
      font-size: 12px;
      color: #718096;
      margin-bottom: 5px;
    }
    .qr-link-url {
      color: #3b82f6;
      text-decoration: none;
      word-break: break-all;
      font-size: 13px;
    }
    .qr-link-url:hover {
      text-decoration: underline;
      color: #2563eb;
    }
    body.success-mode {
      background: #ffffff;
    }
    .container.success-mode {
      max-width: 520px;
      width: 100%;
      box-shadow: none;
      border-radius: 0;
      padding: 70px 30px;
    }
    .success-view {
      text-align: center;
    }
    .success-icon {
      width: 110px;
      height: 110px;
      border-radius: 9999px;
      background: #67c23a;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 22px auto;
    }
    .success-icon::before {
      content: "✓";
      color: #ffffff;
      font-size: 64px;
      line-height: 1;
      font-weight: 700;
      transform: translateY(-2px);
    }
    .success-title {
      margin: 0 0 14px 0;
      font-size: 34px;
      color: #111827;
      letter-spacing: 1px;
    }
    .success-subtitle {
      margin: 0;
      font-size: 18px;
      color: #6b7280;
      line-height: 1.7;
    }
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${pageTitleWithIcon}</h1>
    <div class="info">
      <p>待验证操作:</p>
      <strong>${escapedPreview}</strong>
    </div>
    <div class="qr-section">
      <h3>📱 请打开【微信或数字身份助手APP】扫码</h3>
      <div class="qr-image">
        ${qrCode ? `<img id="qr-img" src="data:image/png;base64,${qrCode}" alt="认证二维码" width="200" height="200">` : '<p class="loading"></p><p>正在生成二维码...</p>'}
      </div>
      <div class="qr-actions">
        <button id="refresh-btn" class="refresh-btn" onclick="refreshQrCode()">
          <span class="refresh-icon">🔄</span> 刷新二维码
        </button>
      </div>
      <div class="qr-link">
        <div class="qr-link-label">🔗 二维码链接：</div>
        <a href="${qrCodeContent}" class="qr-link-url" id="qr-link-url" target="_blank">${qrCodeContent}</a>
      </div>
    </div>
    <div class="timer">⏱️ 有效期: <span id="timer">${Math.floor(remainingTime / 60)}:${String(remainingTime % 60).padStart(2, "0")}</span></div>
    <div id="status" class="status"></div>
    <div id="result" class="result"></div>
  </div>
  <script>
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    const sessionId = "${sessionId}";
    const triggerType = "${triggerType}";
    const isFirstMessageAuth = triggerType === "first_message";
    const isReauth = ${isReauth};
    let timeLeft = ${remainingTime};
    let pollInterval;
    let timerInterval;
    let isPolling = true;

    function updateTimer() {
      const timerEl = document.getElementById('timer');
      if (!timerEl) return;
      
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      timerEl.textContent = minutes + ':' + String(seconds).padStart(2, '0');
      
      if (timeLeft <= 0) {
        clearInterval(pollInterval);
        clearInterval(timerInterval);
        isPolling = false;
        showExpired();
      }
      timeLeft--;
    }

    function showSuccess() {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
      isPolling = false;

      const result = document.getElementById('result');
      // Ensure result is visible immediately
      if (result) {
          result.style.display = 'block';
          result.classList.add('success');
          result.classList.remove('error');
      }

      const qrSection = document.querySelector('.qr-section');
      const timerDiv = document.querySelector('.timer');
      const infoEl = document.querySelector('.info');
      const headingEl = document.querySelector('h1');
      const containerEl = document.querySelector('.container');
      const operationEl = document.querySelector('.info strong');
      const statusEl = document.getElementById('status');
      const refreshBtn = document.getElementById('refresh-btn');

      if (refreshBtn) refreshBtn.style.display = 'none';

      const operationName = operationEl ? operationEl.textContent.trim() : '';
      const operationNameTag = operationName ? '【' + escapeHtml(operationName) + '】' : '';

      let successMessage = '';
      if (isFirstMessageAuth) {
        successMessage = isReauth 
          ? '✅ 认证成功！请回到聊天窗口，重新发送消息以继续对话。'
          : '✅ 认证成功！请回到聊天窗口，重新发送消息以继续对话。';
      } else {
        successMessage = '✅ 认证成功！<br><br>请回到聊天窗口，重新发送之前的命令' + operationNameTag + '即可执行。';
      }

      if (result) {
        result.innerHTML =
            '<div class="success-view">' +
            '<div class="success-icon"></div>' +
            '<h2 class="success-title">扫码认证成功</h2>' +
            '<p class="success-subtitle">' + successMessage + '</p>' +
            '</div>';
      }

      if (qrSection) qrSection.style.display = 'none';
      if (timerDiv) timerDiv.style.display = 'none';
      if (infoEl) infoEl.style.display = 'none';
      if (headingEl) headingEl.style.display = 'none';
      if (statusEl) statusEl.style.display = 'none';
      if (containerEl) containerEl.classList.add('success-mode');
      document.body.classList.add('success-mode');
    }

    function showError(message) {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
      isPolling = false;

      const result = document.getElementById('result');
      result.textContent = '❌ ' + message;
      result.style.display = 'block';
      result.classList.add('error');
      result.classList.remove('success');
    }

    function showExpired() {
      clearInterval(pollInterval);
      clearInterval(timerInterval);
      isPolling = false;

      const result = document.getElementById('result');
      result.innerHTML = '⚠️ 二维码已过期<br><button onclick="refreshQrCode()" class="refresh-btn" style="margin-top:10px">🔄 点击刷新</button>';
      result.style.display = 'block';
      result.classList.add('error');
      result.classList.remove('success');
      
      const timerEl = document.getElementById('timer');
      if(timerEl) timerEl.textContent = "0:00";
    }

    async function refreshQrCode() {
        const btn = document.getElementById('refresh-btn');
        const img = document.getElementById('qr-img');
        const result = document.getElementById('result');
        const statusEl = document.getElementById('status');
        
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="loading" style="width:14px;height:14px;border-width:2px;margin-right:5px"></span> 刷新中...';
        }

        try {
            const response = await fetch('/mfa-auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (img) img.src = 'data:image/png;base64,' + data.qrcodeBase64;

                // 更新二维码链接
                const qrLink = document.getElementById('qr-link-url');
                if (qrLink && data.qrcodeContent) {
                    qrLink.href = data.qrcodeContent;
                    qrLink.textContent = data.qrcodeContent;
                }

                timeLeft = data.remainingTime;
                isPolling = true;
                
                // Hide error/result
                result.style.display = 'none';
                if (statusEl) statusEl.style.display = 'none';
                
                // Reset timer interval if needed
                // It runs every 1s, so just updating timeLeft is enough
                
                // Restart polling if stopped
                clearInterval(pollInterval);
                clearInterval(timerInterval);
                pollInterval = setInterval(pollAuthStatus, 2000);
                timerInterval = setInterval(updateTimer, 1000);
                
                // Reset button
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span class="refresh-icon">🔄</span> 刷新二维码';
                }
            } else {
                throw new Error(data.error || '刷新失败');
            }
        } catch (error) {
            alert('刷新失败: ' + error.message);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="refresh-icon">🔄</span> 重试刷新';
            }
        }
    }

    async function pollAuthStatus() {
      if (!isPolling) return;

      try {
        console.log('[mfa-auth] Polling auth status for session:', sessionId);
        const response = await fetch('/mfa-auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        const data = await response.json();
        console.log('[mfa-auth] Poll response:', data);

        if (data.success) {
          clearInterval(pollInterval);
          isPolling = false;
          showSuccess();
        } else if (data.status === 'failed') {
          showError(data.error || '认证失败，请重试');
        } else if (data.status === 'expired') {
          showExpired();
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }

    timerInterval = setInterval(updateTimer, 1000);
    pollInterval = setInterval(pollAuthStatus, 2000);
    pollAuthStatus();
  </script>
</body>
</html>
    `;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (c) => map[c]);
  }
}

class QrCodeAuthProviderFactory {
  private static instance: QrCodeAuthProvider | null = null;

  static getInstance(): QrCodeAuthProvider {
    if (!this.instance) {
      this.instance = new QrCodeAuthProvider();
      console.log("[QrCodeAuthProviderFactory] Created new QrCodeAuthProvider instance");
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log("[QrCodeAuthProviderFactory] Reset QrCodeAuthProvider instance");
  }
}

export const qrCodeAuthProvider = QrCodeAuthProviderFactory.getInstance();
