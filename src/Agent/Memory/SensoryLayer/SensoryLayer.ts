// src/core/SensoryLayer.ts
import { v4 as uuidv4 } from "uuid";
import type { SensoryInput, SensoryFeature } from "./types";
import { EmbeddingService } from "@/Utils/Embedding";
import type { ILLM } from "@/LLM";
import { NLPService } from "./NLPService";

export class SensoryLayer {
  private buffer: Map<string, SensoryFeature> = new Map();
  private readonly bufferSizeLimit = 100;
  private readonly decayThreshold = 500;
  private readonly embeddingService: EmbeddingService;
  private readonly nlpService: NLPService;

  // ===== 常量定义 =====
  private static readonly TEMPORAL_PAST_THRESHOLD_MS = 60000; // 1 分钟
  private static readonly TEMPORAL_FUTURE_THRESHOLD_MS = 60000;
  private static readonly IMPORTANCE_BASE_SCORE = 0.3;

  constructor(
    embeddingService: EmbeddingService,
    llm: ILLM,
    nlpConfig?: {
      maxCacheSize?: number;
      cacheTTL?: number;
      enableCache?: boolean;
    },
  ) {
    this.embeddingService = embeddingService;
    this.nlpService = new NLPService(llm, nlpConfig);
  }

  async process(input: SensoryInput): Promise<SensoryFeature> {
    const now = input.timestamp || new Date();

    // 仅支持文本输入
    if (input.type !== "text" || typeof input.content !== "string") {
      throw new Error(`SensoryLayer仅支持文本输入（收到: ${input.type}）`);
    }

    // 并行执行特征提取（优化性能）
    const [embedding, entityResult, sentimentResult] = await Promise.all([
      this.embeddingService.embed(input.content),
      this.extractEntities(input.content),
      this.analyzeSentiment(input.content),
    ]);

    const entities = entityResult.entities;
    const entityCategories = entityResult.categories;
    const sentiment = sentimentResult.score;

    const feature: SensoryFeature = {
      id: uuidv4(),
      rawInput: input,
      embedding,
      entities,
      sentiment,
      importanceScore: await this.calculateImportance(
        input.content,
        entityCategories,
        sentiment,
      ),
      temporalAnchor: {
        timestamp: now,
        relativeTime: this.estimateTemporalRelation(now),
      },
    };

    // 写入缓冲
    this.buffer.set(feature.id, feature);
    if (this.buffer.size > this.bufferSizeLimit) {
      const oldestKey = Array.from(this.buffer.keys())[0]!;
      this.buffer.delete(oldestKey);
    }

    // 自动衰减
    setTimeout(() => this.buffer.delete(feature.id), this.decayThreshold);

    return feature;
  }

  // ===== NLP 方法（使用 LLM API） =====

  /**
   * 提取文本中的实体
   * 使用 LLM API 进行命名实体识别 (NER)
   */
  private async extractEntities(text: string) {
    return this.nlpService.extractEntities(text);
  }

  /**
   * 分析文本情感倾向
   * 使用 LLM API 进行情感分析
   * 返回值范围: -1 (负面) 到 1 (正面)
   */
  private async analyzeSentiment(text: string) {
    return this.nlpService.analyzeSentiment(text);
  }

  /**
   * 计算文本重要性评分
   * 使用 LLM API 综合评估内容重要性
   * 返回值范围: 0 到 1
   */
  private async calculateImportance(
    text: string,
    entityCategories?: Array<{ entity: string; type: string }>,
    sentiment?: number,
  ): Promise<number> {
    const result = await this.nlpService.calculateImportance(
      text,
      entityCategories,
      sentiment,
    );
    console.log(`文本: ${text} 重要性理由: ${result.reasons.join(", ")}`);
    return Math.min(1, Math.max(0, result.score));
  }

  /**
   * 估算时间关系
   * 判断给定时间戳相对于当前时间是过去、现在还是未来
   */
  private estimateTemporalRelation(
    timestamp: Date,
  ): "past" | "present" | "future" {
    const diff = timestamp.getTime() - Date.now();
    if (diff < -SensoryLayer.TEMPORAL_PAST_THRESHOLD_MS) return "past";
    if (diff > SensoryLayer.TEMPORAL_FUTURE_THRESHOLD_MS) return "future";
    return "present";
  }

  // ===== 缓存管理 =====

  /**
   * 获取 NLP 缓存统计信息
   */
  getNLPStats() {
    return this.nlpService.getCacheStats();
  }

  /**
   * 清除 NLP 缓存
   */
  clearNLPCache(): void {
    this.nlpService.clearCache();
  }

  // ===== 缓冲区管理 =====

  getBufferStats() {
    const values = Array.from(this.buffer.values());
    return {
      size: this.buffer.size,
      capacity: this.bufferSizeLimit,
      oldest: values[0]?.temporalAnchor.timestamp || null,
      newest: values[values.length - 1]?.temporalAnchor.timestamp || null,
    };
  }
}
