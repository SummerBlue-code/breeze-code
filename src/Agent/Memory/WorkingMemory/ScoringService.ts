import type { SensoryFeature } from "../SensoryLayer/types";
import type { WorkingMemorySlot } from "./types";
import type {
  ScoringConfig,
  ScoringResult,
  SourceWeights,
  TemporalWeights,
} from "./ScoringConfig";
import { DEFAULT_SCORING_CONFIG } from "./ScoringConfig";
import { VectorIndex } from "@/Utils/VectorIndex";
import { EmbeddingService } from "@/Utils/Embedding";
export type { ScoringConfig, ScoringResult };

/**
 * 综合评分服务
 */
export class ScoringService {
  private readonly config: Required<ScoringConfig>;
  private readonly vectorIndex: VectorIndex;
  private readonly embeddingService: EmbeddingService;
  private rescoreTimer?: NodeJS.Timeout;

  constructor(
    config: ScoringConfig,
    vectorIndex: VectorIndex,
    embeddingService: EmbeddingService,
  ) {
    // 合并默认配置
    this.config = {
      ...DEFAULT_SCORING_CONFIG,
      ...config,
      sourceWeight: {
        ...DEFAULT_SCORING_CONFIG.sourceWeight,
        ...config.sourceWeight,
      },
      temporalWeight: {
        ...DEFAULT_SCORING_CONFIG.temporalWeight,
        ...config.temporalWeight,
      },
    };
    this.vectorIndex = vectorIndex;
    this.embeddingService = embeddingService;

    // 启动动态重评分定时器
    if (this.config.enableDynamicRescoring) {
      // 注意：定时器回调需要外部提供 rescoreAllSlots 方法
      // 这里不自动启动，由 WorkingMemory 统一管理
    }
  }

  /**
   * 计算初始评分（首次存储时调用）
   *
   * @param feature - 感知特征
   * @param existingSlots - 现有记忆槽位（用于上下文关联）
   * @returns 综合评分结果
   */
  async calculateInitialScore(
    feature: SensoryFeature,
    existingSlots: Map<string, WorkingMemorySlot>,
  ): Promise<ScoringResult> {
    const dimensions = {
      // 1. 重要性维度 [0, 1]
      importance: feature.importanceScore,

      // 2. 情感强度维度 [0, 1]
      sentimentIntensity: this.calculateSentimentIntensity(
        feature.sentiment || 0,
      ),

      // 3. 信息密度维度 [0, 1]
      informationDensity: this.calculateInformationDensity(feature),

      // 4. 时效性维度 [0, 1]
      recency: this.calculateRecency(feature),

      // 5. 来源维度 [0, 1] (归一化后)
      source: this.normalizeSourceWeight(
        feature.rawInput.source || "system",
        this.config.sourceWeight,
      ),
    };

    // 6. 上下文关联维度（可选）
    let contextual = 0;
    let contextInfo: ScoringResult["contextInfo"];

    if (
      this.config.enableContextualScoring &&
      existingSlots.size > 0 &&
      feature.embedding
    ) {
      const contextResult = await this.calculateContextualScore(
        feature,
        existingSlots,
      );
      contextual = contextResult.score;
      contextInfo = contextResult;

      // 如果检测为重复内容，应用惩罚
      if (contextResult.isDuplicate) {
        contextual = this.config.duplicatePenalty;
      }
    }

    // 计算加权总分（不包括上下文）
    const baseScore =
      dimensions.importance * this.config.importanceWeight +
      dimensions.sentimentIntensity * this.config.sentimentIntensityWeight +
      dimensions.informationDensity * this.config.informationDensityWeight +
      dimensions.recency * this.config.recencyWeight +
      dimensions.source * this.getSourceWeightNormalization();

    // 添加上下文关联加成
    const finalScore = Math.min(1, Math.max(0, baseScore + contextual));

    return {
      finalScore,
      passesThreshold: finalScore >= this.config.storageThreshold,
      dimensions: {
        ...dimensions,
        contextual:
          this.config.enableContextualScoring && contextual !== undefined
            ? contextual
            : undefined,
      },
      contextInfo,
      configSnapshot: { ...this.config },
    };
  }

