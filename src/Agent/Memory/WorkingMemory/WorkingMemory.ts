// src/core/WorkingMemory.ts
import { v4 as uuidv4 } from "uuid";
import type { RetrievalQuery } from "../types";
import type { WorkingMemorySlot } from "./types";
import type { SensoryFeature } from "../SensoryLayer/types";
import { VectorIndex } from "@/Utils/VectorIndex";
import { EmbeddingService } from "@/Utils/Embedding";
import {
  ScoringService,
  type ScoringConfig,
  type ScoringResult,
} from "./ScoringService";

export class WorkingMemory {
  private slots: Map<string, WorkingMemorySlot> = new Map();
  private readonly capacity: number;
  private readonly scoringService: ScoringService;
  private readonly vectorIndex: VectorIndex;
  private readonly embeddingService: EmbeddingService;
  private accessHistory: string[] = [];
  private rescoreTimer?: NodeJS.Timeout;

  constructor(
    capacity: number,
    embeddingService: EmbeddingService,
    vectorIndex: VectorIndex,
    config?: ScoringConfig,
  ) {
    if (capacity < 1) throw new Error("容量必须 >= 1");
    this.capacity = capacity;
    this.embeddingService = embeddingService;
    this.vectorIndex = vectorIndex;

    // 初始化评分服务
    this.scoringService = new ScoringService(
      config || {},
      vectorIndex,
      embeddingService,
    );

    // 启动动态重评分定时器
    const scoringConfig = this.scoringService.getConfig();
    if (scoringConfig.enableDynamicRescoring) {
      this.rescoreTimer = setInterval(async () => {
        await this.rescoreAllSlots();
      }, scoringConfig.rescoreInterval);
    }
  }

  async addFromSensory(
    feature: SensoryFeature,
    options?: {
      /** 跳过评分检查，强制添加 */
      force?: boolean;
      /** 返回评分详情（用于调试） */
      returnScoringResult?: boolean;
    },
  ): Promise<
    string | null | { slotId: string | null; scoringResult?: ScoringResult }
  > {
    // 使用综合评分服务计算评分
    const scoringResult = await this.scoringService.calculateInitialScore(
      feature,
      this.slots,
    );

    // 检查是否通过阈值（除非强制添加）
    if (!scoringResult.passesThreshold && !options?.force) {
      return options?.returnScoringResult
        ? { slotId: null, scoringResult }
        : null;
    }

    // 内容压缩
    let content: any;
    const rawContent = feature.rawInput.content as string;
    if (
      typeof rawContent === "string" &&
      /\b(预订|查询|设置|取消)\b/.test(rawContent)
    ) {
      content = {
        task: rawContent.match(/(预订|查询|设置|取消)/)?.[0],
        entities: feature.entities,
      };
    } else {
      content = {
        summary:
          rawContent.substring(0, 50) + (rawContent.length > 50 ? "..." : ""),
        entities: feature.entities,
      };
    }

    const slotId = uuidv4();
    const now = new Date();

    // 正确构建 metadata 对象（注意：不是 meta）
    const metadata: WorkingMemorySlot["metadata"] = {
      id: slotId,
      createdAt: now,
      lastAccessed: now,
      accessCount: 0,
      confidence: scoringResult.finalScore, // 使用综合评分作为置信度
      source: feature.rawInput.source || "system",
      tags: [...feature.entities, "text"],
      contextHash: this.hashContent(content),
      sourceFeatureId: feature.id,
      compressionRatio: 0.5,
      relevanceScore: scoringResult.finalScore, // 使用综合评分作为相关性评分
    };

    const slot: WorkingMemorySlot = {
      id: slotId,
      content,
      metadata,
      embedding: feature.embedding,
      expiresAt: new Date(
        now.getTime() + (/\b(预订|查询)\b/.test(rawContent) ? 30 : 10) * 60000,
      ),
    };

    // 插入槽位
    if (this.slots.size >= this.capacity) {
      this.evictLeastRelevant();
    }
    this.slots.set(slotId, slot);
    this.accessHistory.push(slotId);

    // 更新向量索引
    if (slot.embedding) {
      await this.vectorIndex.add(slotId, slot.embedding);
    }

    return options?.returnScoringResult ? { slotId, scoringResult } : slotId;
  }

