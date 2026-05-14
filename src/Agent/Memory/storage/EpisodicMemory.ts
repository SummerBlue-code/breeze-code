/**
 * 消息角色
 */
export type MessageRole = "user" | "assistant";

/**
 * 消息数据（独立存储，支持细粒度检索）
 */
export interface Message {
    id: string;
    eventId: string;
    interactionId: string;
    role: MessageRole;
    content: string;
    summary: string;
    entities: string[];
    vector: number[];
    messageIndex: number;
    createdAt: Date;
}

/**
 * Interaction 数据（通过 messageIds 引用消息）
 */
export interface Interaction {
    id: string;
    eventId: string;
    interactionIndex: number;
    messageIds: string[];
    createdAt: Date;
    vector: number[];
}

/**
 * 事件数据
 */
export interface Event {
    id: string;
    vector: number[];
    topic: string;
    description: string;
    entities: string[];
    messageCount: number;
    interactionCount: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * @deprecated 旧类型别名，保持向后兼容
 */
export type UserQuery = Pick<Message, "content" | "entities" | "summary"> & {
    resolvedContent?: string;
};

/**
 * @deprecated 旧类型别名，保持向后兼容
 */
export type AssistantResponse = Pick<Message, "content" | "summary">;

/**
 * 带 Interactions 的事件（用于阶段一召回）
 */
export interface EventWithInteractions {
    event: Event;
    interactions: Interaction[];
}

/**
 * 时间窗口过滤器
 */
export interface TimeWindowFilter {
    startTime: string;
    endTime: string;
}

/**
 * EpisodicMemory 配置
 */
export interface EpisodicConfig {
    dimension: number;
    interactionsCollectionName: string;
    eventsCollectionName: string;
    messagesCollectionName: string;
    qdrantUrl: string;
    qdrantApiKey?: string;
}

/**
 * EpisodicMemory 错误
 */
export class EpisodicMemoryError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>,
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class EpisodicMemoryConfigError extends EpisodicMemoryError {
    constructor(field: string, value: unknown, expected: string) {
        super(
            `EpisodicMemory配置无效: ${field} 值为 ${JSON.stringify(value)}, 期望 ${expected}`,
            "INVALID_CONFIG",
            { field, value, expected },
        );
    }
}

import { QdrantClient } from "@qdrant/js-client-rest";

export class EpisodicMemory {
    private config: EpisodicConfig;
    private qdrant: QdrantClient;
    private initPromise: Promise<void>;

    constructor(config: EpisodicConfig) {
        this.validateConfig(config);
        this.config = config;
        this.qdrant = new QdrantClient({
            url: this.config.qdrantUrl,
            apiKey: this.config.qdrantApiKey,
        });
        // 保存初始化 Promise
        this.initPromise = this.initialize();
    }

    /**
     * 等待初始化完成
     */
    async ready(): Promise<void> {
        await this.initPromise;
    }

    private validateConfig(config: EpisodicConfig): void {
        if (!config.dimension || config.dimension <= 0) {
            throw new EpisodicMemoryConfigError(
                "dimension",
                config.dimension,
                "正整数(如: 1536)",
            );
        }
        if (!config.interactionsCollectionName?.trim()) {
            throw new EpisodicMemoryConfigError(
                "interactionsCollectionName",
                config.interactionsCollectionName,
                "非空字符串（如: episodic_interactions）",
            );
        }
        if (!config.eventsCollectionName?.trim()) {
            throw new EpisodicMemoryConfigError(
                "eventsCollectionName",
                config.eventsCollectionName,
                "非空字符串（如: episodic_events）",
            );
        }
        if (!config.messagesCollectionName?.trim()) {
            throw new EpisodicMemoryConfigError(
                "messagesCollectionName",
                config.messagesCollectionName,
                "非空字符串（如: episodic_messages）",
            );
        }
        if (!config.qdrantUrl?.trim()) {
            throw new EpisodicMemoryConfigError(
                "qdrantUrl",
                config.qdrantUrl,
                "非空字符串（如: http://localhost:6333）",
            );
        }
    }

    /**
     * 初始化向量数据库集合
     * 自动创建 messages、interactions 和 events 集合（如果不存在）
     */
    async initialize(): Promise<void> {
        try {
            await this.qdrant.getCollection(this.config.messagesCollectionName);
        } catch {
            await this.qdrant.createCollection(
                this.config.messagesCollectionName,
                {
                    vectors: {
                        size: this.config.dimension,
                        distance: "Cosine",
                    },
                },
            );
        }

        try {
            await this.qdrant.getCollection(
                this.config.interactionsCollectionName,
            );
        } catch {
            await this.qdrant.createCollection(
                this.config.interactionsCollectionName,
                {
                    vectors: {
                        size: this.config.dimension,
                        distance: "Cosine",
                    },
                },
            );
        }

        try {
            await this.qdrant.getCollection(this.config.eventsCollectionName);
        } catch {
            await this.qdrant.createCollection(
                this.config.eventsCollectionName,
                {
                    vectors: {
                        size: this.config.dimension,
                        distance: "Cosine",
                    },
                },
            );
        }

        await this.createIndexes();
    }

