/**
 * Cclawd MFA Auth Plugin - Sensitive Operation Detector
 * 
 * 检测敏感操作
 */

import { config } from './config.js';
import type { SensitiveCheckResult } from './types.js';

/**
 * 敏感操作检测器
 */
export class SensitiveDetector {
  private config = config;

  /**
   * 检查文本是否包含敏感内容
   */
  check(text: string): SensitiveCheckResult {
    const lowerText = text.toLowerCase();

    if (this.config.debug) {
      console.log(`[cclawd-mfa-auth] Checking sensitive keywords for: ${text}`);
      console.log(
        `[cclawd-mfa-auth] Sensitive keywords configured: ${JSON.stringify(this.config.sensitiveKeywords)}`,
      );
    }

    const matchedKeywords: string[] = [];

    for (const keyword of this.config.sensitiveKeywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length > 0) {
      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] Sensitive keywords matched: ${matchedKeywords.join(', ')}`);
      }
      return {
        isSensitive: true,
        preview: text,
        matchedKeywords,
      };
    }

    if (this.config.debug) {
      console.log(`[cclawd-mfa-auth] No sensitive keyword matched`);
    }

    return {
      isSensitive: false,
      preview: '',
      matchedKeywords: [],
    };
  }

  /**
   * 检查工具调用是否为敏感操作
   */
  checkToolCall(toolName: string, params: Record<string, unknown>): SensitiveCheckResult {
    // 定义敏感工具列表
    const sensitiveTools = ['bash', 'exec', 'runCommand', 'command', 'process'];

    if (!sensitiveTools.includes(toolName)) {
      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] Tool ${toolName} is not in sensitive list, allowing`);
      }
      return {
        isSensitive: false,
        preview: '',
        matchedKeywords: [],
      };
    }

    // 提取命令内容
    const command =
      typeof params?.command === 'string'
        ? params.command
        : typeof params?.cmd === 'string'
          ? params.cmd
          : typeof params?.input === 'string'
            ? params.input
            : typeof params?.args === 'string'
              ? params.args
              : '';

    if (this.config.debug) {
      console.log(`[cclawd-mfa-auth] Extracted command from ${toolName}: ${command}`);
    }

    if (!command) {
      if (this.config.debug) {
        console.log(`[cclawd-mfa-auth] No command found in params, allowing`);
      }
      return {
        isSensitive: false,
        preview: '',
        matchedKeywords: [],
      };
    }

    // 检查命令内容
    return this.check(command);
  }

  /**
   * 添加自定义敏感关键词
   */
  addSensitiveKeyword(keyword: string): void {
    const normalized = keyword.toLowerCase().trim();
    if (normalized && !this.config.sensitiveKeywords.includes(normalized)) {
      this.config.sensitiveKeywords.push(normalized);
      console.log(`[cclawd-mfa-auth] Added sensitive keyword: ${normalized}`);
    }
  }

  /**
   * 移除敏感关键词
   */
  removeSensitiveKeyword(keyword: string): void {
    const normalized = keyword.toLowerCase().trim();
    const index = this.config.sensitiveKeywords.indexOf(normalized);
    if (index !== -1) {
      this.config.sensitiveKeywords.splice(index, 1);
      console.log(`[cclawd-mfa-auth] Removed sensitive keyword: ${normalized}`);
    }
  }

  /**
   * 获取所有敏感关键词
   */
  getSensitiveKeywords(): string[] {
    return [...this.config.sensitiveKeywords];
  }
}

/**
 * 敏感操作检测器工厂
 */
class SensitiveDetectorFactory {
  private static instance: SensitiveDetector | null = null;

  static getInstance(): SensitiveDetector {
    if (!this.instance) {
      this.instance = new SensitiveDetector();
      console.log('[SensitiveDetectorFactory] Created new SensitiveDetector instance');
    }
    return this.instance;
  }

  static reset(): void {
    this.instance = null;
    console.log('[SensitiveDetectorFactory] Reset SensitiveDetector instance');
  }
}

export const sensitiveDetector = SensitiveDetectorFactory.getInstance();