  async search(
    query: string,
    options: RetrievalQuery["options"] = {},
  ): Promise<WorkingMemorySlot[]> {
    const { topK = 5, minRelevance = 0.3, includeExpired = false } = options;
    const results: { slot: WorkingMemorySlot; score: number }[] = [];
    const queryEmbedding = await this.embeddingService.embed(query);
    const now = new Date();

    // 1. 语义检索
    const semanticResults = await this.vectorIndex.search(
      queryEmbedding,
      Math.max(topK * 2, 10),
    );
    for (const { id, score } of semanticResults) {
      const slot = this.slots.get(id);
      if (!slot) continue;
      if (!includeExpired && slot.expiresAt && slot.expiresAt < now) continue;
      if (score >= minRelevance) {
        results.push({ slot, score: score * 0.7 });
      }
    }

    // 2. 精确匹配
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    for (const slot of this.slots.values()) {
      if (!includeExpired && slot.expiresAt && slot.expiresAt < now) continue;
      const contentStr = JSON.stringify(slot.content).toLowerCase();
      if (terms.some((term) => contentStr.includes(term))) {
        const existing = results.find((r) => r.slot.id === slot.id);
        if (existing) {
          existing.score = Math.max(existing.score, 0.9);
        } else {
          results.push({ slot, score: 0.85 });
        }
      }
    }

    // 3. 重排序
    const ranked = results.sort((a, b) => {
      const ageA = now.getTime() - a.slot.metadata.lastAccessed.getTime();
      const ageB = now.getTime() - b.slot.metadata.lastAccessed.getTime();
      const timeBoostA = Math.exp(-ageA / 600000);
      const timeBoostB = Math.exp(-ageB / 600000);
      const scoreA =
        a.score * 0.5 +
        timeBoostA * 0.3 +
        Math.min(0.3, a.slot.metadata.accessCount * 0.05) * 0.2;
      const scoreB =
        b.score * 0.5 +
        timeBoostB * 0.3 +
        Math.min(0.3, b.slot.metadata.accessCount * 0.05) * 0.2;
      return scoreB - scoreA;
    });

    // 4. 更新访问统计并返回
    return ranked.slice(0, topK).map((r) => {
      r.slot.metadata.lastAccessed = new Date();
      r.slot.metadata.accessCount++;
      return r.slot;
    });
  }

  /**
   * 动态重评分所有槽位（定期调用）
   */
  async rescoreAllSlots(): Promise<void> {
    for (const [id, slot] of this.slots.entries()) {
      const newScore = this.scoringService.rescoreSlot(slot);
      slot.metadata.confidence = newScore;
      slot.metadata.relevanceScore = newScore;
    }
  }

  private evictLeastRelevant(): void {
    if (this.slots.size === 0) return;

    // 使用动态评分找出最应该淘汰的槽位
    let candidateToEvict: WorkingMemorySlot | null = null;
    let minScore = Infinity;

    for (const slot of this.slots.values()) {
      const dynamicScore = this.scoringService.rescoreSlot(slot);
      if (dynamicScore < minScore) {
        minScore = dynamicScore;
        candidateToEvict = slot;
      }
    }

    if (candidateToEvict) {
      this.slots.delete(candidateToEvict.id);
      this.vectorIndex.remove(candidateToEvict.id);
      this.accessHistory = this.accessHistory.filter(
        (id) => id !== candidateToEvict!.id,
      );
    }
  }

  private hashContent(content: any): string {
    const str = JSON.stringify(content);
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36).slice(0, 8);
  }

  size(): number {
    return this.slots.size;
  }

  getSlots(): WorkingMemorySlot[] {
    return Array.from(this.slots.values());
  }

  clear(): void {
    this.slots.clear();
    this.accessHistory = [];
    // 清理定时器和评分服务
    if (this.rescoreTimer) {
      clearInterval(this.rescoreTimer);
      this.rescoreTimer = undefined;
    }
    this.scoringService.destroy();
  }

  /**
   * 获取当前评分配置（用于调试）
   */
  getScoringConfig(): ScoringConfig {
    return { ...this.scoringService.getConfig() };
  }
}