    /**
     * 创建 Payload 索引
     * 为 messages、interactions 和 events 集合的常用字段创建索引以提升过滤查询性能
     */
    private async createIndexes(): Promise<void> {
        type FieldSchema =
            | "keyword"
            | "float"
            | "datetime"
            | "integer"
            | "geo"
            | "text"
            | "bool"
            | "uuid";

        const messagesIndexes: {
            fieldName: string;
            fieldSchema: FieldSchema;
        }[] = [
            { fieldName: "eventId", fieldSchema: "keyword" },
            { fieldName: "interactionId", fieldSchema: "keyword" },
            { fieldName: "role", fieldSchema: "keyword" },
            { fieldName: "messageIndex", fieldSchema: "integer" },
            { fieldName: "createdAt", fieldSchema: "datetime" },
        ];

        const interactionsIndexes: {
            fieldName: string;
            fieldSchema: FieldSchema;
        }[] = [
            { fieldName: "eventId", fieldSchema: "keyword" },
            { fieldName: "interactionIndex", fieldSchema: "integer" },
            { fieldName: "createdAt", fieldSchema: "datetime" },
        ];

        const eventsIndexes: { fieldName: string; fieldSchema: FieldSchema }[] =
            [
                { fieldName: "type", fieldSchema: "keyword" },
                { fieldName: "topic", fieldSchema: "keyword" },
                { fieldName: "entities", fieldSchema: "keyword" },
                { fieldName: "messageCount", fieldSchema: "integer" },
                { fieldName: "interactionCount", fieldSchema: "integer" },
                { fieldName: "createdAt", fieldSchema: "datetime" },
                { fieldName: "updatedAt", fieldSchema: "datetime" },
            ];

        for (const idx of messagesIndexes) {
            try {
                await this.qdrant.createPayloadIndex(
                    this.config.messagesCollectionName,
                    {
                        field_name: idx.fieldName,
                        field_schema: idx.fieldSchema,
                    },
                );
            } catch {}
        }

        for (const idx of interactionsIndexes) {
            try {
                await this.qdrant.createPayloadIndex(
                    this.config.interactionsCollectionName,
                    {
                        field_name: idx.fieldName,
                        field_schema: idx.fieldSchema,
                    },
                );
            } catch {}
        }

        for (const idx of eventsIndexes) {
            try {
                await this.qdrant.createPayloadIndex(
                    this.config.eventsCollectionName,
                    {
                        field_name: idx.fieldName,
                        field_schema: idx.fieldSchema,
                    },
                );
            } catch {}
        }
    }

    /**
     * 创建新事件
     * @param topic 事件主题
     * @param description 事件描述（用于生成向量）
     * @param entities 涉及的实体列表
     * @param eventVector 事件描述的向量表示
     * @returns 创建的事件ID
     */
    async addEvent(
        topic: string,
        description: string,
        entities: string[],
        eventVector: number[],
    ): Promise<string> {
        const eventId = crypto.randomUUID();
        const now = new Date();

        await this.qdrant.upsert(this.config.eventsCollectionName, {
            wait: true,
            points: [
                {
                    id: eventId,
                    vector: eventVector,
                    payload: {
                        topic,
                        description,
                        entities,
                        messageCount: 0,
                        interactionCount: 0,
                        createdAt: now.toISOString(),
                        updatedAt: now.toISOString(),
                    },
                },
            ],
        });

        return eventId;
    }

    /**
     * 添加消息到事件
     * @param eventId 事件ID
     * @param interactionId 交互ID
     * @param role 消息角色
     * @param content 消息内容
     * @param vector 消息向量
     * @param summary 摘要
     * @param entities 实体列表
     * @param messageIndex 消息索引
     * @returns 创建的消息ID
     */
    async addMessage(
        eventId: string,
        interactionId: string,
        role: MessageRole,
        content: string,
        vector: number[],
        summary: string = "",
        entities: string[] = [],
        messageIndex: number = 0,
    ): Promise<string> {
        const messageId = crypto.randomUUID();
        const now = new Date();

        await this.qdrant.upsert(this.config.messagesCollectionName, {
            wait: true,
            points: [
                {
                    id: messageId,
                    vector,
                    payload: {
                        eventId,
                        interactionId,
                        role,
                        content,
                        summary,
                        entities,
                        messageIndex,
                        createdAt: now.toISOString(),
                    },
                },
            ],
        });

        return messageId;
    }

