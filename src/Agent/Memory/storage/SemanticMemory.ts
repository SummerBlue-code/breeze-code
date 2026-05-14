import { Neo4jClient } from "../services/Neo4jClient";
import { QdrantClient } from "@qdrant/js-client-rest";

/**
 * 边类型常量
 */
export const EdgeType = {
    TEMPORAL: "TEMPORAL",
    ABSTRACTION: "ABSTRACTION",
    ASSOCIATION: "ASSOCIATION",
} as const;

export type EdgeTypeValue = (typeof EdgeType)[keyof typeof EdgeType];

/**
 * Synapse架构 - 语义记忆配置
 */
export interface SynapseMemoryConfig {
    /** Neo4j 配置 (边关系存储) */
    neo4j: {
        uri: string;
        username: string;
        password: string;
    };
    /** Qdrant V_S 向量配置 (语义向量存储) */
    qdrant: {
        url: string;
        apiKey?: string;
    };
    /** V_S 向量集合名称 */
    semanticCollection: string;
    /** 向量维度 */
    dimension: number;
}

/**
 * V_E 节点 (Neo4j) - 对应论文中的 ve_t = (ct, ht, τt)
 * 只存储对 Qdrant 中 Message 数据的引用
 */
export interface EpisodicNode {
    messageId: string; // 指向 Qdrant 中的 Message ID
}

/**
 * V_S 节点 (Neo4j) - 只存储对 Qdrant 数据的引用
 * 实际元数据 (name, type, properties) 存在 Qdrant payload 中
 */
export interface SemanticNode {
    qdrantId: string; // 指向 Qdrant 中的 point ID
}

/**
 * V_S 向量搜索结果
 */
export interface SemanticNodeVector {
    id: string;
    name: string;
    type: string;
    vector: number[];
    score?: number;
}

/**
 * EMA 更新结果
 */
export interface UpsertSemanticResult {
    isNew: boolean;
    nodeId: string;
    name: string;
}

/**
 * 语义记忆错误
 */
export class SemanticMemoryError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>,
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * 语义记忆配置错误
 */
export class SemanticMemoryConfigError extends SemanticMemoryError {
    constructor(field: string, value: unknown, expected: string) {
        super(
            `SemanticMemory配置无效: ${field} 值为 ${JSON.stringify(value)}, 期望 ${expected}`,
            "INVALID_CONFIG",
            { field, value, expected },
        );
    }
}

/**
 * Synapse架构 - 语义记忆类
 *
 * 存储分布:
 * - Qdrant: V_S 向量数据 (利用HNSW索引加速相似度计算)
 * - Neo4j: V_E/V_S 元数据 + 边关系 (TEMPORAL, ABSTRACTION, ASSOCIATION)
 */
export class SemanticMemory {
    private config: SynapseMemoryConfig;
    private neo4j: Neo4jClient;
    private qdrant: QdrantClient;
    private initPromise: Promise<void>;

    constructor(config: SynapseMemoryConfig) {
        this.validateConfig(config);
        this.config = config;
        this.neo4j = new Neo4jClient({
            uri: config.neo4j.uri,
            username: config.neo4j.username,
            password: config.neo4j.password,
        });
        this.qdrant = new QdrantClient({
            url: config.qdrant.url,
            apiKey: config.qdrant.apiKey,
        });
        this.initPromise = this.initialize();
    }

    private validateConfig(config: SynapseMemoryConfig): void {
        if (!config.neo4j?.uri?.trim()) {
            throw new SemanticMemoryConfigError(
                "neo4j.uri",
                config.neo4j?.uri,
                "非空字符串（如: bolt://localhost:7687）",
            );
        }
        if (!config.neo4j?.username?.trim()) {
            throw new SemanticMemoryConfigError(
                "neo4j.username",
                config.neo4j?.username,
                "非空字符串",
            );
        }
        if (!config.neo4j?.password?.trim()) {
            throw new SemanticMemoryConfigError(
                "neo4j.password",
                config.neo4j?.password,
                "非空字符串",
            );
        }
        if (!config.qdrant?.url?.trim()) {
            throw new SemanticMemoryConfigError(
                "qdrant.url",
                config.qdrant?.url,
                "非空字符串（如: http://localhost:6333）",
            );
        }
        if (!config.semanticCollection?.trim()) {
            throw new SemanticMemoryConfigError(
                "semanticCollection",
                config.semanticCollection,
                "非空字符串（如: semantic_nodes）",
            );
        }
        if (!config.dimension || config.dimension <= 0) {
            throw new SemanticMemoryConfigError(
                "dimension",
                config.dimension,
                "正整数（如: 1536）",
            );
        }
    }