  /**
   * 动态重评分（定期调用）
   *
   * @param slot - 需要重评分的记忆槽位
   * @returns 更新后的评分
   */
  rescoreSlot(slot: WorkingMemorySlot): number {
    const now = Date.now();

    // 1. 访问频率得分 [0, 1]
    const accessScore = Math.min(
      1,
      slot.metadata.accessCount / this.config.accessCountSaturation,
    );

    // 2. 访问新鲜度（指数衰减）
    const timeSinceLastAccess = now - slot.metadata.lastAccessed.getTime();
    const accessFreshness = Math.exp(
      -timeSinceLastAccess / this.config.timeDecayHalfLife,
    );

    // 3. 时间衰减（从创建时间开始）
    const timeSinceCreation = now - slot.metadata.createdAt.getTime();
    const timeDecay = Math.exp(
      -timeSinceCreation / (this.config.timeDecayHalfLife * 2),
    );

    // 4. 原始重要性
    const baseImportance = slot.metadata.confidence;

    // 综合计算
    const accessBoost = accessScore * this.config.accessBoostFactor;
    const freshnessBoost = accessFreshness * 0.1;
    const decayPenalty = (1 - timeDecay) * 0.2;

    const rescored = Math.min(
      1,
      Math.max(
        0,
        baseImportance * 0.6 + // 60% 来自原始重要性
          accessBoost + // 访问加成
          freshnessBoost - // 新鲜度加成
          decayPenalty, // 时间衰减惩罚
      ),
    );

    return rescored;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Required<ScoringConfig> {
    return { ...this.config };
  }

  // ========== 私有方法：维度计算 ==========

  /**
   * 计算情感强度 [0, 1]
   * 无论正负情感，强度越大得分越高
   */
  private calculateSentimentIntensity(sentiment: number): number {
    return Math.abs(sentiment);
  }

  /**
   * 计算信息密度 [0, 1]
   * 基于实体数量和内容长度
   */
  private calculateInformationDensity(feature: SensoryFeature): number {
    const contentLength =
      typeof feature.rawInput.content === "string"
        ? feature.rawInput.content.length
        : JSON.stringify(feature.rawInput.content).length;

    // 实体密度（饱和函数）
    const entityScore = Math.min(
      1,
      feature.entities.length / this.config.entityCountSaturation,
    );

    // 内容长度密度（饱和函数）
    const lengthScore = Math.min(
      1,
      contentLength / this.config.contentLengthSaturation,
    );

    // 加权组合
    return (
      entityScore * this.config.entityDensityWeight +
      lengthScore * this.config.contentLengthWeight
    );
  }

  /**
   * 计算时效性得分 [0, 1]
   */
  private calculateRecency(feature: SensoryFeature): number {
    const relativeTime = feature.temporalAnchor.relativeTime || "present";
    return this.config.temporalWeight[relativeTime];
  }

  /**
   * 归一化来源权重 [0, 1]
   */
  private normalizeSourceWeight(
    source: "user" | "system" | "tool",
    weights: SourceWeights,
  ): number {
    const maxWeight = Math.max(weights.user, weights.system, weights.tool);
    return weights[source] / maxWeight;
  }

  /**
   * 获取来源权重的归一化因子
   */
  private getSourceWeightNormalization(): number {
    const weights = this.config.sourceWeight;
    const maxWeight = Math.max(weights.user, weights.system, weights.tool);
    const sum = weights.user + weights.system + weights.tool;
    return maxWeight / sum;
  }

  /**
   * 计算上下文关联分数
   *
   * @returns 相似度加成分数和相关信息
   */
  private async calculateContextualScore(
    feature: SensoryFeature,
    existingSlots: Map<string, WorkingMemorySlot>,
  ): Promise<{
    score: number;
    mostSimilarId?: string;
    similarity?: number;
    isDuplicate?: boolean;
  }> {
    if (!feature.embedding || existingSlots.size === 0) {
      return { score: 0 };
    }

    // 使用 VectorIndex 搜索最相似的现有记忆
    const searchResults = await this.vectorIndex.search(
      feature.embedding,
      5, // top 5
    );

    if (searchResults.length === 0) {
      return { score: 0 };
    }

    const topResult = searchResults[0]!;
    const similarity = topResult.score;

    // 判断是否为重复内容
    const isDuplicate = similarity >= this.config.similarityThreshold;

    // 计算加成分数
    // 如果相似度适中 (0.4-0.85)，给予加成（表示上下文关联）
    // 如果相似度过高 (>0.85)，判定为重复，在 calculateInitialScore 中应用惩罚
    let score = 0;
    if (!isDuplicate && similarity > 0.4) {
      // 归一化到 [0, 1]，然后应用加成系数
      const normalizedSim =
        (similarity - 0.4) / (this.config.similarityThreshold - 0.4);
      score = normalizedSim * this.config.similarityBoost;
    }

    return {
      score,
      mostSimilarId: topResult.id,
      similarity,
      isDuplicate,
    };
  }

  // ========== 资源清理 ==========

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.rescoreTimer) {
      clearTimeout(this.rescoreTimer);
      this.rescoreTimer = undefined;
    }
  }
}