    /**
     * 根据 ID 获取单个消息
     * @param messageId 消息ID
     * @returns 消息对象
     */
    async getMessageById(messageId: string): Promise<Message | null> {
        try {
            const result = await this.qdrant.retrieve(
                this.config.messagesCollectionName,
                {
                    ids: [messageId],
                    with_payload: true,
                    with_vector: true,
                },
            );

            if (!result || result.length === 0) {
                return null;
            }

            const point = result[0];
            if (!point) {
                return null;
            }

            const payload = point.payload as {
                eventId: string;
                interactionId: string;
                role: MessageRole;
                content: string;
                summary: string;
                entities: string[];
                messageIndex: number;
                createdAt: string;
            };

            return {
                id: String(point.id),
                eventId: payload.eventId,
                interactionId: payload.interactionId,
                role: payload.role,
                content: payload.content,
                summary: payload.summary,
                entities: payload.entities,
                messageIndex: payload.messageIndex,
                createdAt: new Date(payload.createdAt),
                vector: point.vector as number[],
            };
        } catch {
            console.warn(`[getMessageById] 获取 message 失败: ${messageId}`);
            return null;
        }
    }

    /**
     * 根据 messageIds 获取多条消息
     * @param messageIds 消息ID列表
     * @returns 消息列表（按 messageIds 顺序）
     */
    async getMessagesByIds(messageIds: string[]): Promise<Message[]> {
        if (messageIds.length === 0) {
            return [];
        }

        try {
            const result = await this.qdrant.retrieve(
                this.config.messagesCollectionName,
                {
                    ids: messageIds,
                    with_payload: true,
                    with_vector: true,
                },
            );

            // 按 messageIds 的顺序返回
            const messageMap = new Map<string, Message>();
            for (const point of result) {
                const payload = point.payload as {
                    eventId: string;
                    interactionId: string;
                    role: MessageRole;
                    content: string;
                    summary: string;
                    entities: string[];
                    messageIndex: number;
                    createdAt: string;
                };

                const message: Message = {
                    id: String(point.id),
                    eventId: payload.eventId,
                    interactionId: payload.interactionId,
                    role: payload.role,
                    content: payload.content,
                    summary: payload.summary,
                    entities: payload.entities,
                    messageIndex: payload.messageIndex,
                    createdAt: new Date(payload.createdAt),
                    vector: point.vector as number[],
                };
                messageMap.set(message.id, message);
            }

            // 按 messageIds 顺序返回
            const messages: Message[] = [];
            for (const id of messageIds) {
                const msg = messageMap.get(id);
                if (msg) {
                    messages.push(msg);
                }
            }

            return messages;
        } catch {
            console.warn(`[getMessagesByIds] 获取 messages 失败`);
            return [];
        }
    }

    /**
     * 删除消息
     * @param messageId 消息ID
     */
    async deleteMessage(messageId: string): Promise<void> {
        await this.qdrant.delete(this.config.messagesCollectionName, {
            points: [messageId],
        });
    }

    /**
     * 更新事件信息
     * @param eventId 事件ID
     * @param updates 要更新的字段
     * @param newVector 新的向量（当 description 变化时需要传入）
     */
    async updateEvent(
        eventId: string,
        updates: {
            topic?: string;
            description?: string;
            entities?: string[];
        },
        newVector?: number[],
    ): Promise<void> {
        const event = await this.getEventById(eventId);

        const now = new Date();

        await this.qdrant.upsert(this.config.eventsCollectionName, {
            wait: true,
            points: [
                {
                    id: eventId,
                    vector: newVector ?? event.vector,
                    payload: {
                        topic: updates.topic ?? event.topic,
                        description: updates.description ?? event.description,
                        entities: updates.entities ?? event.entities,
                        messageCount: event.messageCount,
                        interactionCount: event.interactionCount,
                        createdAt: event.createdAt,
                        updatedAt: now.toISOString(),
                    },
                },
            ],
        });
    }

    /**
     * 添加 Interaction 到事件
     * @param eventId 事件ID
     * @param messageIds 关联的消息ID数组
     * @param vector Interaction 的向量表示
     * @returns 创建的 Interaction ID
     */
    async addInteraction(
        eventId: string,
        messageIds: string[],
        vector: number[],
    ): Promise<string> {
        const interactionId = crypto.randomUUID();
        const now = new Date();

        const event = await this.getEventById(eventId);
        const interactionIndex = event.interactionCount;

        // 1. 创建 Interaction，引用 messageIds
        await this.qdrant.upsert(this.config.interactionsCollectionName, {
            wait: true,
            points: [
                {
                    id: interactionId,
                    vector,
                    payload: {
                        eventId,
                        interactionIndex,
                        messageIds,
                        createdAt: now.toISOString(),
                    },
                },
            ],
        });

        // 2. 更新 event 的 messageCount 和 interactionCount
        await this.qdrant.upsert(this.config.eventsCollectionName, {
            wait: true,
            points: [
                {
                    id: eventId,
                    vector: event.vector,
                    payload: {
                        topic: event.topic,
                        description: event.description,
                        entities: event.entities,
                        messageCount: event.messageCount + messageIds.length,
                        interactionCount: event.interactionCount + 1,
                        createdAt: event.createdAt,
                        updatedAt: now.toISOString(),
                    },
                },
            ],
        });

        return interactionId;
    }