    async ready(): Promise<void> {
        await this.initPromise;
    }

    private async initialize(): Promise<void> {
        await this.neo4j.verifyConnectivity();
        await this.initQdrantCollection();
    }

    private async initQdrantCollection(): Promise<void> {
        try {
            await this.qdrant.getCollection(this.config.semanticCollection);
        } catch {
            await this.qdrant.createCollection(this.config.semanticCollection, {
                vectors: {
                    size: this.config.dimension,
                    distance: "Cosine",
                },
            });
        }
    }

    // ==================== V_E 节点操作 ====================

    /**
     * 创建 V_E 节点 (Neo4j)
     * @param messageId 指向Qdrant中的Message ID
     */
    async createEpisodicNode(messageId: string): Promise<void> {
        try {
            const cypher = `
        MERGE (e:EpisodicNode {messageId: $messageId})
      `;
            await this.neo4j.write(cypher, { messageId });
        } catch (error) {
            throw new SemanticMemoryError(
                `创建V_E节点失败: ${error instanceof Error ? error.message : String(error)}`,
                "CREATE_EPISODIC_NODE_ERROR",
                { messageId } as any,
            );
        }
    }

    /**
     * 获取 V_E 节点
     */
    async getEpisodicNode(messageId: string): Promise<EpisodicNode | null> {
        try {
            const cypher = `
        MATCH (e:EpisodicNode {messageId: $messageId})
        RETURN e.messageId as messageId
      `;
            const result = await this.neo4j.execute(cypher, { messageId });
            const record = result.records[0] as any;
            if (!record) return null;
            return {
                messageId: record.messageId,
            };
        } catch (error) {
            throw new SemanticMemoryError(
                `获取V_E节点失败: ${error instanceof Error ? error.message : String(error)}`,
                "GET_EPISODIC_NODE_ERROR",
                { messageId } as any,
            );
        }
    }

    // ==================== V_S 节点操作 ====================

    /**
     * EMA 更新或创建 V_S 节点
     * 利用 Qdrant 的向量检索实现去重
     *
     * @param name 语义概念名称
     * @param type 概念类型 (如: "Preference", "Person", "Event", "Technical")
     * @param vector 语义向量
     * @param properties 额外属性
     * @param emaAlpha EMA 平滑系数 (默认 0.8)
     * @param similarityThreshold 相似度阈值 (默认 0.92)
     */
    async upsertSemanticNode(
        name: string,
        type: string,
        vector: number[],
        properties: Record<string, unknown> = {},
        emaAlpha = 0.8,
        similarityThreshold = 0.92,
    ): Promise<UpsertSemanticResult> {
        try {
            // 1. 在 Qdrant 中搜索相似 V_S 节点
            const similar = await this.qdrant.search(
                this.config.semanticCollection,
                {
                    vector,
                    limit: 1,
                    score_threshold: similarityThreshold,
                    with_payload: true,
                    with_vector: true,
                },
            );

            if (similar.length > 0 && similar[0]) {
                // 2. EMA 更新已有节点向量 (Qdrant 单一数据源)
                const existing = similar[0];
                const existingId = String(existing.id);
                const existingVector = existing.vector as number[];
                const updatedVector = this.emaUpdate(
                    vector,
                    existingVector,
                    emaAlpha,
                );

                await this.qdrant.upsert(this.config.semanticCollection, {
                    points: [
                        {
                            id: existingId,
                            vector: updatedVector,
                            payload: { name, type, properties },
                        },
                    ],
                });

                // Neo4j 节点已存在，无需更新
                return { isNew: false, nodeId: existingId, name };
            } else {
                // 3. 创建新 V_S 节点
                const nodeId = crypto.randomUUID();

                // 3a. Qdrant 存储向量和 payload (单一数据源)
                await this.qdrant.upsert(this.config.semanticCollection, {
                    points: [
                        {
                            id: nodeId,
                            vector,
                            payload: { name, type, properties },
                        },
                    ],
                });

                // 3b. Neo4j 存储 qdrantId 引用 (只用于边关系)
                await this.neo4j.write(
                    `
                    MERGE (s:SemanticNode {qdrantId: $qdrantId})
                  `,
                    { qdrantId: nodeId },
                );

                return { isNew: true, nodeId, name };
            }
        } catch (error) {
            throw new SemanticMemoryError(
                `upsertSemanticNode失败: ${error instanceof Error ? error.message : String(error)}`,
                "UPSERT_SEMANTIC_NODE_ERROR",
                { name, type } as any,
            );
        }
    }

