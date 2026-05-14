import type { SemanticMemory } from "../storage/SemanticMemory";

/**
 * Query 类型
 */
export type QueryType = "factual" | "opinion" | "task" | "chat" | "comparison";

/**
 * Query Processing 配置
 * 基于论文中的三信号混合排序
 */
export interface QueryProcessorConfig {
  /** 激活值权重 (α) */
  activationWeight: number;
  /** 语义相似度权重 (β) */
  semanticWeight: number;
  /** 时间衰减权重 (γ) */
  temporalWeight: number;
  /** 置信度阈值 */
  confidenceThreshold: number;
}

const DEFAULT_CONFIG: QueryProcessorConfig = {
  activationWeight: 0.4,
  semanticWeight: 0.4,
  temporalWeight: 0.2,
  confidenceThreshold: 0.5,
};

/**
 * 查询结果
 */
export interface QueryResult {
  interactionId: string;
  topic: string;
  content?: string;
  type: "episodic" | "semantic";
  activation: number;
  semanticScore: number;
  temporalScore: number;
  totalScore: number;
  confidence: number;
}

/**
 * 改写结果
 */
export interface QueryRewriteResult {
  original: string;
  expanded: string;
  synonyms: string[];
  context: string;
}

/**
 * Query Processor 查询处理器
 *
 * 实现论文中的查询处理流程:
 * 1. Query 分类 (factual/opinion/task/chat)
 * 2. Query 改写 (添加上下文、同义词扩展)
 * 3. 并行检索 (V_E via Qdrant + V_S via Neo4j)
 * 4. 三信号混合排序: S_total = α·A + β·S_sem + γ·T
 * 5. 置信度检查
 */
export class QueryProcessor {
  private semanticMemory: SemanticMemory;
  private config: QueryProcessorConfig;

