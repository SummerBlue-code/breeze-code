// src/Agent/Memory/SensoryLayer/NLPService.ts
import type { ILLM } from "@/LLM";
import { MessageManager } from "@/Agent/MessageManager/MessageManager";
import { ToolManager } from "@/Agent/ToolManager/ToolManager";

/**
 * 实体提取结果
 */
export interface EntityExtractionResult {
  entities: string[];
  categories: Array<{ entity: string; type: string }>;
}

/**
 * 情感分析结果
 */
export interface SentimentAnalysisResult {
  score: number; // -1 到 1
  label: "positive" | "neutral" | "negative";
  confidence: number;
}

/**
 * 重要性评估结果
 */
export interface ImportanceResult {
  score: number; // 0 到 1
  reasons: string[];
}

/**
 * NLP 服务配置
 */
export interface NLPServiceConfig {
  /** 缓存最大条目数 */
  maxCacheSize?: number;
  /** 缓存 TTL (毫秒) */
  cacheTTL?: number;
  /** 实体提取的模型名称 */
  entityModel?: string;
  /** 情感分析的模型名称 */
  sentimentModel?: string;
  /** 重要性评估的模型名称 */
  importanceModel?: string;
  /** 是否启用缓存 */
  enableCache?: boolean;
}

/**
 * NLP 服务 - 使用 LLM API 进行实体提取、情感分析等
 *
 * @example
 * ```ts
 * const nlp = new NLPService(llm, { enableCache: true });
 * const entities = await nlp.extractEntities("用户: 预订明天北京的酒店");
 * ```
 */
export class NLPService {
  private readonly llm: ILLM;
  private readonly config: Required<NLPServiceConfig>;

  // 缓存存储
  private entityCache = new Map<
    string,
    { data: EntityExtractionResult; expiry: number }
  >();
  private sentimentCache = new Map<
    string,
    { data: SentimentAnalysisResult; expiry: number }
  >();
  private importanceCache = new Map<
    string,
    { data: ImportanceResult; expiry: number }
  >();

  // 系统提示词
  private static readonly ENTITY_SYSTEM_PROMPT = `你是一个专业的命名实体识别系统。请从输入文本中提取所有重要实体。

实体类型包括：
- person: 人名
- location: 地点/城市/国家
- organization: 公司/机构/组织
- time: 时间/日期/时段
- product: 产品/服务名称
- event: 事件/活动
- quantity: 数量/金额

请以 JSON 格式返回，格式如下：
{
  "entities": ["实体1", "实体2", ...],
  "categories": [{"entity": "实体1", "type": "类型"}, ...]
}

只返回 JSON，不要任何额外说明。`;

  private static readonly SENTIMENT_SYSTEM_PROMPT = `你是一个专业的情感分析系统。请分析输入文本的情感倾向。

返回 JSON 格式：
{
  "score": -1 到 1 的数值（负数表示负面，正数表示正面，0 表示中性）,
  "label": "positive" | "neutral" | "negative",
  "confidence": 0 到 1 的置信度
}

只返回 JSON，不要任何额外说明。`;

  private static readonly IMPORTANCE_SYSTEM_PROMPT = `你是一个智能内容重要性评估系统，专门用于评估对话中用户输入的重要程度。

## 评分维度（按优先级排序）

### 1. 用户个人信息与偏好（权重：最高）
- 用户身份信息（姓名、电话、邮箱等）→ 评分: 0.7-0.9
- 用户偏好设置（座位偏好、饮食偏好、习惯等）→ 评分: 0.7-0.9
- 个人习惯和长期特征 → 评分: 0.6-0.8

### 2. 行动指令与任务
- 明确的行动请求（预订、查询、取消等）→ 评分: 0.6-0.9
- 具体的服务需求 → 评分: 0.5-0.8

### 3. 关键实体信息
- 时间、地点、人物等关键信息 → 评分: 0.4-0.7
- 实体的具体性和重要性 → 评分: 0.3-0.6

### 4. 情感强度
- 强烈的情感表达（正面或负面）→ 加权 0.1-0.2
- 中性情感表达 → 加权 0.0-0.1

### 5. 信息密度
- 信息密集的语句 → 加权 0.1
- 简单的寒暄或确认 → 评分: 0.1-0.3

## 评分示例

- "我叫李明，喜欢吃素" → 0.8-0.9（包含姓名和饮食偏好）
- "帮我订下周去深圳的高铁票" → 0.7-0.8（明确行动指令+关键实体）
- "你好" → 0.1-0.2（简单问候）
- "非常感谢" → 0.2-0.3（礼貌表达）
- "我习惯坐靠走廊的位置" → 0.6-0.7（具体偏好设置）

## 输出格式

返回 JSON 格式：
{
  "score": 0 到 1 的重要性评分（保留一位小数）,
  "reasons": ["评估理由1", "评估理由2", ...]
}

只返回 JSON，不要任何额外说明。`;

  constructor(llm: ILLM, config: NLPServiceConfig = {}) {
    this.llm = llm;

    // 默认配置
    this.config = {
      maxCacheSize: config.maxCacheSize ?? 1000,
      cacheTTL: config.cacheTTL ?? 3600000, // 1 小时
      entityModel: config.entityModel ?? "gpt-4o-mini",
      sentimentModel: config.sentimentModel ?? "gpt-4o-mini",
      importanceModel: config.importanceModel ?? "gpt-4o-mini",
      enableCache: config.enableCache ?? true,
    };
  }