    /**
     * 将多个事件的 interactions 转移到新事件（保留原有 createdAt 时间戳）
     * @param sourceEventIds 源事件ID列表
     * @param targetEventId 目标事件ID
     * @param vectors 源 interactions 对应的向量列表（按排序顺序）
     * @returns 转移后的 interaction 数量
     */
    async transferInteractions(
        sourceEventIds: string[],
        targetEventId: string,
        vectors: number[][],
    ): Promise<number> {
        const now = new Date();

        // 获取目标事件当前信息
        const targetEvent = await this.getEventById(targetEventId);
        let interactionIndex = targetEvent.interactionCount;

        // 收集所有需要转移的 interactions
        const allInteractions: {
            id: string;
            interaction: Interaction;
        }[] = [];

        for (const eventId of sourceEventIds) {
            const interactions = await this.getInteractionsByEventId(
                eventId,
                1000,
            );
            for (const int of interactions) {
                allInteractions.push({
                    id: int.id,
                    interaction: int,
                });
            }
        }

        // 按时间排序
        allInteractions.sort(
            (a, b) =>
                new Date(a.interaction.createdAt).getTime() -
                new Date(b.interaction.createdAt).getTime(),
        );

        // 批量更新 interactions 的 eventId 和 interactionIndex（保留 createdAt）
        const points: any[] = [];
        for (let i = 0; i < allInteractions.length; i++) {
            const item = allInteractions[i];
            const vector = vectors[i];
            if (!item || !vector) continue;
            const { id, interaction } = item;
            points.push({
                id,
                vector,
                payload: {
                    eventId: targetEventId,
                    interactionIndex: interactionIndex++,
                    messageIds: interaction.messageIds,
                    createdAt: interaction.createdAt, // 保留原有时间戳
                },
            });
        }

        if (points.length > 0) {
            await this.qdrant.upsert(this.config.interactionsCollectionName, {
                wait: true,
                points,
            });
        }

        // 更新目标事件的 interactionCount
        await this.qdrant.upsert(this.config.eventsCollectionName, {
            wait: true,
            points: [
                {
                    id: targetEventId,
                    vector: targetEvent.vector,
                    payload: {
                        topic: targetEvent.topic,
                        description: targetEvent.description,
                        entities: targetEvent.entities,
                        interactionCount: interactionIndex,
                        createdAt: targetEvent.createdAt,
                        updatedAt: now.toISOString(),
                    },
                },
            ],
        });

        return points.length;
    }

    /**
     * 获取事件的所有 Interaction
     * @param eventId 事件ID
     * @param limit 返回数量限制，默认 10
     * @returns 事件的 Interaction 列表
     * @throws 事件不存在时抛出错误
     */
    async getInteractionsByEventId(
        eventId: string,
        limit: number = 10,
    ): Promise<Interaction[]> {
        // 先检查事件是否存在，不存在会抛出错误
        await this.getEventById(eventId);

        const baseFilter = {
            must: [
                {
                    key: "eventId",
                    match: { value: eventId },
                },
            ],
        };

        const result = await this.qdrant.scroll(
            this.config.interactionsCollectionName,
            {
                filter: baseFilter,
                limit,
                with_payload: true,
                with_vector: true,
                order_by: {
                    key: "interactionIndex",
                    direction: "asc",
                },
            },
        );

        return result.points.map((point) => {
            const payload = point.payload as {
                eventId: string;
                interactionIndex: number;
                messageIds: string[];
                createdAt: string;
            };

            return {
                id: String(point.id),
                eventId: payload.eventId,
                interactionIndex: payload.interactionIndex,
                messageIds: payload.messageIds,
                createdAt: new Date(payload.createdAt),
                vector: point.vector as number[],
            };
        });
    }

    /**
     * 获取事件最新的 N 条 Interactions
     * @param eventId 事件ID
     * @param limit 返回数量限制，默认 3
     * @returns 按时间倒序的最新 interactions
     */
    async getRecentInteractions(
        eventId: string,
        limit: number = 3,
    ): Promise<Interaction[]> {
        // 先检查事件是否存在
        await this.getEventById(eventId);

        const baseFilter = {
            must: [
                {
                    key: "eventId",
                    match: { value: eventId },
                },
            ],
        };

        const result = await this.qdrant.scroll(
            this.config.interactionsCollectionName,
            {
                filter: baseFilter,
                limit,
                with_payload: true,
                with_vector: true,
                order_by: {
                    key: "interactionIndex",
                    direction: "desc", // 倒序获取最新的
                },
            },
        );

        return result.points.map((point) => {
            const payload = point.payload as {
                eventId: string;
                interactionIndex: number;
                messageIds: string[];
                createdAt: string;
            };

            return {
                id: String(point.id),
                eventId: payload.eventId,
                interactionIndex: payload.interactionIndex,
                messageIds: payload.messageIds,
                createdAt: new Date(payload.createdAt),
                vector: point.vector as number[],
            };
        });
    }