  constructor(
    semanticMemory: SemanticMemory,
    config: Partial<QueryProcessorConfig> = {},
  ) {
    this.semanticMemory = semanticMemory;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 分类查询类型
   * 这是一个简化实现，实际可以使用 LLM 进行分类
   */
  classifyQuery(query: string): QueryType {
    const lowerQuery = query.toLowerCase();

    // 简单的关键词匹配
    if (
      lowerQuery.includes("what") ||
      lowerQuery.includes("who") ||
      lowerQuery.includes("when") ||
      lowerQuery.includes("where") ||
      lowerQuery.includes("how")
    ) {
      if (
        lowerQuery.includes("difference") ||
        lowerQuery.includes("compare") ||
        lowerQuery.includes("vs") ||
        lowerQuery.includes("versus")
      ) {
        return "comparison";
      }
      return "factual";
    }

    if (
      lowerQuery.includes("think") ||
      lowerQuery.includes("feel") ||
      lowerQuery.includes("opinion") ||
      lowerQuery.includes("believe")
    ) {
      return "opinion";
    }

    if (
      lowerQuery.includes("help") ||
      lowerQuery.includes("can you") ||
      lowerQuery.includes("please") ||
      lowerQuery.includes("do")
    ) {
      return "task";
    }

    return "chat";
  }

  /**
   * 改写查询
   * 简化实现，实际可以使用 LLM 进行改写
   */
  rewriteQuery(query: string, queryType: QueryType): QueryRewriteResult {
    // 简化: 直接使用原始查询
    // 实际实现中可以调用 LLM API 进行扩展
    const synonyms: Record<string, string[]> = {
      python: ["python programming", "python language"],
      java: ["java programming", "java language"],
      programming: ["coding", "software development"],
      learn: ["study", "understand", "master"],
    };

    const expanded = query.toLowerCase();
    const foundSynonyms: string[] = [];

    for (const [key, values] of Object.entries(synonyms)) {
      if (expanded.includes(key)) {
        foundSynonyms.push(...values);
      }
    }

    return {
      original: query,
      expanded: [...new Set([expanded, ...foundSynonyms])].join(" "),
      synonyms: foundSynonyms,
      context: queryType === "comparison" ? "请提供详细的对比分析" : "",
    };
  }

  /**
   * 执行查询
   *
   * @param query 用户查询
   * @param queryVector 查询向量
   * @param limit 返回结果数量
   */
  async query(
    query: string,
    queryVector: number[],
    limit = 10,
  ): Promise<QueryResult[]> {
    // 1. 分类查询
    const queryType = this.classifyQuery(query);

    // 2. 改写查询
    const rewritten = this.rewriteQuery(query, queryType);

    // 3. 并行检索
    // 3a. 在 Qdrant 中搜索相似的 V_E (episodic_interactions collection)
    const episodicResults = await this.semanticMemory.searchEpisodicNodesByVector(
      queryVector,
      0.5,
      limit * 2,
    );

    // 3b. 在 Qdrant 中搜索相似的 V_S
    const semanticResults = await this.semanticMemory.findSimilarSemanticNodes(
      queryVector,
      limit * 2,
      0.5,
    );

    // 3c. 基于 V_S 结果执行 Spreading Activation 和 Lateral Inhibition
    const seedNames = semanticResults.map((s) => s.name);
    const inhibitionResults = await this.semanticMemory.activate(seedNames);

    // 4. 合并结果并计算最终分数
    const results = await this.mergeAndScore(
      episodicResults,
      inhibitionResults,
      rewritten,
    );

    // 6. 置信度检查
    const filteredResults = results.filter((r) => r.confidence >= this.config.confidenceThreshold);

    return filteredResults.slice(0, limit);
  }

  /**
   * 合并结果并计算分数
   */
  private async mergeAndScore(
    episodicResults: { interactionId: string; topic: string; score?: number }[],
    inhibitionResults: Array<{
      nodeId: string;
      nodeType: "episodic" | "semantic";
      finalActivation: number;
    }>,
    rewritten: QueryRewriteResult,
  ): Promise<QueryResult[]> {
    const results: QueryResult[] = [];

    // 处理 episodic 结果
    for (const episodic of episodicResults) {
      const inhibition = inhibitionResults.find(
        (i) => i.nodeId === episodic.interactionId && i.nodeType === "episodic",
      );

      const activation = inhibition?.finalActivation ?? 0;
      const semanticScore = episodic.score ?? 0;
      const temporalScore = this.calculateTemporalScore(episodic.topic);

      const totalScore =
        this.config.activationWeight * activation +
        this.config.semanticWeight * semanticScore +
        this.config.temporalWeight * temporalScore;

      results.push({
        interactionId: episodic.interactionId,
        topic: episodic.topic,
        type: "episodic",
        activation,
        semanticScore,
        temporalScore,
        totalScore,
        confidence: this.calculateConfidence(totalScore, activation, semanticScore),
      });
    }

    // 处理 semantic 结果 (如果需要 V_S 上下文)
    const semanticIds = new Set(
      inhibitionResults
        .filter((i) => i.nodeType === "semantic")
        .map((i) => i.nodeId),
    );

    for (const semanticId of semanticIds) {
      // 获取关联的 episodic nodes
      const linkedInteractionIds =
        await this.semanticMemory.getLinkedEpisodics(semanticId);

      for (const interactionId of linkedInteractionIds) {
        // 检查是否已存在
        const existing = results.find((r) => r.interactionId === interactionId);
        if (!existing) {
          const semanticNode = inhibitionResults.find(
            (i) => i.nodeId === semanticId && i.nodeType === "semantic",
          );

          const activation = semanticNode?.finalActivation ?? 0;

          results.push({
            interactionId,
            topic: semanticId,  // 使用 qdrantId 作为 topic
            type: "episodic",
            activation,
            semanticScore: 0,
            temporalScore: 0,
            totalScore: this.config.activationWeight * activation,
            confidence: activation,
          });
        }
      }
    }

    // 按总分排序
    return results.sort((a, b) => b.totalScore - a.totalScore);
  }

  /**
   * 计算时间衰减分数
   * 越新的节点分数越高
   */
  private calculateTemporalScore(topic: string): number {
    // 简化实现：默认返回 0.5
    // 实际实现中可以根据节点创建时间计算
    return 0.5;
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(
    totalScore: number,
    activation: number,
    semanticScore: number,
  ): number {
    // 置信度基于激活值和语义相似度的几何平均
    if (activation === 0 && semanticScore === 0) {
      return 0;
    }
    return Math.sqrt(activation * semanticScore) * totalScore;
  }

  /**
   * 清除所有激活值
   */
  async clearActivations(): Promise<void> {
    await this.semanticMemory.clearActivations();
  }

  /**
   * 获取图的统计信息
   */
  async getGraphStats(): Promise<{
    episodicCount: number;
    semanticCount: number;
    temporalEdges: number;
    abstractionEdges: number;
    associationEdges: number;
  }> {
    return this.semanticMemory.getGraphStats();
  }
}
