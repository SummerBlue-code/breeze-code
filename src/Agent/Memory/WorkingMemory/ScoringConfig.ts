/**
 * 来源权重配置
 */
export interface SourceWeights {
  /** 用户输入权重 */
  user: number;
  /** 系统生成权重 */
  system: number;
  /** 工具输出权重 */
  tool: number;
}

/**
 * 时效性权重配置
 */
export interface TemporalWeights {
  /** 当前时间权重 */
  present: number;
  /** 未来时间权重 */
  future: number;
  /** 过去时间权重 */
  past: number;
}

/**
 * 综合评分配置
 */
export interface ScoringConfig {
  // ========== 维度权重 ==========

  /** 重要性权重 (默认: 0.35) */
  importanceWeight?: number;

  /** 情感强度权重 (默认: 0.12) */
  sentimentIntensityWeight?: number;

  /** 信息密度权重 (默认: 0.10) */
  informationDensityWeight?: number;

  /** 时效性权重 (默认: 0.12) */
  recencyWeight?: number;

  /** 来源权重 (默认: { user: 1.0, system: 0.7, tool: 0.5 }) */
  sourceWeight?: SourceWeights;

  /** 时效性细分权重 (默认: { present: 1.0, future: 0.7, past: 0.5 }) */
  temporalWeight?: TemporalWeights;

  // ========== 阈值配置 ==========

  /** 存储阈值 [0.0, 1.0] (默认: 0.7) - 向后兼容 */
  storageThreshold?: number;

  // ========== 上下文关联配置 ==========

  /** 是否启用上下文关联评分 (默认: true) */
  enableContextualScoring?: boolean;

  /** 相似度阈值，用于检测重复内容 [0.0, 1.0] (默认: 0.85) */
  similarityThreshold?: number;

  /** 与现有记忆相似时的加成系数 (默认: 0.15) */
  similarityBoost?: number;

  /** 重复内容惩罚系数 (默认: -0.3) */
  duplicatePenalty?: number;

  // ========== 动态重评分配置 ==========

  /** 是否启用动态重评分 (默认: true) */
  enableDynamicRescoring?: boolean;

  /** 重评分间隔毫秒数 (默认: 60000 = 1分钟) */
  rescoreInterval?: number;

  /** 时间衰减半衰期毫秒数 (默认: 300000 = 5分钟) */
  timeDecayHalfLife?: number;

  /** 访问提升因子 (默认: 0.15) */
  accessBoostFactor?: number;

  /** 访问次数饱和阈值 (默认: 10) */
  accessCountSaturation?: number;

  // ========== 信息密度配置 ==========

  /** 实体数量饱和阈值 (默认: 5) */
  entityCountSaturation?: number;

  /** 内容长度饱和阈值（字符数，默认: 200） */
  contentLengthSaturation?: number;

  /** 信息密度中实体数量的权重 (默认: 0.6) */
  entityDensityWeight?: number;

  /** 信息密度中内容长度的权重 (默认: 0.4) */
  contentLengthWeight?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_SCORING_CONFIG: Required<ScoringConfig> = {
  // 维度权重 (总和归一化)
  importanceWeight: 0.35,
  sentimentIntensityWeight: 0.12,
  informationDensityWeight: 0.10,
  recencyWeight: 0.12,
  sourceWeight: { user: 1.0, system: 0.7, tool: 0.5 },
  temporalWeight: { present: 1.0, future: 0.7, past: 0.5 },

  // 阈值
  storageThreshold: 0.7,

  // 上下文关联
  enableContextualScoring: true,
  similarityThreshold: 0.85,
  similarityBoost: 0.15,
  duplicatePenalty: -0.3,

  // 动态重评分
  enableDynamicRescoring: true,
  rescoreInterval: 60000,
  timeDecayHalfLife: 300000,
  accessBoostFactor: 0.15,
  accessCountSaturation: 10,

  // 信息密度
  entityCountSaturation: 5,
  contentLengthSaturation: 200,
  entityDensityWeight: 0.6,
  contentLengthWeight: 0.4,
};

/**
 * 评分结果详情（用于调试和日志）
 */
export interface ScoringResult {
  /** 最终综合评分 [0, 1] */
  finalScore: number;

  /** 是否通过存储阈值 */
  passesThreshold: boolean;

  /** 各维度得分详情 */
  dimensions: {
    importance: number;
    sentimentIntensity: number;
    informationDensity: number;
    recency: number;
    source: number;
    contextual?: number;
  };

  /** 上下文关联信息 */
  contextInfo?: {
    /** 最相似的现有记忆ID */
    mostSimilarId?: string;
    /** 相似度分数 */
    similarity?: number;
    /** 是否检测为重复 */
    isDuplicate?: boolean;
  };

  /** 使用的配置快照 */
  configSnapshot: ScoringConfig;
}