    /**
     * EMA 向量更新
     * h_new = alpha * h_new + (1 - alpha) * h_old
     */
    private emaUpdate(
        newVector: number[],
        oldVector: number[],
        alpha: number,
    ): number[] {
        return newVector.map(
            (v, i) => alpha * v + (1 - alpha) * (oldVector[i] ?? 0),
        );
    }

    /**
     * 在 Qdrant 中查找相似的 V_S 节点
     */
    async findSimilarSemanticNodes(
        vector: number[],
        limit = 10,
        threshold = 0.92,
    ): Promise<SemanticNodeVector[]> {
        try {
            const result = await this.qdrant.search(
                this.config.semanticCollection,
                {
                    vector,
                    limit,
                    score_threshold: threshold,
                    with_payload: true,
                },
            );

            return result.map((point) => ({
                id: String(point.id),
                name: (point.payload as any)?.name ?? "",
                type: (point.payload as any)?.type ?? "",
                vector: point.vector as number[],
                score: point.score,
            }));
        } catch (error) {
            throw new SemanticMemoryError(
                `findSimilarSemanticNodes失败: ${error instanceof Error ? error.message : String(error)}`,
                "FIND_SIMILAR_SEMANTIC_NODES_ERROR",
                {} as any,
            );
        }
    }

    /**
     * 获取 V_S 节点 (从 Qdrant)
     */
    async getSemanticNode(
        qdrantId: string,
    ): Promise<SemanticNodeVector | null> {
        try {
            const result = await this.qdrant.retrieve(
                this.config.semanticCollection,
                {
                    ids: [qdrantId],
                    with_payload: true,
                    with_vector: true,
                },
            );

            if (!result || result.length === 0) return null;
            const point = result[0];
            if (!point) return null;

            return {
                id: String(point.id),
                name: (point.payload as any)?.name ?? "",
                type: (point.payload as any)?.type ?? "",
                vector: point.vector as number[],
            };
        } catch (error) {
            throw new SemanticMemoryError(
                `getSemanticNode失败: ${error instanceof Error ? error.message : String(error)}`,
                "GET_SEMANTIC_NODE_ERROR",
                { qdrantId } as any,
            );
        }
    }

    /**
     * 获取所有 V_S 节点 (从 Qdrant)
     */
    async getAllSemanticNodes(limit = 1000): Promise<SemanticNodeVector[]> {
        try {
            const result = await this.qdrant.scroll(
                this.config.semanticCollection,
                {
                    limit,
                    with_payload: true,
                    with_vector: true,
                },
            );

            return result.points.map((point) => ({
                id: String(point.id),
                name: (point.payload as any)?.name ?? "",
                type: (point.payload as any)?.type ?? "",
                vector: point.vector as number[],
            }));
        } catch (error) {
            throw new SemanticMemoryError(
                `getAllSemanticNodes失败: ${error instanceof Error ? error.message : String(error)}`,
                "GET_ALL_SEMANTIC_NODES_ERROR",
                {} as any,
            );
        }
    }

    // ==================== 边操作 ====================

