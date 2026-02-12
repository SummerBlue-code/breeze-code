/**
 * 感知输入类型
 */
export interface SensoryInput {
  /** 输入类型 - Phase 1仅支持text */
  type: "text" | "image" | "audio" | "sensor";

  /** 内容 - Phase 1仅处理string */
  content: string | Buffer | Record<string, any>;

  /** 可选时间戳 */
  timestamp?: Date;

  /** 可选地理位置 */
  location?: { lat: number; lng: number };

  /** 会话ID - 用于跨轮次关联 */
  sessionId?: string;

  /** 来源标识 */
  source?: "user" | "system" | "tool";
}

/**
 * 感知特征（感知层输出）
 */
export interface SensoryFeature {
  /** 唯一ID */
  id: string;

  /** 原始输入 */
  rawInput: SensoryInput;

  /** 768维统一表征向量 */
  embedding: Float32Array;

  /** 提取的关键实体 */
  entities: string[];

  /** 情感值 [-1, 1] */
  sentiment?: number;

  /** 重要性评分 [0.0, 1.0] */
  importanceScore: number;

  /** 时空锚点 */
  temporalAnchor: {
    timestamp: Date;
    relativeTime?: "past" | "present" | "future";
    duration?: number; // 毫秒
  };
}
