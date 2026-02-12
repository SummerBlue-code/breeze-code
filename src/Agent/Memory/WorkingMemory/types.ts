import type { MemoryMetadata } from "@/Agent/Memory/types";

/**
 * 工作记忆槽
 */
export interface WorkingMemorySlot<T = any> {
  /** 槽ID */
  id: string;

  /** 压缩后的内容 */
  content: T;

  /** 元数据 */
  metadata: MemoryMetadata & {
    /** 关联的感知特征ID */
    sourceFeatureId: string;

    /** 压缩率 (压缩后大小/原始大小) */
    compressionRatio?: number;

    /** 相关性评分 [0, 1] */
    relevanceScore: number;
  };

  /** 语义向量 */
  embedding?: Float32Array;

  /** 过期时间（可选） */
  expiresAt?: Date;
}