    /**
     * 创建 TEMPORAL 边 (V_E → V_E)
     * 连接连续的对话情景
     */
    async linkEpisodicToEpisodic(
        fromMessageId: string,
        toMessageId: string,
        weight = 1.0,
    ): Promise<void> {
        try {
            const cypher = `
        MATCH (from:EpisodicNode {messageId: $fromId})
        MATCH (to:EpisodicNode {messageId: $toId})
        MERGE (from)-[r:TEMPORAL]->(to)
        SET r.weight = $weight, r.createdAt = datetime()
      `;
            await this.neo4j.write(cypher, {
                fromId: fromMessageId,
                toId: toMessageId,
                weight,
            });
        } catch (error) {
            throw new SemanticMemoryError(
                `创建TEMPORAL边失败: ${error instanceof Error ? error.message : String(error)}`,
                "LINK_EPISODIC_TO_EPISODIC_ERROR",
                { fromMessageId, toMessageId } as any,
            );
        }
    }

    /**
     * 创建 ABSTRACTION 边 (V_E → V_S)
     * 情景到语义的映射
     */
    async linkEpisodicToSemantic(
        messageId: string,
        semanticName: string,
        weight = 0.8,
    ): Promise<void> {
        try {
            const cypher = `
        MATCH (e:EpisodicNode {messageId: $messageId})
        MATCH (s:SemanticNode {name: $semanticName})
        MERGE (e)-[r:ABSTRACTION]->(s)
        SET r.weight = $weight, r.createdAt = datetime()
      `;
            await this.neo4j.write(cypher, {
                messageId,
                semanticName,
                weight,
            });
        } catch (error) {
            throw new SemanticMemoryError(
                `创建ABSTRACTION边失败: ${error instanceof Error ? error.message : String(error)}`,
                "LINK_EPISODIC_TO_SEMANTIC_ERROR",
                { messageId, semanticName } as any,
            );
        }
    }

    /**
     * 创建 ASSOCIATION 边 (V_S ↔ V_S)
     * @param fromQdrantId 起始节点的 Qdrant ID
     * @param toQdrantId 目标节点的 Qdrant ID
     * @param weight 边权重
     */
    async linkSemanticToSemantic(
        fromQdrantId: string,
        toQdrantId: string,
        weight: number,
    ): Promise<void> {
        try {
            const cypher = `
        MATCH (from:SemanticNode {qdrantId: $fromQdrantId})
        MATCH (to:SemanticNode {qdrantId: $toQdrantId})
        MERGE (from)-[r:ASSOCIATION]->(to)
        SET r.weight = $weight, r.createdAt = datetime()
      `;
            await this.neo4j.write(cypher, {
                fromQdrantId,
                toQdrantId,
                weight,
            });
        } catch (error) {
            throw new SemanticMemoryError(
                `创建ASSOCIATION边失败: ${error instanceof Error ? error.message : String(error)}`,
                "LINK_SEMANTIC_TO_SEMANTIC_ERROR",
                { fromQdrantId, toQdrantId } as any,
            );
        }
    }

    /**
     * 获取与某情景关联的语义节点 (返回 qdrantId 列表)
     */
    async getLinkedSemantics(messageId: string): Promise<string[]> {
        try {
            const cypher = `
        MATCH (e:EpisodicNode {messageId: $messageId})-[:ABSTRACTION]->(s:SemanticNode)
        RETURN s.qdrantId as qdrantId
      `;
            const result = await this.neo4j.execute(cypher, { messageId });
            return result.records.map(
                (record: any) => record.qdrantId as string,
            );
        } catch (error) {
            throw new SemanticMemoryError(
                `getLinkedSemantics失败: ${error instanceof Error ? error.message : String(error)}`,
                "GET_LINKED_SEMANTICS_ERROR",
                { messageId } as any,
            );
        }
    }

    /**
     * 获取某语义节点关联的情景节点
     * @param qdrantId Qdrant 中的节点 ID
     */
    async getLinkedEpisodics(qdrantId: string): Promise<string[]> {
        try {
            const cypher = `
        MATCH (e:EpisodicNode)-[:ABSTRACTION]->(s:SemanticNode {qdrantId: $qdrantId})
        RETURN e.messageId as messageId
      `;
            const result = await this.neo4j.execute(cypher, { qdrantId });
            return result.records.map(
                (record: any) => record.messageId as string,
            );
        } catch (error) {
            throw new SemanticMemoryError(
                `getLinkedEpisodics失败: ${error instanceof Error ? error.message : String(error)}`,
                "GET_LINKED_EPISODICS_ERROR",
                { qdrantId } as any,
            );
        }
    }

