/**
 * 纯OpenAI嵌入服务 - 极致简化
 *
 * 特点:
 * ✅ 仅OpenAI，无任何降级逻辑
 * ✅ 无并发控制（由调用方管理）
 * ✅ 保留核心可靠性：重试 + 超时
 * ✅ 严格配置验证
 * ✅ 完整错误诊断
 */

import { OpenAI } from "openai";
import pRetry from "p-retry";
import dotenv from "dotenv";

// 加载环境变量
if (typeof process !== "undefined" && process.env) {
  dotenv.config();
}

export interface EmbeddingConfig {
  backend: "openai"; // 仅支持OpenAI

  /** OpenAI API密钥（必须） */
  apiKey: string;

  /** 嵌入模型（默认: text-embedding-3-small） */
  model: string;

  /** 期望的嵌入维度（默认: 1536） */
  dimension?: number;

  /** 最大重试次数（默认: 3） */
  maxRetries?: number;

  /** 超时时间（毫秒，默认: 30000） */
  timeoutMs?: number;

  /** 自定义OpenAI基础URL（可选） */
  baseURL: string;
}

export class EmbeddingService {
  private readonly client: OpenAI;
  private readonly config: Required<Omit<EmbeddingConfig, "apiKey">>;
  private readonly modelToDimension: Record<string, number> = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
  };

  // 简化指标（仅关键指标）
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    tokensUsed: 0,
  };

  constructor(config: EmbeddingConfig) {
    // 1. 严格验证API密钥
    if (!config.apiKey?.trim()) {
      throw new Error(
        "[EmbeddingService] 缺少OpenAI API密钥。请设置OPENAI_API_KEY环境变量。",
      );
    }

    if (!config.apiKey.startsWith("sk-")) {
      throw new Error(
        '[EmbeddingService] 无效的OpenAI API密钥格式。密钥应以"sk-"开头。',
      );
    }

    // 2. 设置配置
    this.config = {
      backend: "openai",
      model: config.model,
      dimension:
        config.dimension || this.modelToDimension[config.model] || 1536,
      maxRetries: config.maxRetries || 3,
      timeoutMs: config.timeoutMs || 30000,
      baseURL: config.baseURL,
    };

    // 3. 初始化OpenAI客户端
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeoutMs,
    });

    console.log(
      `[EmbeddingService] ✅ 初始化 | 模型: ${this.config.model} | 维度: ${this.config.dimension}d`,
    );
  }

  /**
   * 生成文本嵌入
   * @param text - 输入文本（自动截断至8000字符）
   */
  async embed(text: string): Promise<Float32Array> {
    // 1. 截断超长文本
    const input = text.length > 8000 ? text.substring(0, 8000) + "..." : text;

    // 2. 更新指标
    this.metrics.totalRequests++;

    try {
      // 3. 调用OpenAI（带重试）
      const embedding = await pRetry(() => this.callOpenAIEmbedding(input), {
        retries: this.config.maxRetries,
        onFailedAttempt: (error) => {
          console.warn(
            `[EmbeddingService] 重试 ${error.attemptNumber}/${this.config.maxRetries}: ${error.error.message}`,
          );
        },
        shouldRetry: (error) => {
          if (error instanceof OpenAI.APIError) {
            return error.status === 429 || error.status >= 500;
          }
          return false;
        },
      });

      // 4. 验证维度
      if (embedding.length !== this.config.dimension) {
        throw new Error(
          `嵌入维度错误: 期望 ${this.config.dimension}d, 实际 ${embedding.length}d`,
        );
      }

      this.metrics.successfulRequests++;
      return embedding;
    } catch (error) {
      this.metrics.failedRequests++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[EmbeddingService] 嵌入失败: ${message}`);
      throw error;
    }
  }

  private async callOpenAIEmbedding(text: string): Promise<Float32Array> {
    // 使用AbortController实现超时
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const response = await this.client.embeddings.create(
        {
          model: this.config.model,
          input: text,
          encoding_format: "float",
        },
        {
          signal: controller.signal,
        },
      );

      this.metrics.tokensUsed += response.usage?.total_tokens || 0;
      return new Float32Array(response.data[0]!.embedding);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 余弦相似度计算
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`向量维度不匹配: ${a.length} vs ${b.length}`);
    }

    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      magA += a[i]! * a[i]!;
      magB += b[i]! * b[i]!;
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
  }

  /**
   * 健康状态
   */
  getHealthStatus() {
    const successRate =
      this.metrics.totalRequests > 0
        ? this.metrics.successfulRequests / this.metrics.totalRequests
        : 0;

    return {
      backend: this.config.backend,
      model: this.config.model,
      metrics: {
        totalRequests: this.metrics.totalRequests,
        successRate: `${(successRate * 100).toFixed(1)}%`,
        tokensUsed: this.metrics.tokensUsed,
      },
    };
  }
}

let embeddingService: EmbeddingService;

export function getEmbeddingService(
  config?: EmbeddingConfig,
): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService(
      config || {
        backend: "openai",
        apiKey: "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
        model: "text-embedding-3-small",
        baseURL: "https://yunwu.ai/v1",
      },
    );
  }
  return embeddingService;
}
