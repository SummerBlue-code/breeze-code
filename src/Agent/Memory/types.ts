/**
 * 记忆元数据
 */
export interface MemoryMetadata {
  /** 唯一ID */
  id: string;

  /** 创建时间 */
  createdAt: Date;

  /** 最后访问时间 */
  lastAccessed: Date;

  /** 访问计数 */
  accessCount: number;

  /** 置信度 [0.0, 1.0] */
  confidence: number;

  /** 来源 */
  source: "user" | "system" | "tool";

  /** 标签列表 */
  tags: string[];

  /** 上下文哈希 - 用于去重 */
  contextHash?: string;
}

/**
 * 检索查询参数
 */
export interface RetrievalQuery {
  /** 查询文本 */
  query: string;

  /** 上下文信息 */
  context?: Record<string, any>;

  /** 检索参数 */
  options?: {
    /** 返回结果数量 */
    topK?: number;

    /** 最小相关性阈值 */
    minRelevance?: number;

    /** 是否包含过期记忆 */
    includeExpired?: boolean;
  };
}