    // ==================== ASSOCIATION 边建立 ====================

    /**
     * 建立 ASSOCIATION 边
     * 根据 Qdrant 相似度建立 V_S 节点间的关联
     *
     * @param topK 保留 Top-K 邻居 (默认 15)
     * @param similarityThreshold 相似度阈值 (默认 0.92)
     */
    async buildAssociations(
        topK = 15,
        similarityThreshold = 0.92,
    ): Promise<number> {
        try {
            // 1. 从 Qdrant 获取所有 V_S 向量
            const allNodes = await this.getAllSemanticNodes();

            if (allNodes.length === 0) return 0;

            let edgesCreated = 0;

            // 2. 对每个 V_S 节点搜索相似邻居
            for (const node of allNodes) {
                const neighbors = await this.qdrant.search(
                    this.config.semanticCollection,
                    {
                        vector: node.vector,
                        limit: topK + 1, // 包含自己
                        score_threshold: similarityThreshold,
                    },
                );

                // 3. 对每个满足条件的邻居建立 ASSOCIATION 边
                for (const neighbor of neighbors) {
                    const neighborId = String(neighbor.id);
                    if (neighborId !== node.id) {
                        const weight = neighbor.score ?? 0;
                        await this.linkSemanticToSemantic(
                            node.id, // fromQdrantId
                            neighborId, // toQdrantId
                            weight,
                        );
                        edgesCreated++;
                    }
                }
            }

            return edgesCreated;
        } catch (error) {
            throw new SemanticMemoryError(
                `buildAssociations失败: ${error instanceof Error ? error.message : String(error)}`,
                "BUILD_ASSOCIATIONS_ERROR",
                {} as any,
            );
        }
    }

    // ==================== Spreading Activation ====================

    private readonly DEFAULT_ACTIVATION_CONFIG: ActivationConfig = {
        damping: 0.8,
        maxIterations: 3,
        threshold: 0.5,
        steepness: 5.0,
        nodeDecay: 0.5,
    };

    private sigmoid(x: number, steepness: number): number {
        return 1 / (1 + Math.exp(-steepness * (x - 0.5)));
    }

    async spreadActivation(
        seedIds: string[],
        config?: Partial<ActivationConfig>,
    ): Promise<ActivationResult[]> {
        const cfg = { ...this.DEFAULT_ACTIVATION_CONFIG, ...config };

        await this.neo4j.write(`MATCH (n) REMOVE n.activation`);

        // 设置种子节点的激活值 (使用 qdrantId 或 messageId)
        for (const id of seedIds) {
            await this.neo4j.write(
                `MATCH (n) WHERE n.qdrantId = $id OR n.messageId = $id SET n.activation = 1.0`,
                { id },
            );
        }

        for (let i = 0; i < cfg.maxIterations; i++) {
            // 获取所有有激活值的节点
            const activeNodes = await this.neo4j.execute(`
                MATCH (n) WHERE n.activation IS NOT NULL
                RETURN n.qdrantId as vsQdrantId, n.messageId as veId, n.activation as activation, labels(n)[0] as type
            `);

            for (const record of activeNodes.records as any[]) {
                const nodeId = record.vsQdrantId || record.veId;
                const currentActivation = record.activation;

                // 查找邻居
                const neighbors = await this.neo4j.execute(
                    `MATCH (from)-[r]->(to) WHERE from.qdrantId = $nodeId OR from.messageId = $nodeId
                     RETURN to.qdrantId as vsQdrantId, to.messageId as veId, r.weight as weight, labels(to)[0] as type`,
                    { nodeId },
                );

                let totalInput = 0;
                for (const neighborRecord of neighbors.records as any[]) {
                    totalInput +=
                        currentActivation * (neighborRecord.weight || 1.0);
                }

                let newActivation =
                    (1 - cfg.damping) * currentActivation +
                    cfg.damping * this.sigmoid(totalInput, cfg.steepness);
                newActivation *= 1 - cfg.nodeDecay;

                // 更新邻居的激活值
                for (const neighborRecord of neighbors.records as any[]) {
                    const targetId =
                        neighborRecord.vsQdrantId || neighborRecord.veId;
                    await this.neo4j.write(
                        `MATCH (n) WHERE n.qdrantId = $id OR n.messageId = $id SET n.activation = $activation`,
                        { id: targetId, activation: newActivation },
                    );
                }
            }
        }

        const result = await this.neo4j.execute(
            `MATCH (n) WHERE n.activation IS NOT NULL AND n.activation > $threshold
             RETURN n.qdrantId as vsQdrantId, n.messageId as veId, n.activation as activation, labels(n)[0] as type
             ORDER BY n.activation DESC`,
            { threshold: cfg.threshold },
        );

        return result.records.map((record: any) => ({
            nodeId: record.vsQdrantId || record.veId,
            nodeType: record.type === "EpisodicNode" ? "episodic" : "semantic",
            activation: record.activation,
        }));
    }