    /**
     * 获取 Interaction 的上下文（前后各 N 条）
     * @param interactionId 中心 Interaction ID
     * @param contextSize 上下文大小（前后各 N 条），默认 1
     * @returns 包含中心 interaction 及其上下文的列表，按时间升序排列
     */
    async getInteractionContext(
        interactionId: string,
        contextSize: number = 1,
    ): Promise<Interaction[]> {
        // 获取中心 interaction
        const centerInteraction = await this.getInteractionById(interactionId);
        if (!centerInteraction) {
            return [];
        }

        const eventId = centerInteraction.eventId;
        const centerIndex = centerInteraction.interactionIndex;

        // 获取该事件的所有 interactions
        const allInteractions = await this.getInteractionsByEventId(
            eventId,
            1000,
        );

        // 找到中心 interaction 的位置
        const centerPos = allInteractions.findIndex(
            (i) => i.id === interactionId,
        );

        if (centerPos === -1) {
            return [centerInteraction];
        }

        // 计算上下文范围
        const startPos = Math.max(0, centerPos - contextSize);
        const endPos = Math.min(
            allInteractions.length - 1,
            centerPos + contextSize,
        );

        // 提取上下文并按时间升序排列
        const contextInteractions = allInteractions.slice(startPos, endPos + 1);

        return contextInteractions;
    }

    /**
     * 获取全局最近的 Interactions 及其所在事件
     * @param limit 返回数量限制，默认 5
     * @returns 最近的 interactions 及其所在事件列表
     */
    async searchRecentInteractions(
        limit: number = 5,
    ): Promise<EventWithInteractions[]> {
        const result = await this.qdrant.scroll(
            this.config.interactionsCollectionName,
            {
                limit,
                with_payload: true,
                with_vector: true,
                order_by: { key: "createdAt", direction: "desc" },
            },
        );

        if (result.points.length === 0) {
            return [];
        }

        // 按 eventId 分组，避免重复获取同一事件
        const eventIdToInteractionIds = new Map<string, string[]>();
        for (const point of result.points) {
            const payload = point.payload as { eventId: string };
            const eventId = payload.eventId;
            if (!eventIdToInteractionIds.has(eventId)) {
                eventIdToInteractionIds.set(eventId, []);
            }
            eventIdToInteractionIds.get(eventId)!.push(String(point.id));
        }

        // 转换为 EventWithInteractions 格式
        const eventWithInteractionsList: EventWithInteractions[] = [];

        for (const [eventId, interactionIds] of eventIdToInteractionIds) {
            // 获取事件信息
            const event = await this.getEventById(eventId);

            // 获取这些 interactions
            const interactions: Interaction[] = [];
            for (const interactionId of interactionIds) {
                const interaction =
                    await this.getInteractionById(interactionId);
                if (interaction) {
                    interactions.push(interaction);
                }
            }

            // 按 interactionIndex 排序
            interactions.sort(
                (a, b) => a.interactionIndex - b.interactionIndex,
            );

            eventWithInteractionsList.push({
                event,
                interactions,
            });
        }

        return eventWithInteractionsList;
    }

    /**
     * 获取单个 Interaction 的原始数据（包括向量）
     * @param interactionId Interaction ID
     * @returns 包含向量和原始 payload 的 Interaction 数据
     */
    async getInteractionById(
        interactionId: string,
    ): Promise<(Interaction & { vector: number[] }) | null> {
        try {
            const result = await this.qdrant.retrieve(
                this.config.interactionsCollectionName,
                {
                    ids: [interactionId],
                    with_payload: true,
                    with_vector: true,
                },
            );

            if (!result || result.length === 0) {
                return null;
            }

            const point = result[0];
            if (!point) {
                return null;
            }
            const payload = point.payload as {
                eventId: string;
                interactionIndex: number;
                messageIds: string[];
                createdAt: string;
            };

            return {
                id: String(point.id),
                eventId: payload.eventId,
                interactionIndex: payload.interactionIndex,
                messageIds: payload.messageIds,
                createdAt: new Date(payload.createdAt),
                vector: point.vector as number[],
            };
        } catch {
            console.warn(
                `[getInteractionById] 获取 interaction 失败: ${interactionId}`,
            );
            return null;
        }
    }

    /**
     * 删除单个 Interaction
     * @param interactionId 要删除的 Interaction ID
     */
    async deleteInteraction(interactionId: string): Promise<void> {
        await this.qdrant.delete(this.config.interactionsCollectionName, {
            points: [interactionId],
        });
    }

    /**
     * 删除事件及其所有关联的 Interactions
     * @param eventId 要删除的事件 ID
     */
    async deleteEvent(eventId: string): Promise<void> {
        // 1. 删除该事件的所有 interactions
        const interactions = await this.getInteractionsByEventId(eventId, 1000);
        for (const interaction of interactions) {
            try {
                await this.deleteInteraction(interaction.id);
            } catch {
                console.warn(
                    `[deleteEvent] 删除 interaction 失败: ${interaction.id}`,
                );
            }
        }

        // 2. 删除事件本身
        await this.qdrant.delete(this.config.eventsCollectionName, {
            points: [eventId],
        });
    }