  /**
   * 提取文本中的实体
   */
  async extractEntities(text: string): Promise<EntityExtractionResult> {
    // 检查缓存
    if (this.config.enableCache) {
      const cached = this.getCached(this.entityCache, text);
      if (cached) return cached;
    }

    const result = await this.callLLM<EntityExtractionResult>(
      text,
      NLPService.ENTITY_SYSTEM_PROMPT,
      this.config.entityModel,
    );

    // 写入缓存
    if (this.config.enableCache) {
      this.setCached(this.entityCache, text, result);
    }
    console.log(
      "实体列表：",
      result.entities.join(", "),
      "\n实体类型：",
      result.categories.map((c) => `${c.entity}:${c.type}`).join(", "),
    );
    return result;
  }

  /**
   * 分析文本情感
   */
  async analyzeSentiment(text: string): Promise<SentimentAnalysisResult> {
    // 检查缓存
    if (this.config.enableCache) {
      const cached = this.getCached(this.sentimentCache, text);
      if (cached) return cached;
    }

    const result = await this.callLLM<SentimentAnalysisResult>(
      text,
      NLPService.SENTIMENT_SYSTEM_PROMPT,
      this.config.sentimentModel,
    );

    // 写入缓存
    if (this.config.enableCache) {
      this.setCached(this.sentimentCache, text, result);
    }

    return result;
  }

  /**
   * 计算文本重要性
   */
  async calculateImportance(
    text: string,
    entityCategories?: Array<{ entity: string; type: string }>,
    sentiment?: number,
  ): Promise<ImportanceResult> {
    // 构建缓存键（组合多个参数）
    const cacheKey = JSON.stringify({
      text,
      entitySignature: entityCategories
        ?.map((c) => `${c.entity}:${c.type}`)
        .sort()
        .join("|") || "",
      sentiment,
    });

    // 检查缓存
    if (this.config.enableCache) {
      const cached = this.getCached(this.importanceCache, cacheKey);
      if (cached) return cached;
    }

    // 构建上下文信息
    const contextParts = [`文本: ${text}`];

    // 添加实体详细信息
    if (entityCategories && entityCategories.length > 0) {
      const entityDetails = entityCategories
        .map((cat) => `- ${cat.entity} (${cat.type})`)
        .join("\n");
      contextParts.push(`提取的实体:\n${entityDetails}`);
    } else {
      contextParts.push("提取的实体: (无)");
    }

    // 添加情感分值
    if (sentiment !== undefined) {
      contextParts.push(`情感分值: ${sentiment.toFixed(2)}`);
    }

    const context = contextParts.join("\n\n");

    const result = await this.callLLM<ImportanceResult>(
      context,
      NLPService.IMPORTANCE_SYSTEM_PROMPT,
      this.config.importanceModel,
    );

    // 写入缓存
    if (this.config.enableCache) {
      this.setCached(this.importanceCache, cacheKey, result);
    }

    return result;
  }

  /**
   * 通用 LLM 调用方法
   */
  private async callLLM<T>(
    input: string,
    systemPrompt: string,
    model: string,
  ): Promise<T> {
    const messages = new MessageManager();
    messages.setSystemMessage(systemPrompt);
    messages.addUserMessage(input);

    try {
      const response = await this.llm.generateNonStream(
        messages,
        model,
        new ToolManager(), // 不使用工具
      );

      // 解析 JSON 响应
      const content = response.content ?? "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        throw new Error(`无法解析 LLM 响应为 JSON: ${content}`);
      }

      return JSON.parse(jsonMatch[0]) as T;
    } catch (error) {
      // 记录错误但返回默认值，确保系统稳定运行
      console.error("NLP LLM 调用失败:", error);

      // 返回安全的默认值
      return this.getFallbackResult<T>(input);
    }
  }

  /**
   * 获取降级时的默认结果
   */
  private getFallbackResult<T>(input: string): T {
    // 根据输入内容返回合理的默认值
    const hasKeywords = /[预订查询取消推荐]/.test(input);
    const baseResult = {
      entities: [],
      categories: [],
      score: hasKeywords ? 0.6 : 0.3,
      label: "neutral" as const,
      confidence: 0.5,
      reasons: ["LLM 调用失败，使用默认值"],
    };

    return baseResult as T;
  }

  /**
   * 从缓存获取数据
   */
  private getCached<T>(
    cache: Map<string, { data: T; expiry: number }>,
    key: string,
  ): T | null {
    const entry = cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() > entry.expiry) {
      cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * 写入缓存
   */
  private setCached<T>(
    cache: Map<string, { data: T; expiry: number }>,
    key: string,
    data: T,
  ): void {
    // 如果缓存已满，删除最旧的条目
    if (cache.size >= this.config.maxCacheSize) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }

    cache.set(key, {
      data,
      expiry: Date.now() + this.config.cacheTTL,
    });
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.entityCache.clear();
    this.sentimentCache.clear();
    this.importanceCache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      entity: this.entityCache.size,
      sentiment: this.sentimentCache.size,
      importance: this.importanceCache.size,
      total:
        this.entityCache.size +
        this.sentimentCache.size +
        this.importanceCache.size,
      maxSize: this.config.maxCacheSize,
    };
  }
}