    // ==================== Lateral Inhibition ====================

    private readonly DEFAULT_INHIBITION_CONFIG: InhibitionConfig = {
        threshold: 0.15,
        inhibitionFactor: 0.5,
        topM: 7,
    };

    async applyInhibition(
        activations: ActivationResult[],
        config?: Partial<InhibitionConfig>,
    ): Promise<InhibitionResult[]> {
        const cfg = { ...this.DEFAULT_INHIBITION_CONFIG, ...config };

        // 设置初始激活值
        for (const act of activations) {
            await this.neo4j.write(
                `MATCH (n) WHERE n.qdrantId = $id OR n.messageId = $id SET n.activation = $activation`,
                { id: act.nodeId, activation: act.activation },
            );
        }

        // 获取所有有激活值的节点及其邻居
        const nodes = await this.neo4j.execute(`
            MATCH (n) WHERE n.activation IS NOT NULL
            OPTIONAL MATCH (n)-[r]-(neighbor) WHERE neighbor.activation IS NOT NULL
            RETURN n.qdrantId as vsQdrantId, n.messageId as veId, n.activation as activation, labels(n)[0] as type,
                   collect(DISTINCT {id: neighbor.qdrantId ?? neighbor.messageId, activation: neighbor.activation}) as neighborList
        `);

        const inhibitionResults: InhibitionResult[] = [];

        for (const record of nodes.records as any[]) {
            const nodeId = record.vsQdrantId || record.veId;
            const activation = record.activation;
            const neighbors = (record.neighborList || []).filter(
                (n: any) => n.id !== null,
            );
            const neighborMax = Math.max(
                ...neighbors.map((n: any) => n.activation),
                0,
            );
            const isInhibited = neighborMax > activation * (1 + cfg.threshold);
            let finalActivation = activation;
            if (isInhibited) {
                finalActivation = activation * cfg.inhibitionFactor;
            }

            await this.neo4j.write(
                `MATCH (n) WHERE n.qdrantId = $id OR n.messageId = $id SET n.activation = $activation`,
                { id: nodeId, activation: finalActivation },
            );

            inhibitionResults.push({
                nodeId,
                nodeType:
                    record.type === "EpisodicNode" ? "episodic" : "semantic",
                originalActivation: activation,
                finalActivation,
                wasInhibited: isInhibited,
            });
        }

        const sorted = [...inhibitionResults].sort(
            (a, b) => b.finalActivation - a.finalActivation,
        );
        const topMIds = new Set(sorted.slice(0, cfg.topM).map((n) => n.nodeId));

        for (const result of inhibitionResults) {
            if (!topMIds.has(result.nodeId)) {
                await this.neo4j.write(
                    `MATCH (n) WHERE n.qdrantId = $id OR n.messageId = $id SET n.activation = 0`,
                    { id: result.nodeId },
                );
            }
        }

        return inhibitionResults.sort(
            (a, b) => b.finalActivation - a.finalActivation,
        );
    }