    /**
     * 根据向量搜索相似事件
     * @param vector 查询向量
     * @param threshold 相似度阈值
     * @param limit 返回数量限制，默认 10
     * @param timeWindow 可选的时间窗口过滤器
     * @returns 匹配的事件列表，带相似度分数和最新 3 条 interactions
     */
    async searchEventsByVector(
        vector: number[],
        threshold: number,
        limit: number = 10,
        timeWindow?: TimeWindowFilter,
    ): Promise<EventWithInteractions[]> {
        // 构建过滤条件
        const filter = timeWindow
            ? {
                  must: [
                      {
                          key: "updatedAt",
                          range: {
                              gte: timeWindow.startTime,
                              lte: timeWindow.endTime,
                          },
                      },
                  ],
              }
            : undefined;

        const result = await this.qdrant.search(
            this.config.eventsCollectionName,
            {
                vector,
                limit,
                score_threshold: threshold,
                with_payload: true,
                with_vector: true,
                filter,
            },
        );

        if (!result || result.length === 0) {
            return [];
        }

        // 转换为 EventWithInteractions 格式
        const eventWithInteractionsList: EventWithInteractions[] = [];

        for (const item of result) {
            const payload = item.payload as {
                topic: string;
                description: string;
                entities: string[];
                messageCount: number;
                interactionCount: number;
                createdAt: string;
                updatedAt: string;
            };

            const event: Event = {
                id: String(item.id),
                vector: item.vector as number[],
                topic: payload.topic,
                description: payload.description,
                entities: payload.entities,
                messageCount: payload.messageCount,
                interactionCount: payload.interactionCount,
                createdAt: payload.createdAt,
                updatedAt: payload.updatedAt,
            };

            // 获取该事件最新的 3 条 interactions
            const interactions = await this.getRecentInteractions(event.id, 3);

            eventWithInteractionsList.push({
                event,
                interactions,
            });
        }

        return eventWithInteractionsList;
    }

    /**
     * 按实体搜索事件
     * @param entities 查询实体列表
     * @param limit 返回数量限制，默认 10
     * @returns 包含任一实体的匹配事件列表
     */
    async searchEventsByEntities(
        entities: string[],
        limit: number = 10,
    ): Promise<Event[]> {
        if (entities.length === 0) {
            return [];
        }

        // 使用 match_any 来匹配数组中的任一元素
        const baseFilter = {
            should: [
                {
                    key: "entities",
                    match: { any: entities },
                },
            ],
        };

        const result = await this.qdrant.scroll(
            this.config.eventsCollectionName,
            {
                filter: baseFilter,
                limit,
                with_payload: true,
                with_vector: true,
                order_by: { key: "updatedAt", direction: "desc" },
            },
        );

        return result.points.map((point) => {
            const payload = point.payload as {
                topic: string;
                description: string;
                entities: string[];
                messageCount: number;
                interactionCount: number;
                createdAt: string;
                updatedAt: string;
            };

            return {
                id: String(point.id),
                vector: point.vector as number[],
                topic: payload.topic,
                description: payload.description,
                entities: payload.entities,
                messageCount: payload.messageCount,
                interactionCount: payload.interactionCount,
                createdAt: payload.createdAt,
                updatedAt: payload.updatedAt,
            };
        });
    }

    /**
     * 根据实体搜索 Interactions 并返回上下文
     * @param entities 查询实体列表
     * @param limit 返回数量限制，默认 10
     * @param timeWindow 可选的时间窗口过滤器
     * @returns 匹配的事件列表，带上下文窗口 interactions
     */
    async searchInteractionsByEntities(
        entities: string[],
        limit: number = 10,
        timeWindow?: TimeWindowFilter,
    ): Promise<EventWithInteractions[]> {
        if (entities.length === 0) {
            return [];
        }

        // 构建过滤条件
        let filter: Record<string, unknown>;
        if (timeWindow) {
            filter = {
                must: [
                    {
                        key: "entities",
                        match: { any: entities },
                    },
                    {
                        key: "updatedAt",
                        range: {
                            gte: timeWindow.startTime,
                            lte: timeWindow.endTime,
                        },
                    },
                ],
            };
        } else {
            filter = {
                must: [
                    {
                        key: "entities",
                        match: { any: entities },
                    },
                ],
            };
        }

        const result = await this.qdrant.scroll(
            this.config.eventsCollectionName,
            {
                filter,
                limit,
                with_payload: true,
                with_vector: true,
                order_by: { key: "updatedAt", direction: "desc" },
            },
        );

        if (result.points.length === 0) {
            return [];
        }

        // 转换为 EventWithInteractions 格式
        const eventWithInteractionsList: EventWithInteractions[] = [];

        for (const point of result.points) {
            const payload = point.payload as {
                topic: string;
                description: string;
                entities: string[];
                messageCount: number;
                interactionCount: number;
                createdAt: string;
                updatedAt: string;
            };

            const event: Event = {
                id: String(point.id),
                vector: point.vector as number[],
                topic: payload.topic,
                description: payload.description,
                entities: payload.entities,
                messageCount: payload.messageCount,
                interactionCount: payload.interactionCount,
                createdAt: payload.createdAt,
                updatedAt: payload.updatedAt,
            };

            // 获取该事件的所有 interactions，找到最新的一条作为上下文中心
            const interactions = await this.getInteractionsByEventId(
                event.id,
                1000,
            );

            if (interactions.length > 0) {
                // 使用最新的 interaction 作为中心，获取上下文
                const latestInteraction =
                    interactions[interactions.length - 1]!;
                const contextInteractions = await this.getInteractionContext(
                    latestInteraction.id,
                    1,
                );
                eventWithInteractionsList.push({
                    event,
                    interactions: contextInteractions,
                });
            } else {
                eventWithInteractionsList.push({
                    event,
                    interactions: [],
                });
            }
        }

        return eventWithInteractionsList;
    }

    /**
     * 获取最近更新的事件
     * @param limit 返回数量限制，默认 5
     * @returns 最近更新的事件列表，带最新 3 条 interactions
     */
    async getRecentEvents(limit: number = 5): Promise<EventWithInteractions[]> {
        const result = await this.qdrant.scroll(
            this.config.eventsCollectionName,
            {
                limit,
                with_payload: true,
                with_vector: true,
                order_by: { key: "updatedAt", direction: "desc" },
            },
        );

        if (result.points.length === 0) {
            return [];
        }

        // 转换为 EventWithInteractions 格式
        const eventWithInteractionsList: EventWithInteractions[] = [];

        for (const point of result.points) {
            const payload = point.payload as {
                topic: string;
                description: string;
                entities: string[];
                messageCount: number;
                interactionCount: number;
                createdAt: string;
                updatedAt: string;
            };

            const event: Event = {
                id: String(point.id),
                vector: point.vector as number[],
                topic: payload.topic,
                description: payload.description,
                entities: payload.entities,
                messageCount: payload.messageCount,
                interactionCount: payload.interactionCount,
                createdAt: payload.createdAt,
                updatedAt: payload.updatedAt,
            };

            // 获取该事件最新的 3 条 interactions
            const interactions = await this.getRecentInteractions(event.id, 3);

            eventWithInteractionsList.push({
                event,
                interactions,
            });
        }

        return eventWithInteractionsList;
    }

    /**
     * 根据时间窗口检索事件
     * @param startTime 开始时间（ISO 字符串）
     * @param endTime 结束时间（ISO 字符串）
     * @param limit 返回数量限制，默认 30
     * @returns 在指定时间范围内的事件列表，带最新 3 条 interactions
     */
    async searchEventsByTimeRange(
        startTime: string,
        endTime: string,
        limit: number = 30,
    ): Promise<EventWithInteractions[]> {
        // 使用 range filter 过滤 updatedAt 在时间范围内的事件
        const filter = {
            must: [
                {
                    key: "updatedAt",
                    range: {
                        gte: startTime,
                        lte: endTime,
                    },
                },
            ],
        };

        const result = await this.qdrant.scroll(
            this.config.eventsCollectionName,
            {
                filter,
                limit,
                with_payload: true,
                with_vector: true,
                order_by: { key: "updatedAt", direction: "desc" },
            },
        );

        if (result.points.length === 0) {
            return [];
        }

        // 转换为 EventWithInteractions 格式
        const eventWithInteractionsList: EventWithInteractions[] = [];

        for (const point of result.points) {
            const payload = point.payload as {
                topic: string;
                description: string;
                entities: string[];
                messageCount: number;
                interactionCount: number;
                createdAt: string;
                updatedAt: string;
            };

            const event: Event = {
                id: String(point.id),
                vector: point.vector as number[],
                topic: payload.topic,
                description: payload.description,
                entities: payload.entities,
                messageCount: payload.messageCount,
                interactionCount: payload.interactionCount,
                createdAt: payload.createdAt,
                updatedAt: payload.updatedAt,
            };

            // 获取该事件最新的 3 条 interactions
            const interactions = await this.getRecentInteractions(event.id, 3);

            eventWithInteractionsList.push({
                event,
                interactions,
            });
        }

        return eventWithInteractionsList;
    }