    async activate(
        seedIds: string[],
        activationConfig?: Partial<ActivationConfig>,
        inhibitionConfig?: Partial<InhibitionConfig>,
    ): Promise<InhibitionResult[]> {
        const activationResults = await this.spreadActivation(
            seedIds,
            activationConfig,
        );
        return this.applyInhibition(activationResults, inhibitionConfig);
    }

    async activateFromVector(
        vector: number[],
        threshold = 0.92,
        activationConfig?: Partial<ActivationConfig>,
        inhibitionConfig?: Partial<InhibitionConfig>,
    ): Promise<InhibitionResult[]> {
        const similar = await this.findSimilarSemanticNodes(
            vector,
            10,
            threshold,
        );
        const seedIds = similar.map((s) => s.id); // 使用 qdrantId
        if (seedIds.length === 0) return [];
        return this.activate(seedIds, activationConfig, inhibitionConfig);
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
        const episodicStats = await this.neo4j.execute(`
            MATCH (e:EpisodicNode) RETURN count(e) as count
        `);
        const episodicCount = (episodicStats.records[0] as any)?.count ?? 0;

        const semanticStats = await this.neo4j.execute(`
            MATCH (s:SemanticNode) RETURN count(s) as count
        `);
        const semanticCount = (semanticStats.records[0] as any)?.count ?? 0;

        const temporalStats = await this.neo4j.execute(`
            MATCH ()-[r:TEMPORAL]->() RETURN count(r) as count
        `);
        const temporalEdges = (temporalStats.records[0] as any)?.count ?? 0;

        const abstractionStats = await this.neo4j.execute(`
            MATCH ()-[r:ABSTRACTION]->() RETURN count(r) as count
        `);
        const abstractionEdges =
            (abstractionStats.records[0] as any)?.count ?? 0;

        const associationStats = await this.neo4j.execute(`
            MATCH ()-[r:ASSOCIATION]->() RETURN count(r) as count
        `);
        const associationEdges =
            (associationStats.records[0] as any)?.count ?? 0;

        return {
            episodicCount,
            semanticCount,
            temporalEdges,
            abstractionEdges,
            associationEdges,
        };
    }

    async clearActivations(): Promise<void> {
        await this.neo4j.write(`MATCH (n) REMOVE n.activation`);
    }

    /**
     * 获取高激活节点
     * @param threshold 激活值阈值
     */
    async getHighActivationNodes(threshold: number): Promise<ActivationResult[]> {
        try {
            const result = await this.neo4j.execute(
                `MATCH (n) WHERE n.activation IS NOT NULL AND n.activation >= $threshold
                 RETURN n.qdrantId as vsQdrantId, n.messageId as veId, n.activation as activation, labels(n)[0] as type
                 ORDER BY n.activation DESC`,
                { threshold },
            );

            return result.records.map((record: any) => ({
                nodeId: record.vsQdrantId || record.veId,
                nodeType: record.type === "EpisodicNode" ? "episodic" : "semantic",
                activation: record.activation,
            }));
        } catch (error) {
            throw new SemanticMemoryError(
                `getHighActivationNodes失败: ${error instanceof Error ? error.message : String(error)}`,
                "GET_HIGH_ACTIVATION_NODES_ERROR",
                { threshold } as any,
            );
        }
    }

    /**
     * 重置激活值
     */
    async resetActivationValues(): Promise<void> {
        await this.clearActivations();
    }
}

// ============================================================================
// Spreading Activation 接口
// ============================================================================

/**
 * Spreading Activation 配置
 */
export interface ActivationConfig {
    damping: number;
    maxIterations: number;
    threshold: number;
    steepness: number;
    nodeDecay: number;
}

/**
 * 激活结果
 */
export interface ActivationResult {
    nodeId: string;
    nodeType: "episodic" | "semantic";
    activation: number;
}

/**
 * Lateral Inhibition 配置
 */
export interface InhibitionConfig {
    threshold: number;
    inhibitionFactor: number;
    topM: number;
}

/**
 * 抑制结果
 */
export interface InhibitionResult {
    nodeId: string;
    nodeType: "episodic" | "semantic";
    originalActivation: number;
    finalActivation: number;
    wasInhibited: boolean;
}