    /**
     * 根据向量搜索相似 Interaction
     * @param vector 查询向量
     * @param threshold 相似度阈值
     * @param limit 返回数量限制，默认 10
     * @param timeWindow 可选的时间窗口过滤器
     * @returns 匹配的事件列表，带上下文窗口 interactions
     */
    async searchInteractionsByVector(
        vector: number[],
        threshold: number,
        limit: number = 10,
        timeWindow?: TimeWindowFilter,
    ): Promise<EventWithInteractions[]> {
        // 构建过滤条件：基于 interaction 的 createdAt
        const filter = timeWindow
            ? {
                  must: [
                      {
                          key: "createdAt",
                          range: {
                              gte: timeWindow.startTime,
                              lte: timeWindow.endTime,
                          },
                      },
                  ],
              }
            : undefined;

        const result = await this.qdrant.search(
            this.config.interactionsCollectionName,
            {
                vector,
                limit,
                score_threshold: threshold,
                with_payload: true,
                with_vector: true,
                filter,
            },
        );

        if (!result || result.length === 0) {
            return [];
        }

        // 按 eventId 分组，避免重复获取同一事件的上下文
        const eventIdToInteractionId = new Map<string, string>();
        for (const item of result) {
            const payload = item.payload as { eventId: string };
            const eventId = payload.eventId;
            // 保留第一个（最相似的）interactionId
            if (!eventIdToInteractionId.has(eventId)) {
                eventIdToInteractionId.set(eventId, String(item.id));
            }
        }

        // 转换为 EventWithInteractions 格式
        const eventWithInteractionsList: EventWithInteractions[] = [];

        for (const [eventId, interactionId] of eventIdToInteractionId) {
            // 获取事件信息
            const event = await this.getEventById(eventId);

            // 获取该 interaction 的上下文（前后各 1 条）
            const interactions = await this.getInteractionContext(
                interactionId,
                1,
            );

            eventWithInteractionsList.push({
                event,
                interactions,
            });
        }

        return eventWithInteractionsList;
    }

    /**
     * 获取多个事件的 Interaction
     * @param eventIds 事件ID列表
     * @param limit 返回数量限制，默认 30
     * @param offset 偏移量（可选，用于分页）
     * @returns Interaction 列表或分页结果
     * @throws 任一 eventId 不存在时抛出错误
     */
    async getInteractionsByEventIds(eventIds: string[]): Promise<Interaction[]>;

    async getInteractionsByEventIds(
        eventIds: string[],
        limit: number,
    ): Promise<Interaction[]>;

    async getInteractionsByEventIds(
        eventIds: string[],
        limit: number,
        offset: number,
    ): Promise<{
        interactions: Interaction[];
        total: number;
        hasMore: boolean;
    }>;

    async getInteractionsByEventIds(
        eventIds: string[],
        limit: number = 30,
        offset?: number,
    ): Promise<
        | Interaction[]
        | {
              interactions: Interaction[];
              total: number;
              hasMore: boolean;
          }
    > {
        if (eventIds.length === 0) {
            return [];
        }

        // 检查所有 eventId 是否存在，任一不存在会抛出错误
        await Promise.all(eventIds.map((id) => this.getEventById(id)));

        const baseFilter = {
            should: eventIds.map((id) => ({
                key: "eventId",
                match: { value: id },
            })),
        };

        if (offset === undefined) {
            const result = await this.qdrant.scroll(
                this.config.interactionsCollectionName,
                {
                    filter: baseFilter,
                    limit,
                    with_payload: true,
                    with_vector: true,
                    order_by: { key: "createdAt", direction: "desc" },
                },
            );

            return result.points.map((point) => {
                const payload = point.payload as {
                    eventId: string;
                    interactionIndex: number;
                    messageIds: string[];
                    createdAt: string;
                };

                return {
                    id: String(point.id),
                    eventId: payload.eventId,
                    interactionIndex: payload.interactionIndex,
                    messageIds: payload.messageIds,
                    createdAt: new Date(payload.createdAt),
                    vector: point.vector as number[],
                };
            });
        }

        const countResult = await this.qdrant.count(
            this.config.interactionsCollectionName,
            { filter: baseFilter },
        );

        const total = countResult?.count ?? 0;

        const result = await this.qdrant.scroll(
            this.config.interactionsCollectionName,
            {
                filter: baseFilter,
                limit,
                offset,
                with_payload: true,
                with_vector: true,
            },
        );

        const interactions = result.points.map((point) => {
            const payload = point.payload as {
                eventId: string;
                interactionIndex: number;
                messageIds: string[];
                createdAt: string;
            };

            return {
                id: String(point.id),
                eventId: payload.eventId,
                interactionIndex: payload.interactionIndex,
                messageIds: payload.messageIds,
                createdAt: new Date(payload.createdAt),
                vector: point.vector as number[],
            };
        });

        return {
            interactions,
            total,
            hasMore: offset + limit < total,
        };
    }

    /**
     * 根据 ID 获取事件
     * @param eventId 事件ID
     * @returns 事件对象
     * @throws 事件不存在时抛出错误
     */
    async getEventById(eventId: string): Promise<Event> {
        const result = await this.qdrant.scroll(
            this.config.eventsCollectionName,
            {
                filter: {
                    must: [
                        {
                            has_id: [eventId],
                        },
                    ],
                },
                limit: 1,
                with_payload: true,
                with_vector: true,
            },
        );

        const points = result.points;
        if (!points || points.length === 0) {
            throw new Error(`Event not found: ${eventId}`);
        }

        const firstResult = points[0]!;
        const payload = firstResult.payload! as {
            topic: string;
            description: string;
            entities: string[];
            messageCount: number;
            interactionCount: number;
            createdAt: string;
            updatedAt: string;
        };

        return {
            id: String(firstResult.id),
            vector: firstResult.vector! as number[],
            topic: payload.topic,
            description: payload.description,
            entities: payload.entities,
            messageCount: payload.messageCount,
            interactionCount: payload.interactionCount,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
        };
    }
}
