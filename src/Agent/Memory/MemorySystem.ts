import { Encoder, type EncoderConfig } from "./processing";
import { Extractor } from "./processing/Extractor";
import {
    EpisodicMemory,
    type EpisodicConfig,
    type Interaction,
    type Event,
    type EventWithInteractions,
} from "./storage/EpisodicMemory";
import {
    SemanticMemory,
    type SynapseMemoryConfig,
} from "./storage/SemanticMemory";
import OpenAI from "openai";
import type { Interface as ReadlineInterface } from "readline";

/**
 * 生成回答结果（包含元数据）
 */
interface GenerateResponseResult {
    content: string;
    hit: boolean; // 是否命中记忆
    usedContext: string[]; // 使用的上下文
    confidence: number;
}
/**
 * 消息类型
 */
export interface Message {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: string;
}

/**
 * Query 类型分类
 */
export type QueryType = "knowledge" | "chat" | "summary" | "unknown";

/**
 * 带相关度评分的 Interaction
 */
export interface InteractionWithRelevance {
    interaction: Interaction;
    relevanceScore: number; // 0-1 相关度得分
    reason: string; // 相关原因
    interactionIndex: number; // 在原始事件中的索引（从0开始）
}

/**
 * 带评分的事件及其 Interactions
 */
export interface EventWithScoredInteractions {
    event: Event;
    interactions: InteractionWithRelevance[];
    eventRelevanceScore: number; // 事件整体相关度
}

/**
 * 处理后的交互数据
 */
export interface ProcessedInteraction {
    userQuery: {
        content: string;
        resolvedContent: string;
        keywords: string[];
        summary: string;
    };
    assistantResponse: {
        content: string;
        summary: string;
    };
}

/**
 * 事件信息
 */
export interface EventInfo {
    id: string;
    topic: string;
    description: string;
    entities: string[];
}

/**
 * 搜索结果
 */
export interface SearchResult {
    eventId: string;
    topic: string;
    description: string;
    score: number;
}

/**
 * 构建上下文结果
 */
export interface BuildContextResult {
    eventId?: string;
    topic?: string;
    description?: string;
    entities: string[];
    createdAt?: string;
    updatedAt?: string;
    interactions: Interaction[];
}

/**
 * 查询信息提取结果
 */
export interface QueryInfo {
    entities: string[];
    timeWindow: {
        hours: number;
        label: string;
        startTime?: string;
        endTime?: string;
    } | null;
}

/**
 * 候选事件搜索结果
 */
export interface CandidateSearchResult {
    events: Event[];
    source: "vector" | "entity" | "interaction" | "recent" | "timeWindow";
}

/**
 * 上下文选择结果
 */
export interface ContextSelectResult {
    eventId: string;
    topic: string;
    reason: string;
}

/**
 * 事件上下文（用于 Query 改写）
 */
export interface EventContext {
    topic: string;
    description: string;
    interactions: Interaction[];
}

/**
 * Query 改写结果
 */
export interface RewriteResult {
    rewrittenQuery: string;
}

// ============================================================================
// 标准化阶段接口定义
// ============================================================================

/**
 * 时间窗口
 */
export interface TimeWindow {
    hours: number;
    label: string;
    startTime?: string;
    endTime?: string;
}

/**
 * 阈值配置
 */
interface ThresholdConfig {
    eventRelevanceThreshold: number;
    interactionRelevanceThreshold: number;
    maxEvents: number;
    maxInteractionsPerEvent: number;
    contextWindowSize: number;
}

/**
 * 窗口边界配置
 */
interface WindowBoundaryConfig {
    /** 检测话题变化的阈值 */
    topicChangeThreshold: number;
    /** 是否在边界时保存状态 */
    saveOnBoundary: boolean;
}

/**
 * 降级配置
 */
interface FallbackConfig {
    /** 激活值边界区间，使用 LLM 验证 */
    boundaryRange: { min: number; max: number };
    /** 是否启用 LLM 降级 */
    enabled: boolean;
}

/**
 * 阶段1: QUERY_ANALYSIS 结果
 */
interface QueryAnalysisResult {
    queryEmbedding: number[];
    entities: string[];
    timeWindow: TimeWindow | null;
    queryType: QueryType;
    thresholds: ThresholdConfig;
}

/**
 * 阶段2: RETRIEVE 结果
 */
interface RetrievalResult {
    candidateEvents: EventWithInteractions[];
    activatedMessages: Message[];
    activatedSemantics: SemanticNodeVector[];
    /** nodeId → activation 映射（用于 contextBuild） */
    indirectActivationMap: Map<string, number>;
    /** semanticId → messageIds 映射（用于 contextBuild） */
    semanticToMessagesMap: Map<string, string[]>;
}

/**
 * 阶段3: SELECT 结果
 */
interface SelectResult {
    selectedEvents: EventWithScoredInteractions[];
    activatedMessages: Message[];
    activatedSemantics: SemanticNodeVector[];
    /** nodeId → activation 映射 */
    activationMap: Map<string, number>;
    /** semanticId → messageIds 映射 */
    semanticToMessagesMap: Map<string, string[]>;
}

/**
 * 阶段4: CONTEXT_BUILD 结果
 */
interface ContextBuildResult {
    eventContextText: string;
    historyText: string;
    semanticContext?: string;
    activatedContent?: string[];
}

/**
 * 阶段5: RESOLVE 结果
 */
interface ResolveResult {
    resolvedQuery: string;
    needsClarification: boolean;
}

/**
 * 阶段7: STORE 结果
 */
interface StoreResult {
    destination: InteractionDestination;
    storedEventId: string;
    interactionId?: string;
    messageIds: string[];
}

/**
 * 阶段8: CONFIRM 结果
 */
interface ConfirmResult {
    confirmed: boolean;
    action: string;
}

// 来自 SemanticMemory 的类型（用于语义激活结果）
interface SemanticNodeVector {
    id: string;
    name: string;
    type: string;
    vector: number[];
    score?: number;
}

/**
 * MemorySystem 配置
 */
export interface MemorySystemConfig {
    /** 编码器配置 */
    encoder: EncoderConfig;
    /** 情景记忆配置（需要包含 dimension） */
    episodic: EpisodicConfig;
    /** LLM 配置（用于预处理） */
    llm: {
        apiKey: string;
        baseURL: string;
        model: string;
    };
    /** 语义记忆配置（可选） */
    semantic?: SynapseMemoryConfig;
}

export class MemorySystemError extends Error {
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
 * 当前 Interaction 的目标操作类型
 */
type InteractionDestinationAction =
    | "merge_and_join" // 合并事件后加入合并后的事件
    | "join_existing" // 直接加入某个现有事件
    | "create_new" // 创建新事件
    | "skip"; // 跳过，不存储（寒暄、无营养内容）

/**
 * 合并后的事件信息
 */
interface MergedEventInfo {
    eventIds: string[]; // 被合并的事件 ID 列表
    mergedTopic: string; // 合并后的事件主题
    mergedDescription: string; // 合并后的事件描述
    reason: string; // 合并理由
}

/**
 * 现有事件的信息
 */
interface ExistingEventInfo {
    eventId: string; // 事件 ID
    topic: string; // 事件主题
    description: string; // 事件描述
    reason: string; // 选择该事件的理由
}

/**
 * 新事件的信息
 */
interface NewEventInfo {
    topic: string; // 新事件主题
    description: string; // 新事件描述
    reason: string; // 创建新事件的理由
}

/**
 * 分析当前 Interaction 应该如何存储
 */
interface InteractionDestination {
    action: InteractionDestinationAction;
    mergedEventInfo?: MergedEventInfo; // merge_and_join 时使用
    existingEventInfo?: ExistingEventInfo; // join_existing 时使用
    newEventInfo?: NewEventInfo; // create_new 时使用
    reason?: string; // 决策理由
}

/**
 * 被选中事件的详情（用于展示）
 */
interface SelectedEventInfo {
    id: string;
    topic: string;
    description: string;
    interactionCount: number;
}

/**
 * 事件文本构建选项
 */
interface BuildEventsTextOptions {
    maxInteractions?: number; // 最大交互数，默认不限制
    useSummary?: boolean; // 是否使用 summary，默认 true
    showSkipped?: boolean; // 是否显示省略信息，默认 false
}

/**
 * chat 方法返回类型
 */
interface ChatResult {
    content: string;
    rewrittenQuery: string; // 改写后的用户问题
    entities: string[]; // 提取的实体/关键词
    eventId: string; // 最终存储的事件 ID
    history: Message[];
    destination: InteractionDestination; // 当前 Interaction 的目标
    selectedEvents: SelectedEventInfo[]; // 被选中的相关事件
}

/**
 * 待确认操作类型
 */
type ConfirmationActionType = "merge_and_join" | "custom";

/**
 * 待确认操作接口
 */
interface PendingConfirmation {
    type: ConfirmationActionType; // 确认操作类型
    action: string; // 操作描述（用于显示）
    data: Record<string, unknown>; // 操作相关数据
    destination?: InteractionDestination; // 关联的存储目标（用于 merge_and_join）
    selectedEvents?: { id: string; topic: string; description: string }[]; // 可选择的事件列表
}

/**
 * 用户确认结果
 */
interface ConfirmationResult {
    confirmed: boolean; // 用户是否确认
    action?: string; // 用户选择的操作
    data?: Record<string, unknown>; // 操作相关数据
}

export class MemorySystem {
    private episodic: EpisodicMemory;
    private semantic?: SemanticMemory;
    private encoder: Encoder;
    private extractor?: Extractor;
    private llm: OpenAI;
    private llmModel: string = "gpt-4o-mini";

    // 窗口边界相关
    private currentTopic: string | null = null;
    private windowBoundaryConfig: WindowBoundaryConfig = {
        topicChangeThreshold: 0.5,
        saveOnBoundary: true,
    };

    // LLM 降级相关
    private fallbackConfig: FallbackConfig = {
        boundaryRange: { min: 0.12, max: 0.3 },
        enabled: false,
    };

    constructor(config: MemorySystemConfig) {
        // 初始化编码器
        this.encoder = new Encoder(config.encoder);

        // 初始化情景记忆
        this.episodic = new EpisodicMemory(config.episodic);

        // 初始化 LLM（如果配置了）
        this.llm = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.llm.baseURL,
        });

        this.llmModel = config.llm.model || "gpt-4o-mini";

        // 初始化提取器
        this.extractor = new Extractor({
            apiKey: config.llm.apiKey,
            baseURL: config.llm.baseURL,
            model: config.llm.model || "gpt-4o-mini",
        });

        // 初始化语义记忆（可选）
        if (config.semantic) {
            this.semantic = new SemanticMemory(config.semantic);
        }
    }

    /**
     * 等待系统初始化完成
     */
    async ready(): Promise<void> {
        await this.episodic.ready();
    }

    // ============================================================================
    // ============================================================================
    // Query 改写方法
    // ============================================================================

    /**
     * 生成用户问题的摘要
     * @param userQuery 用户问题
     * @returns 摘要字符串
     */
    async summaryUserQuery(userQuery: string): Promise<string> {
        // 如果文本较短，直接返回
        if (userQuery.length <= 50) {
            return userQuery;
        }

        try {
            const prompt = `请为以下用户问题生成一个简短的摘要：

用户问题：${userQuery}

要求：
- 保留核心意图
- 直接返回摘要，不要解释`;

            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    { role: "system", content: "你是一个摘要生成专家。" },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            const summary = response.choices[0]?.message?.content?.trim();
            return summary || userQuery.slice(0, 50);
        } catch (error) {
            console.error("生成用户问题摘要失败:", error);
            return userQuery.slice(0, 50);
        }
    }

    /**
     * 生成助手回答的摘要
     * @param assistantResponse 助手回答
     * @returns 摘要字符串
     */
    async summaryAssistantResponse(assistantResponse: string): Promise<string> {
        // 如果文本较短，直接返回
        if (assistantResponse.length <= 50) {
            return assistantResponse;
        }

        try {
            const prompt = `请为以下助手回答生成一个简短的摘要：

助手回答：${assistantResponse}

要求：
- 保留核心信息和关键数据（如数值、复杂度符号 O(n) 等）
- 重要：必须包含具体的数字、符号、公式等
- 尽量精简，直接返回摘要，不要解释`;

            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    { role: "system", content: "你是一个摘要生成专家。" },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            console.log(
                "[summaryAssistantResponse] LLM响应:",
                JSON.stringify(response.choices[0]?.message),
            );
            const summary = response.choices[0]?.message?.content?.trim();
            console.log("[summaryAssistantResponse] 提取的summary:", summary);
            // 如果 LLM 返回有效摘要则使用，否则保留前100字符
            const result =
                summary && summary.length > 0
                    ? summary
                    : assistantResponse.slice(0, 100);
            console.log("[summaryAssistantResponse] 最终返回:", result);
            return result;
        } catch (error) {
            console.error("生成助手回答摘要失败:", error);
            return assistantResponse.slice(0, 100);
        }
    }

    /**
     * 使用 LLM 同时提取实体和时间窗口
     * @returns 实体列表和时间窗口信息
     */
    private async extractEntitiesAndTimeWindow(query: string): Promise<{
        entities: string[];
        timeWindow: {
            hours: number;
            label: string;
            startTime?: string;
            endTime?: string;
        } | null;
    }> {
        const prompt = `分析用户Query，提取实体和时间窗口信息。

    用户Query: ${query}

    请以JSON格式返回：
    {
      "entities": ["实体1", "实体2"],
      "timeWindow": {
        "hours": 2,
        "label": "最近2小时",
        "startTime": "2024-03-20T10:00:00Z",
        "endTime": "2024-03-20T12:00:00Z"
      }
    }

    注意：
    - timeWindow 用于筛选在特定时间范围内发生的事件
    - hours 是参考时间范围的小时数，用于向量检索时的阈值参考
    - startTime 和 endTime 是 ISO 格式的时间范围边界，用于精确过滤
    - 如果 Query 中有明确的时间点（如"10点"、"下午3点"），计算出具体的时间范围
    - 如果 Query 中有模糊时间（如"刚才"、"不久"），hours 设为较小值（如 1-2 小时）
    - 如果 Query 中没有明确时间，timeWindow 设为 null
    - 实体是从Query中提取的关键名词，如人名、地名、物体、技术名词等
    - 返回的 startTime 和 endTime 应该基于"现在"（${new Date().toISOString()}）来计算`;

        // 调试: 打印 LLM Prompt
        console.log("\n========== [LLM Prompt] 提取实体和时间窗口 ==========");
        console.log("【System】你是一个信息提取专家。");
        console.log("【User】");
        console.log(prompt);
        console.log("================================================\n");

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    {
                        role: "system",
                        content:
                            "你是一个信息提取专家，擅长从文本中提取实体和时间信息。",
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                return { entities: [], timeWindow: null };
            }

            // 调试: 打印 LLM 响应
            console.log("【LLM Response】");
            console.log(content);
            console.log("================================================\n");

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { entities: [], timeWindow: null };
            }

            const result = JSON.parse(jsonMatch[0]);
            return {
                entities: result.entities || [],
                timeWindow: result.timeWindow || null,
            };
        } catch (error) {
            console.error("LLM 提取失败:", error);
            throw new Error("LLM 提取失败");
        }
    }

    /**
     * 使用 LLM 判断 Query 类型
     * @param query 用户查询
     * @returns Query 类型
     */
    private async classifyQueryType(query: string): Promise<QueryType> {
        const prompt = `分析用户Query，判断其类型。

用户Query: ${query}

Query类型定义：
- knowledge: 知识问答类，用户在询问具体的知识、概念、原理、定义等。如"什么是快速排序？"、"Python的装饰器是什么？"、"如何实现二分查找？"
- chat: 闲聊类，用户在进行普通的对话、情感交流、问候等。如"你好"、"今天天气不错"、"谢谢你的帮助"
- summary: 总结请求类，用户要求对已有内容进行总结、归纳。如"请总结一下刚才学的内容"、"给我讲讲这个算法的要点"
- unknown: 无法归类的查询

请以JSON格式返回：
{
  "queryType": "knowledge" | "chat" | "summary" | "unknown",
  "reason": "判断理由"
}`;

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    {
                        role: "system",
                        content:
                            "你是一个Query分类专家，擅长判断用户查询的类型。",
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                return "unknown";
            }

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return "unknown";
            }

            const result = JSON.parse(jsonMatch[0]);
            const queryType = result.queryType as QueryType;
            return ["knowledge", "chat", "summary", "unknown"].includes(
                queryType,
            )
                ? queryType
                : "unknown";
        } catch (error) {
            console.error("Query类型分类失败:", error);
            return "unknown";
        }
    }

    /**
     * 获取不同Query类型对应的阈值配置
     * @param queryType Query类型
     * @returns 阈值配置
     */
    private getThresholdsForQueryType(queryType: QueryType): {
        eventRelevanceThreshold: number; // 事件相关度阈值 (0-1)
        interactionRelevanceThreshold: number; // Interaction相关度阈值 (0-1)
        maxEvents: number; // 最大事件数
        maxInteractionsPerEvent: number; // 每个事件最大Interactions数
        contextWindowSize: number; // 上下文窗口大小
    } {
        switch (queryType) {
            case "knowledge":
                // 知识问答：严格筛选，高相关度
                return {
                    eventRelevanceThreshold: 0.6,
                    interactionRelevanceThreshold: 0.5,
                    maxEvents: 3,
                    maxInteractionsPerEvent: 3,
                    contextWindowSize: 2,
                };
            case "chat":
                // 闲聊：宽松筛选
                return {
                    eventRelevanceThreshold: 0.3,
                    interactionRelevanceThreshold: 0.2,
                    maxEvents: 5,
                    maxInteractionsPerEvent: 5,
                    contextWindowSize: 3,
                };
            case "summary":
                // 总结：中等筛选
                return {
                    eventRelevanceThreshold: 0.4,
                    interactionRelevanceThreshold: 0.3,
                    maxEvents: 3,
                    maxInteractionsPerEvent: 5,
                    contextWindowSize: 3,
                };
            default:
                // unknown：使用默认值
                return {
                    eventRelevanceThreshold: 0.5,
                    interactionRelevanceThreshold: 0.4,
                    maxEvents: 3,
                    maxInteractionsPerEvent: 3,
                    contextWindowSize: 1,
                };
        }
    }

    /**
     * 从用户问题生成主题
     * @param query 用户问题
     * @returns 生成的主题（不超过20字）
     */
    private generateTopicFromQuery(query: string): string {
        // 移除常见的寒暄和问题前缀
        const cleaned = query
            .replace(
                /^(我想|我想问一下|请问|我想知道|帮我|我想了解|我想学习|我想请教)/,
                "",
            )
            .replace(/[？?。.！!]$/, "")
            .trim();

        // 取前20个字符作为主题
        const topic = cleaned.substring(0, 20);

        // 如果太短，使用默认主题
        return topic.length >= 2 ? topic : "新会话";
    }

    /**
     * 根据所有交互时间判断跨年/跨天标志
     * @param allTimes 所有交互时间的数组
     * @returns 包含 hasCrossYear 和 hasCrossDay 的对象
     */
    private getTimeFlags(allTimes: Date[]): {
        hasCrossYear: boolean;
        hasCrossDay: boolean;
    } {
        if (allTimes.length === 0) {
            return { hasCrossYear: false, hasCrossDay: false };
        }
        const first = allTimes[0]!;
        const firstYear = first.getFullYear();
        const firstDate = first.toDateString();
        let hasCrossYear = false;
        let hasCrossDay = false;
        for (const t of allTimes) {
            if (t.getFullYear() !== firstYear) {
                hasCrossYear = true;
                hasCrossDay = true;
                break;
            }
            if (t.toDateString() !== firstDate) {
                hasCrossDay = true;
            }
        }
        return { hasCrossYear, hasCrossDay };
    }

    /**
     * 格式化时间
     */
    private formatTime(
        d: Date,
        hasCrossYear: boolean,
        hasCrossDay: boolean,
    ): string {
        const pad = (n: number) => String(n).padStart(2, "0");
        if (hasCrossYear) {
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else if (hasCrossDay) {
            return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } else {
            return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
    }

    /**
     * 统一构建事件文本
     */
    private async buildEventsText<
        T extends {
            topic: string;
            description: string;
            entities: string[];
            createdAt: string | Date;
            updatedAt: string | Date;
            interactions: Array<{
                createdAt: string | Date;
                messageIds: string[];
                interactionIndex?: number;
            }>;
        },
    >(
        events: T[],
        hasCrossYear: boolean,
        hasCrossDay: boolean,
        options: BuildEventsTextOptions = {},
    ): Promise<string> {
        const {
            maxInteractions,
            useSummary = true,
            showSkipped = false,
        } = options;

        const formatEventTime = (d: Date): string => {
            return this.formatTime(d, hasCrossYear, hasCrossDay);
        };

        const eventParts = await Promise.all(
            events.map(async (e, idx) => {
                const createdAt = new Date(e.createdAt);
                const updatedAt = new Date(e.updatedAt);

                // 应用最大交互数限制
                const limitedInteractions =
                    maxInteractions !== undefined
                        ? e.interactions.slice(0, maxInteractions)
                        : e.interactions;

                const interactionParts: string[] = [];
                for (
                    let intIdx = 0;
                    intIdx < limitedInteractions.length;
                    intIdx++
                ) {
                    const ir = limitedInteractions[intIdx]!;

                    // 计算省略
                    if (
                        showSkipped &&
                        intIdx > 0 &&
                        ir.interactionIndex !== undefined
                    ) {
                        const prevIr = limitedInteractions[intIdx - 1]!;
                        const prevIndex = prevIr.interactionIndex ?? 0;
                        const skippedCount =
                            ir.interactionIndex - prevIndex - 1;
                        if (skippedCount > 0) {
                            interactionParts.push(
                                `...省略${skippedCount}条...`,
                            );
                        }
                    }

                    // 获取消息列表
                    const messages = await this.episodic.getMessagesByIds(
                        ir.messageIds,
                    );
                    const userMessage = messages.find((m) => m.role === "user");
                    const assistantMessage = messages.find(
                        (m) => m.role === "assistant",
                    );

                    const userText = userMessage
                        ? useSummary
                            ? userMessage.summary || userMessage.content
                            : userMessage.content
                        : "";
                    const assistantText = assistantMessage
                        ? useSummary
                            ? assistantMessage.summary ||
                              assistantMessage.content
                            : assistantMessage.content
                        : "";

                    const timeStr = formatEventTime(new Date(ir.createdAt));
                    interactionParts.push(
                        `[${timeStr}]\n  用户: ${userText}\n  助手: ${assistantText}`,
                    );
                }

                return `【事件 #${idx + 1}】
主题: ${e.topic}
实体: ${e.entities.join(", ")}
描述: ${e.description}
创建: ${formatEventTime(createdAt)}
更新: ${formatEventTime(updatedAt)}

${interactionParts.join("\n\n")}`;
            }),
        );

        return eventParts.join("\n\n===\n\n");
    }

    /**
     * 选择多个相关事件
     * @param query 用户问题
     * @param events 候选事件列表（带有 Interaction 列表的事件）
     * @returns 选择的事件索引列表和原因，以及是否存在相关事件
     */
    private async selectRelevantEvents(
        query: string,
        events: (Event & { interactions: Interaction[] })[],
    ): Promise<{
        indices: number[];
        reasons: string[];
        hasRelevantEvents: boolean;
    } | null> {
        if (events.length === 0) {
            return null;
        }

        // 按更新时间降序排序，让最近更新的事件排在前面
        const sortedEvents = [...events].sort(
            (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
        );

        // 构建排序后的索引到原始索引的映射
        const sortedIndexToOriginalIndex = sortedEvents.map((sortedEvent) =>
            events.findIndex((e) => e.id === sortedEvent.id),
        );

        // 构建事件信息文本（使用排序后的列表）
        // 判断所有交互是否跨年/跨天
        const allTimes: Date[] = [];
        for (const e of sortedEvents) {
            for (const int of e.interactions) {
                allTimes.push(new Date(int.createdAt));
            }
        }
        const { hasCrossYear, hasCrossDay } = this.getTimeFlags(allTimes);

        // 每个事件最多显示 3 条交互
        const eventsWithLimitedInteractions = sortedEvents.map((e) => ({
            ...e,
            interactions: e.interactions.slice(0, 3),
        }));
        const eventsText = this.buildEventsText(
            eventsWithLimitedInteractions,
            hasCrossYear,
            hasCrossDay,
            { useSummary: true, showSkipped: false },
        );

        const now = new Date().toLocaleString("zh-CN");
        const prompt = `当前时间: ${now}
用户问题: ${query}

候选事件列表（已按更新时间降序排列）：
${eventsText}

【相关性判断标准】
1. 主题相关：事件主题与用户问题讨论的内容是否相关
2. 实体匹配：事件中的实体（人名、地名、技术名词等）是否在问题中出现
3. 历史参考：事件的交互历史是否能帮助回答当前问题
4. 时间关联：当问题涉及时间时（如"刚才"、"上次"、"上一个知识点"），适当参考事件的新旧程度

【时间问题处理】
- 如果问题包含 "刚才"、"刚才问了"、"上一个"、"上次"、"最近学的" 等时间相关词汇
- 优先选择相对时间标注为"刚刚"或"X分钟前"的事件
- 但仍需保证语义上的基本相关性

【分析要求】
- 仔细分析每个事件与问题的关联程度
- 优先选择语义相关的事件，其次参考时间因素
- 如果没有任何事件与问题相关，必须返回空数组
- 如果有相关事件，选择最多 3 个最相关的事件
- 不得强制选择事件，无相关事件时必须返回空数组

请以JSON格式返回：
{
  "hasRelevantEvents": true或false,
  "indices": [0, 2, 3],
  "reasons": ["事件0与问题相关，因为...", "事件2与问题相关，因为...", "事件3与问题相关，因为..."]
}

注意：
- hasRelevantEvents 表示是否存在相关事件（必须明确判断）
- indices 是选择的事件编号（从0开始），如果无相关事件则为空数组 []
- reasons 是每个选择对应的理由，无相关事件时 reasons 也为空数组 []
- 如果所有事件都不相关，hasRelevantEvents 必须为 false，indices 必须为 []`;

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    {
                        role: "system",
                        content:
                            "你是一个事件选择专家，擅长分析用户意图并选择最相关的事件。",
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            const content = response.choices[0]?.message?.content;
            const jsonMatch = content?.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                const hasRelevantEvents = result.hasRelevantEvents === true;
                const indices = (result.indices as number[]) || [];
                const reasons = (result.reasons as string[]) || [];

                // 如果没有相关事件，返回空结果
                if (!hasRelevantEvents || indices.length === 0) {
                    return {
                        indices: [],
                        reasons: [],
                        hasRelevantEvents: false,
                    };
                }

                // 验证索引有效性（基于 sortedEvents 的索引）
                const validSortedIndices = indices
                    .filter((idx) => idx >= 0 && idx < sortedEvents.length)
                    .slice(0, 3); // 最多 3 个

                if (validSortedIndices.length > 0) {
                    // 将 sortedEvents 的索引转换为原始 events 的索引
                    const originalIndices = validSortedIndices
                        .map(
                            (sortedIdx) =>
                                sortedIndexToOriginalIndex[sortedIdx],
                        )
                        .filter((idx): idx is number => idx !== undefined);

                    return {
                        indices: originalIndices,
                        reasons:
                            reasons?.slice(0, validSortedIndices.length) ||
                            validSortedIndices.map(() => ""),
                        hasRelevantEvents: true,
                    };
                }
            }

            // 解析失败，返回无相关事件
            console.warn("[selectRelevantEvents] 解析失败，返回无相关事件");
            return { indices: [], reasons: [], hasRelevantEvents: false };
        } catch (error) {
            console.error("[selectRelevantEvents] 选择失败:", error);
            return { indices: [], reasons: [], hasRelevantEvents: false };
        }
    }

    /**
     * 使用 LLM 对选中的事件进行 Interactions 精筛选
     * 在 selectRelevantEvents 之后调用，对每个选中事件中的 interactions 进行相关性评分和排序
     *
     * @param query 用户查询
     * @param selectedEvents selectRelevantEvents 选出的相关事件
     * @param queryType Query类型
     * @returns 带评分的 events 和 interactions
     */
    private async selectRelevantInteractions(
        query: string,
        selectedEvents: (Event & { interactions: Interaction[] })[],
        queryType: QueryType,
    ): Promise<EventWithScoredInteractions[]> {
        if (selectedEvents.length === 0) {
            return [];
        }

        const thresholds = this.getThresholdsForQueryType(queryType);
        const {
            interactionRelevanceThreshold,
            maxInteractionsPerEvent,
            contextWindowSize,
        } = thresholds;

        // 构建每个事件的 interactions 文本
        // 判断所有交互是否跨年/跨天
        const allTimes: Date[] = [];
        for (const e of selectedEvents) {
            for (const int of e.interactions) {
                allTimes.push(new Date(int.createdAt));
            }
        }
        const { hasCrossYear, hasCrossDay } = this.getTimeFlags(allTimes);

        const eventsText = this.buildEventsText(
            selectedEvents,
            hasCrossYear,
            hasCrossDay,
            { useSummary: false, showSkipped: false },
        );

        const prompt = `【任务】
分析用户Query与每个Event中的Interactions的相关性，进行精筛选和排序。

【用户Query】
${query}

【候选事件及其Interactions】
${eventsText}

【相关性判断标准】
1. 内容相关：Interaction讨论的内容与用户Query是否相关
2. 实体匹配：Interaction中提到的实体是否在Query中出现
3. 上下文价值：Interaction是否能帮助回答当前Query
4. 互补信息：Interaction是否能提供Query所需的相关背景知识

【评分要求】
- relevanceScore: 0-1 的浮点数，1表示高度相关
- reason: 一句话说明为什么这个Interaction相关/不相关

【筛选要求】
- relevanceScore >= ${interactionRelevanceThreshold} 的Interaction才保留
- 每个事件最多保留 ${maxInteractionsPerEvent} 个Interaction
- 按 relevanceScore 降序排列

【返回格式 - JSON】
{
  "events": [
    {
      "eventIndex": 0,
      "interactions": [
        {
          "interactionIndex": 0,
          "relevanceScore": 0.85,
          "reason": "讨论的主题与Query完全相关"
        },
        {
          "interactionIndex": 2,
          "relevanceScore": 0.60,
          "reason": "提供了相关背景知识"
        }
      ]
    },
    {
      "eventIndex": 1,
      "interactions": [...]
    }
  ]
}

注意：
- 只返回高相关的Interactions，relevanceScore低于阈值的不返回
- eventIndex 和 interactionIndex 都是原始索引
- 如果某个事件的所有Interaction都被过滤掉，该事件的interactions数组为空数组`;

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    {
                        role: "system",
                        content:
                            "你是一个信息筛选专家，擅长判断内容相关性并进行筛选排序。",
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                // 解析失败，返回原始事件但 interactions 为空
                return selectedEvents.map((e) => ({
                    event: e,
                    interactions: [],
                    eventRelevanceScore: 0.5,
                }));
            }

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return selectedEvents.map((e) => ({
                    event: e,
                    interactions: [],
                    eventRelevanceScore: 0.5,
                }));
            }

            const result = JSON.parse(jsonMatch[0]);

            // 构建返回结果
            const scoredEvents: EventWithScoredInteractions[] = [];

            for (const eventResult of result.events || []) {
                const eventIndex = eventResult.eventIndex as number;
                if (eventIndex < 0 || eventIndex >= selectedEvents.length) {
                    continue;
                }

                const originalEvent = selectedEvents[eventIndex]!;
                const scoredInteractions: InteractionWithRelevance[] = [];

                for (const intResult of eventResult.interactions || []) {
                    const intIndex = intResult.interactionIndex as number;
                    const relevanceScore = intResult.relevanceScore as number;

                    if (
                        intIndex < 0 ||
                        intIndex >= originalEvent.interactions.length
                    ) {
                        continue;
                    }

                    const originalInteraction =
                        originalEvent.interactions[intIndex];
                    if (!originalInteraction) {
                        continue;
                    }

                    // 过滤低于阈值的
                    if (relevanceScore < interactionRelevanceThreshold) {
                        continue;
                    }

                    scoredInteractions.push({
                        interaction: originalInteraction,
                        relevanceScore,
                        reason: (intResult.reason as string) || "",
                        interactionIndex: intIndex,
                    });
                }

                // 按 interactionIndex 升序排序（保持时间顺序）
                scoredInteractions.sort(
                    (a, b) => a.interactionIndex - b.interactionIndex,
                );

                // 限制数量
                const limitedInteractions = scoredInteractions.slice(
                    0,
                    maxInteractionsPerEvent,
                );

                // 计算事件整体相关度（取 interactions 的平均分）
                const eventRelevanceScore =
                    limitedInteractions.length > 0
                        ? limitedInteractions.reduce(
                              (sum, i) => sum + i.relevanceScore,
                              0,
                          ) / limitedInteractions.length
                        : 0;

                scoredEvents.push({
                    event: originalEvent,
                    interactions: limitedInteractions,
                    eventRelevanceScore,
                });
            }

            // 按事件整体相关度降序排序
            scoredEvents.sort(
                (a, b) => b.eventRelevanceScore - a.eventRelevanceScore,
            );

            console.log(
                `[selectRelevantInteractions] 筛选后保留了 ${scoredEvents.length} 个事件`,
            );
            for (const se of scoredEvents) {
                console.log(
                    `  事件: ${se.event.topic}, 相关度: ${se.eventRelevanceScore.toFixed(2)}, Interactions: ${se.interactions.length}`,
                );
            }

            return scoredEvents;
        } catch (error) {
            console.error("[selectRelevantInteractions] 筛选失败:", error);
            // 出错时返回原始事件但 interactions 为空
            return selectedEvents.map((e) => ({
                event: e,
                interactions: [],
                eventRelevanceScore: 0.5,
            }));
        }
    }

    /**
     * 分析当前 Interaction 应该加入哪个事件
     *
     * 决策逻辑：
     * 1. 如果多个事件可以合并后产生更好的可加入事件，则合并后加入
     * 2. 如果有现有事件可以让当前 Interaction 加入，则直接加入
     * 3. 如果当前 Interaction 与所有事件都无关，则创建新事件
     *
     * @param events selectRelevantEvents 选出的相关事件列表
     * @param query 用户当前问题
     * @param responseContent LLM 生成的回答内容
     * @returns 分析结果：决定合并后加入、加入现有事件、或创建新事件
     */
    async analyzeInteractionDestination(
        events: (Event & { interactions: Interaction[] })[],
        query: string,
        responseContent: string,
    ): Promise<InteractionDestination> {
        // 构建事件上下文文本
        // 判断所有交互是否跨年/跨天
        const allTimes: Date[] = [];
        for (const e of events) {
            for (const int of e.interactions) {
                allTimes.push(new Date(int.createdAt));
            }
        }
        const { hasCrossYear, hasCrossDay } = this.getTimeFlags(allTimes);

        // 每个事件最多显示 3 条交互
        const eventsWithLimitedInteractions = events.map((e) => ({
            ...e,
            interactions: e.interactions.slice(0, 3),
        }));
        const eventsText = this.buildEventsText(
            eventsWithLimitedInteractions,
            hasCrossYear,
            hasCrossDay,
            { useSummary: true, showSkipped: false },
        );

        const prompt = `【任务】
分析当前用户问题与 AI 回答，判断这个新的交互（Interaction）应该加入哪个事件。

【当前用户问题】
${query}

【AI 回答内容】
${responseContent}

【候选事件列表（由 selectRelevantEvents 选出）】
${eventsText}

【决策要求】
请仔细分析：

1. **是否可以合并后加入？**
   - 这些事件是否可以合并成一个更有意义的事件？
   - 合并后的事件是否能更好地容纳当前 Interaction？
   - 合并后主题是否仍然清晰？

2. **是否可以直接加入某个现有事件？**
   - 当前 Interaction 是否与某个现有事件主题相关？
   - 加入哪个事件最合适？

3. **是否需要创建新事件？**
   - 当前 Interaction 是否与所有现有事件都无关？
   - 是否开启了一个全新的主题？

【返回格式 - JSON】
{
  "action": "merge_and_join" | "join_existing" | "create_new",
  "reason": "决策理由（详细说明为什么选择这个 action）",

  // 当 action = "merge_and_join" 时
  "mergedEventInfo": {
    "indices": [0, 2],
    "mergedTopic": "合并后的主题（不超过20字）",
    "mergedDescription": "合并后的描述（不超过100字）"
  },

  // 当 action = "join_existing" 时
  "existingEventInfo": {
    "index": 1,
    "reason": "为什么加入这个事件而不是其他事件"
  },

  // 当 action = "create_new" 时
  "newEventInfo": {
    "topic": "新事件主题（不超过20字）",
    "description": "新事件描述（不超过100字）"
  }
}

【注意事项】
- indices/index 使用事件编号（从0开始）
- 优先判断是否可以合并（合并能带来更好的组织结构）
- 只有当合并后没有更好效果且有明确可加入的事件时才选择 join_existing
- 只有当与所有事件都无关时才选择 create_new
- action 必须与返回的字段对应（如 action="merge_and_join" 时必须有 mergedEventInfo）
- **【重要】create_new 时，newEventInfo.topic 绝对不能为空，必须基于用户问题生成一个简洁的主题（不超过20字）**
- **【重要】如果无法判断主题，使用用户问题的关键词作为 topic**`;

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    {
                        role: "system",
                        content:
                            "你是一个事件决策专家，擅长判断交互应该加入哪个事件。",
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
            });

            const content = response.choices[0]?.message?.content;
            console.log(
                "[analyzeInteractionDestination] LLM原始返回:",
                content,
            );
            const jsonMatch = content?.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error(
                    "[analyzeInteractionDestination] LLM 返回非 JSON 格式",
                );
                // 默认创建新事件
                return {
                    action: "create_new",
                    reason: "LLM 返回格式错误，默认创建新事件",
                    newEventInfo: {
                        topic: "新会话",
                        description: query.substring(0, 100),
                        reason: "LLM 返回格式错误，默认创建新事件",
                    },
                };
            }

            const result = JSON.parse(jsonMatch[0]);
            const action = result.action as InteractionDestinationAction;
            const reason = result.reason || "未提供决策理由";

            if (action === "merge_and_join") {
                const indices = result.mergedEventInfo?.indices || [];
                const validIndices = indices.filter(
                    (idx: number) => idx >= 0 && idx < events.length,
                );
                const eventIds = validIndices
                    .map((idx: number) => events[idx]?.id)
                    .filter(Boolean);

                if (eventIds.length < 2) {
                    // 无法合并，返回加入现有事件
                    const firstEvent = events[0];
                    return {
                        action: "join_existing",
                        reason: reason || "合并事件数量不足，加入第一个事件",
                        existingEventInfo: firstEvent
                            ? {
                                  eventId: firstEvent.id,
                                  topic: firstEvent.topic,
                                  description: firstEvent.description,
                                  reason:
                                      reason ||
                                      "合并事件数量不足，加入第一个事件",
                              }
                            : undefined,
                    };
                }

                return {
                    action: "merge_and_join",
                    reason,
                    mergedEventInfo: {
                        eventIds,
                        mergedTopic:
                            result.mergedEventInfo?.mergedTopic || "合并事件",
                        mergedDescription:
                            result.mergedEventInfo?.mergedDescription ||
                            query.substring(0, 100),
                        reason: reason || "LLM 决定合并后加入",
                    },
                };
            } else if (action === "join_existing") {
                const index = result.existingEventInfo?.index ?? 0;
                const targetEvent = events[index] || events[0];
                if (!targetEvent) {
                    return {
                        action: "create_new",
                        reason: "没有可用的事件，创建新事件",
                        newEventInfo: {
                            topic: "新会话",
                            description: query.substring(0, 100),
                            reason: "没有可用的事件，创建新事件",
                        },
                    };
                }

                return {
                    action: "join_existing",
                    reason,
                    existingEventInfo: {
                        eventId: targetEvent.id,
                        topic: targetEvent.topic,
                        description: targetEvent.description,
                        reason,
                    },
                };
            } else {
                // create_new
                // 生成有效的 topic：优先使用 LLM 返回的，否则使用 query 关键词
                const llmTopic = result.newEventInfo?.topic;
                const generatedTopic =
                    llmTopic && llmTopic.trim().length > 0
                        ? llmTopic
                        : this.generateTopicFromQuery(query);

                return {
                    action: "create_new",
                    reason,
                    newEventInfo: {
                        topic: generatedTopic,
                        description:
                            result.newEventInfo?.description ||
                            query.substring(0, 100),
                        reason: reason || "LLM 决定创建新事件",
                    },
                };
            }
        } catch (error) {
            console.error("[analyzeInteractionDestination] 分析失败:", error);
            return {
                action: "create_new",
                reason: `分析失败: ${error}，默认创建新事件`,
                newEventInfo: {
                    topic: "新会话",
                    description: query.substring(0, 100),
                    reason: `分析失败: ${error}，默认创建新事件`,
                },
            };
        }
    }

    /**
     * 执行合并操作
     * @param mergedEventInfo 要合并的事件信息
     * @param selectedEvents 所有被选中的事件（用于获取 interactions）
     * @returns 合并后创建的新事件 ID
     */
    private async executeMerge(
        mergedEventInfo: {
            eventIds: string[];
            mergedTopic: string;
            mergedDescription: string;
        },
        selectedEvents: (Event & { interactions: Interaction[] })[],
    ): Promise<string> {
        console.log(
            `[executeMerge] 将合并事件: ${mergedEventInfo.eventIds.join(", ")}`,
        );

        // 获取被合并事件的所有 interactions
        const eventsToMerge = selectedEvents.filter((e) =>
            mergedEventInfo.eventIds.includes(e.id),
        );

        const allInteractions: Interaction[] = eventsToMerge.flatMap(
            (e) => e.interactions,
        );
        const allEntities = [
            ...new Set(eventsToMerge.flatMap((e) => e.entities)),
        ];

        // 按时间排序 interactions
        allInteractions.sort(
            (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
        );

        // 创建新事件
        const newEventVector = await this.encoder.encode(
            mergedEventInfo.mergedDescription,
        );
        const newEventId = await this.episodic.addEvent(
            mergedEventInfo.mergedTopic,
            mergedEventInfo.mergedDescription,
            allEntities,
            newEventVector,
        );

        console.log(
            `[executeMerge] 创建合并事件 id: ${newEventId}, 包含 ${allInteractions.length} 条交互`,
        );

        // 使用 transferInteractions 转移所有 interactions（保留原有 createdAt）
        // 先获取每个 interaction 的向量
        const interactionVectors: number[][] = [];
        for (const interaction of allInteractions) {
            // 获取原始 interaction 的向量（这里需要从 Qdrant 获取）
            const rawInteraction = await this.episodic.getInteractionById(
                interaction.id,
            );
            if (rawInteraction) {
                interactionVectors.push(rawInteraction.vector);
            } else {
                // 如果获取不到，使用 messageIds 获取消息内容重新编码
                const messages = await this.episodic.getMessagesByIds(
                    interaction.messageIds,
                );
                const userMsg = messages.find((m) => m.role === "user");
                const assistantMsg = messages.find(
                    (m) => m.role === "assistant",
                );
                const content = `${userMsg?.content || ""} ${assistantMsg?.content || ""}`;
                interactionVectors.push(await this.encoder.encode(content));
            }
        }

        // 批量转移 interactions（保留 createdAt）
        await this.episodic.transferInteractions(
            mergedEventInfo.eventIds,
            newEventId,
            interactionVectors,
        );

        // 删除被合并的旧事件及其 interactions
        for (const oldId of mergedEventInfo.eventIds) {
            try {
                // 先删除旧事件的所有 interactions
                const oldInteractions =
                    await this.episodic.getInteractionsByEventId(oldId, 1000);
                for (const interaction of oldInteractions) {
                    try {
                        await this.episodic.deleteInteraction(interaction.id);
                    } catch {
                        console.warn(
                            `[executeMerge] 删除旧交互失败: ${interaction.id}`,
                        );
                    }
                }

                // 删除旧事件
                await this.episodic.deleteEvent(oldId);
                console.log(`[executeMerge] 删除旧事件 id: ${oldId}`);
            } catch {
                console.warn(`[executeMerge] 删除旧事件失败: ${oldId}`);
            }
        }

        console.log(`[executeMerge] 合并完成`);
        return newEventId;
    }

    // ============================================================================
    // LLM 回答方法
    // ============================================================================

    /**
     * 生成回答
     * @param query 用户问题
     * @param context 事件上下文
     * @param history 对话历史（会直接放入 messages 数组）
     */
    async generateResponse(
        query: string,
        contextText: string,
        history: Message[] = [],
    ): Promise<GenerateResponseResult> {
        // 构建 messages 数组：system + history + 当前用户问题
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            {
                role: "system",
                content: "你是一个智能助手，擅长根据上下文回答问题。",
            },
            ...history.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
            })),
            {
                role: "user",
                content: `当前时间: ${new Date().toLocaleString("zh-CN")}

【事件上下文】
${contextText}

【用户问题】
${query}

【回答要求】
1. 仔细阅读用户问题，只回答与问题直接相关的内容
2. 不要扩展或补充与问题不直接相关的其他知识点
3. 回答简洁明了

【输出格式】
请以JSON格式返回：
{
  "content": "回答内容",
  "hit": true或false，表示回答是否使用了上下文信息,
  "usedContext": ["使用的上下文描述"]
}`,
            },
        ];

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages,
                temperature: 0.7,
            });

            const rawContent = response.choices[0]?.message?.content || "";

            // 解析 JSON 响应
            const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("LLM 没有返回 JSON 格式");
            }

            const result = JSON.parse(jsonMatch[0]);
            return {
                content: result.content || rawContent,
                hit: result.hit ?? false,
                usedContext: Array.isArray(result.usedContext)
                    ? result.usedContext
                    : [],
                confidence: 0,
            };
        } catch (error) {
            throw new MemorySystemError(
                `生成回答失败: ${error instanceof Error ? error.message : "未知错误"}`,
                "GENERATE_RESPONSE_FAILED",
            );
        }
    }

    // ============================================================================
    // 辅助方法
    // ============================================================================

    // ============================================================================
    // 窗口边界处理
    // ============================================================================

    /**
     * 检测是否需要触发窗口边界
     */
    async detectWindowBoundary(
        query: string,
    ): Promise<{
        topicChanged: boolean;
        oldTopic?: string;
        newTopic?: string;
    }> {
        // 分析当前查询的话题
        const newTopic = await this.analyzeTopic(query);

        // 如果没有当前话题，或话题相似度高于阈值，不触发边界
        if (!this.currentTopic || this.isSimilarTopic(newTopic, this.currentTopic)) {
            return { topicChanged: false };
        }

        return {
            topicChanged: true,
            oldTopic: this.currentTopic,
            newTopic,
        };
    }

    /**
     * 分析查询的话题
     */
    private async analyzeTopic(query: string): Promise<string> {
        // 简单实现：取前3个实体作为话题标识
        const { entities } = await this.extractEntitiesAndTimeWindow(query);
        if (entities.length === 0) {
            return query.slice(0, 30);
        }
        return entities.slice(0, 3).join("_");
    }

    /**
     * 判断两个话题是否相似
     */
    private isSimilarTopic(topic1: string, topic2: string): boolean {
        // 如果完全相同，认为相似
        if (topic1 === topic2) return true;

        // 如果有交集，认为相似
        const words1 = new Set(topic1.split("_"));
        const words2 = new Set(topic2.split("_"));
        const intersection = new Set([...words1].filter((x) => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        const similarity = intersection.size / union.size;
        return similarity > this.windowBoundaryConfig.topicChangeThreshold;
    }

    /**
     * 执行窗口边界处理
     */
    async onWindowBoundary(
        oldTopic: string,
        newTopic: string,
    ): Promise<void> {
        // 1. 保存当前窗口的关键状态到情景记忆
        if (this.windowBoundaryConfig.saveOnBoundary) {
            await this.saveWindowContext(oldTopic);
        }

        // 2. 重置激活状态
        await this.resetActivation();

        // 3. 更新当前话题
        this.currentTopic = newTopic;

        console.log(`[窗口边界] ${oldTopic} -> ${newTopic}`);
    }

    /**
     * 保存窗口上下文到情景记忆
     */
    private async saveWindowContext(topic: string): Promise<void> {
        if (!this.semantic) return;

        // 获取当前高激活节点
        const highActivationNodes = await this.semantic.getHighActivationNodes(0.5);

        // 创建事件记录窗口状态（使用零向量作为占位）
        const zeroVector = new Array(this.encoder.getDimension()).fill(0);
        const eventId = await this.episodic.addEvent(
            `窗口边界: ${topic}`,
            `保存窗口上下文，高激活节点数: ${highActivationNodes.length}`,
            ["window_boundary", topic],
            zeroVector,
        );

        // 将高激活节点信息作为消息存储
        const contextSummary = highActivationNodes
            .map((n) => `${n.nodeType}:${n.nodeId}@${n.activation}`)
            .join("; ");
        const summaryVector = await this.encoder.encode(contextSummary);
        await this.episodic.addMessage(
            eventId,
            "boundary_context",
            "assistant",
            contextSummary,
            summaryVector,
            "",
            [],
            0,
        );
    }

    /**
     * 重置激活状态
     */
    private async resetActivation(): Promise<void> {
        if (this.semantic) {
            await this.semantic.resetActivationValues();
        }
    }

    /**
     * 获取当前话题
     */
    getCurrentTopic(): string | null {
        return this.currentTopic;
    }

    /**
     * 设置窗口边界配置
     */
    setWindowBoundaryConfig(config: Partial<WindowBoundaryConfig>): void {
        this.windowBoundaryConfig = { ...this.windowBoundaryConfig, ...config };
    }

    // ============================================================================
    // LLM 降级路径
    // ============================================================================

    /**
     * 评估是否需要 LLM 降级
     */
    private shouldUseLLMFallback(
        candidates: EventWithScoredInteractions[],
        threshold: number,
    ): boolean {
        if (!this.fallbackConfig.enabled) return false;
        if (candidates.length === 0) return false;

        // 检查是否有候选处于边界区间
        const boundaryCandidates = candidates.filter(
            (c) =>
                c.eventRelevanceScore > threshold &&
                c.eventRelevanceScore < threshold * 1.5,
        );

        // 如果边界区间的候选超过一定数量，使用 LLM 验证
        return boundaryCandidates.length > 2;
    }

    /**
     * LLM 降级筛选
     */
    private async llmFallbackSelect(
        query: string,
        candidates: { event: { id: string; topic: string; description: string } }[],
    ): Promise<string[]> {
        const prompt = `给定查询，从以下候选事件中选择最相关的 3 个。

查询: ${query}

候选事件:
${candidates.map((c, i) => `${i + 1}. ${c.event.topic} - ${c.event.description}`).join("\n")}

要求：
- 选择与查询最相关的事件
- 返回最多 3 个事件序号，按相关性排序
- 只返回序号，用逗号分隔，如: 1,3,5`;

        try {
            const response = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
            });

            const content = response.choices[0]?.message?.content?.trim() || "";

            // 解析 LLM 响应，提取序号
            const indices = content
                .split(/[,\s]+/)
                .map((s) => parseInt(s.trim(), 10) - 1)
                .filter((n) => !isNaN(n) && n >= 0 && n < candidates.length);

            return indices
                .map((i) => candidates[i]?.event.id)
                .filter((id): id is string => id !== undefined);
        } catch (error) {
            console.error("[LLM 降级] 调用失败:", error);
            // 降级失败时返回前3个
            return candidates.slice(0, 3).map((c) => c.event.id);
        }
    }

    /**
     * 设置降级配置
     */
    setFallbackConfig(config: Partial<FallbackConfig>): void {
        this.fallbackConfig = { ...this.fallbackConfig, ...config };
    }

    /**
     * 询问用户确认歧义词含义
     */
    async askUserClarification(
        ambiguousTerms: { term: string; options: string[] }[],
        rl: ReadlineInterface,
    ): Promise<{ term: string; selected: string }[] | null> {
        const clarifications: { term: string; selected: string }[] = [];

        for (const item of ambiguousTerms) {
            const optionsStr = item.options
                .map((o, i) => `${i + 1}. ${o}`)
                .join(" | ");
            console.log(`[需要确认] ${item.term} 可能指: ${optionsStr}`);

            const answer = await new Promise<string>((resolve) => {
                rl.question("请输入选项编号或直接输入含义: ", resolve);
            });

            // 解析用户输入
            const trimmed = answer.trim();
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= item.options.length) {
                const selected = item.options[num - 1];
                if (selected) {
                    clarifications.push({ term: item.term, selected });
                }
            } else {
                // 用户直接输入了含义
                clarifications.push({ term: item.term, selected: trimmed });
            }
        }

        return clarifications;
    }

    // ============================================================================
    // chatLoop 辅助方法
    // ============================================================================

    /**
     * 检查是否为退出命令
     */
    private _isExitCommand(query: string, exitCommands: string[]): boolean {
        const normalizedQuery = query.trim().toLowerCase();
        return exitCommands.includes(normalizedQuery);
    }

    /**
     * 处理退出命令
     */
    private async _handleExitCommand(
        rl: ReadlineInterface,
        history: Message[],
        options?: {
            onEnd?: (history: Message[], finalEventId: string) => void;
        },
    ): Promise<void> {
        console.log("\n感谢使用，退出对话");
        rl.close();
        const lastEventId =
            history.length > 0
                ? (await this.episodic.getRecentEvents(1))[0]?.event.id || ""
                : "";
        options?.onEnd?.(history, lastEventId);
    }

    /**
     * 打印存储目标结果
     */
    private _printActionResult(destination: InteractionDestination): void {
        if (destination.action === "join_existing") {
            console.log("\n【系统】当前交互将加入到现有事件");
            if (destination.existingEventInfo) {
                console.log(
                    `  目标事件: ${destination.existingEventInfo.topic}`,
                );
                console.log(`  理由: ${destination.reason}`);
            }
            console.log();
        } else if (destination.action === "create_new") {
            console.log("\n【系统】当前交互将创建新事件");
            if (destination.newEventInfo) {
                console.log(`  新主题: ${destination.newEventInfo.topic}`);
                console.log(
                    `  新描述: ${destination.newEventInfo.description}`,
                );
                console.log(`  理由: ${destination.reason}`);
            }
            console.log();
        } else if (destination.action === "skip") {
            console.log("\n【系统】当前交互无实质内容，已跳过存储");
            console.log(`  原因: ${destination.reason}`);
            console.log();
        }
    }

    /**
     * 打印助手回复
     */
    private _printAssistantResponse(result: {
        content: string;
        eventId: string;
        history: Message[];
    }): void {
        console.log(`\n【助手】 ${result.content}`);
        console.log(
            `[调试] eventId: ${result.eventId}, history 长度: ${result.history.length}`,
        );
    }

    /**
     * 处理合并确认（询问用户是否执行合并）
     */
    private async _handleMergeConfirmation(
        result: {
            destination: InteractionDestination;
            selectedEvents: {
                id: string;
                topic: string;
                description: string;
            }[];
        },
        rl: ReadlineInterface,
    ): Promise<"accept" | "reject"> {
        console.log("\n" + "=".repeat(60));
        console.log("【系统】LLM 分析建议合并事件，请确认");
        console.log("=".repeat(60));

        const dest = result.destination;
        if (dest.action === "merge_and_join" && dest.mergedEventInfo) {
            console.log(`\n建议合并:`);
            console.log(`  新主题: ${dest.mergedEventInfo.mergedTopic}`);
            console.log(`  新描述: ${dest.mergedEventInfo.mergedDescription}`);
            console.log(
                `  包含事件: ${dest.mergedEventInfo.eventIds.join(", ")}`,
            );
            console.log(`  理由: ${dest.reason}`);
        }

        console.log("\n" + "-".repeat(60));
        console.log("是否执行合并? (Y/N)");
        console.log("-".repeat(60));

        const confirmResult = await new Promise<string>((resolve) => {
            rl.question("请输入 Y 或 N: ", resolve);
        });

        const normalizedConfirm = confirmResult.trim().toLowerCase();

        if (normalizedConfirm === "y" || normalizedConfirm === "yes") {
            return "accept";
        }
        return "reject";
    }

    /**
     * 处理用户接受合并
     */
    private async _handleMergeAccept(
        result: {
            rewrittenQuery: string;
            content: string;
            entities: string[];
        },
        dest: InteractionDestination,
        rl: ReadlineInterface,
    ): Promise<void> {
        console.log("\n【系统】开始执行合并...");

        if (dest.action === "merge_and_join" && dest.mergedEventInfo) {
            // 获取完整的事件信息
            const fullEvents = await Promise.all(
                dest.mergedEventInfo.eventIds.map((id) =>
                    this.episodic
                        .getEventById(id)
                        .then((event) =>
                            this.episodic
                                .getInteractionsByEventId(id, 1000)
                                .then((interactions) => ({
                                    ...event,
                                    interactions,
                                })),
                        ),
                ),
            );

            // 执行合并
            const mergedEventId = await this.executeMerge(
                dest.mergedEventInfo,
                fullEvents,
            );

            // 将当前 Interaction 加入合并后的新事件
            const vector = await this.encoder.encode(
                `${result.rewrittenQuery} ${result.content}`,
            );
            const rewrittenUserQuerySummary = await this.summaryUserQuery(
                result.rewrittenQuery,
            );
            const assistantResponseSummary =
                await this.summaryAssistantResponse(result.content);

            // 1. 创建 userQuery message
            const userQueryMessageId = await this.episodic.addMessage(
                mergedEventId,
                "temp", // 临时 interactionId，稍后会更新
                "user",
                result.rewrittenQuery,
                vector,
                rewrittenUserQuerySummary,
                result.entities,
                0,
            );

            // 2. 创建 assistantResponse message
            const assistantResponseMessageId = await this.episodic.addMessage(
                mergedEventId,
                "temp", // 临时 interactionId，稍后会更新
                "assistant",
                result.content,
                vector,
                assistantResponseSummary,
                [],
                1,
            );

            // 3. 创建 interaction 并获取真实 interactionId
            const interactionId = await this.episodic.addInteraction(
                mergedEventId,
                [userQueryMessageId, assistantResponseMessageId],
                vector,
            );

            // 4. 更新 messages 的 interactionId 为真实值
            // (由于 Qdrant 的 upsert 特性，直接用相同 id 覆盖即可)
            await this.episodic.addMessage(
                mergedEventId,
                interactionId,
                "user",
                result.rewrittenQuery,
                vector,
                rewrittenUserQuerySummary,
                result.entities,
                0,
            );
            await this.episodic.addMessage(
                mergedEventId,
                interactionId,
                "assistant",
                result.content,
                vector,
                assistantResponseSummary,
                [],
                1,
            );

            console.log(`【系统】合并完成，当前交互已存储到合并后的事件`);
            console.log(`【系统】合并后事件 ID: ${mergedEventId}`);
        }
    }

    /**
     * 处理用户拒绝合并（让用户选择存储到哪个事件）
     */
    private async _handleMergeReject(
        result: {
            selectedEvents: {
                id: string;
                topic: string;
                description: string;
            }[];
        },
        rl: ReadlineInterface,
    ): Promise<void> {
        console.log("\n【系统】已取消合并，请选择存储到哪个事件:");

        const eventOptions = result.selectedEvents.map((e, idx) => ({
            index: idx + 1,
            eventId: e.id,
            topic: e.topic,
            description: e.description,
        }));

        // 展示事件列表
        for (const opt of eventOptions) {
            console.log(`  ${opt.index}. 主题: ${opt.topic}`);
            console.log(`     描述: ${opt.description}`);
            console.log();
        }

        const selectResult = await new Promise<string>((resolve) => {
            rl.question("请输入选项编号: ", resolve);
        });

        const selectedIdx = parseInt(selectResult.trim(), 10) - 1;
        const selectedEvent = eventOptions[selectedIdx];
        if (
            selectedIdx >= 0 &&
            selectedIdx < eventOptions.length &&
            selectedEvent
        ) {
            console.log(
                `\n【系统】当前交互已存储到事件: ${selectedEvent.topic}`,
            );
        }
    }

    // ============================================================================
    // 核心处理辅助方法
    // ============================================================================

    /**
     * 检索记忆
     * 并行执行向量检索、实体检索和最近交互检索，并合并结果
     * @param queryEmbedding 查询向量
     * @param entities 提取的实体列表
     * @param timeWindowFilter 时间窗口过滤器（可选）
     * @returns 去重并按更新时间降序排列的事件列表
     */
    async retrieveMemories(
        queryEmbedding: number[],
        entities: string[],
        timeWindowFilter?: { startTime: string; endTime: string },
    ): Promise<(Event & { interactions: Interaction[] })[]> {
        const eventVectorSearchPromise = this.episodic.searchEventsByVector(
            queryEmbedding,
            0.8,
            5,
            timeWindowFilter,
        );
        const similarInteractionsPromise =
            this.episodic.searchInteractionsByVector(
                queryEmbedding,
                0.8,
                5,
                timeWindowFilter,
            );
        const entitySearchPromise =
            entities.length > 0
                ? this.episodic.searchInteractionsByEntities(
                      entities,
                      5,
                      timeWindowFilter,
                  )
                : Promise.resolve([]);
        const recentInteractionsPromise =
            this.episodic.searchRecentInteractions(5);

        const [
            eventVectorSearchResults,
            similarInteractions,
            entitySearchResults,
            recentInteractions,
        ] = await Promise.all([
            eventVectorSearchPromise.catch((e) => {
                console.error("[向量检索]", e);
                return [];
            }),
            similarInteractionsPromise.catch((e) => {
                console.error("[相似Interaction]", e);
                return [];
            }),
            entitySearchPromise.catch((e) => {
                console.error("[实体检索]", e);
                return [];
            }),
            recentInteractionsPromise.catch((e) => {
                console.error("[最近Interactions]", e);
                return [];
            }),
        ]);

        // 合并所有搜索结果
        const allResults = [
            ...entitySearchResults,
            ...eventVectorSearchResults,
            ...similarInteractions,
            ...recentInteractions,
        ];
        const mergedMap = new Map<
            string,
            Event & { interactions: Interaction[] }
        >();
        for (const item of allResults) {
            const existing = mergedMap.get(item.event.id);
            if (existing) {
                const combinedInteractions = [
                    ...existing.interactions,
                    ...item.interactions,
                ];
                const uniqueInteractions = [
                    ...new Map(
                        combinedInteractions.map((i) => [i.id, i]),
                    ).values(),
                ];
                uniqueInteractions.sort(
                    (a, b) => a.interactionIndex - b.interactionIndex,
                );
                existing.interactions = uniqueInteractions;
            } else {
                mergedMap.set(item.event.id, {
                    ...item.event,
                    interactions: item.interactions,
                });
            }
        }
        return [...mergedMap.values()].sort(
            (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
        );
    }

    /**
     * 构建事件上下文文本
     */
    private async _buildEventContext(
        query: string,
        scoredEventsWithInteractions: EventWithScoredInteractions[],
        selectedEventsWithInteractions: (Event & {
            interactions: Interaction[];
        })[],
        thresholds: {
            eventRelevanceThreshold: number;
            interactionRelevanceThreshold: number;
            maxEvents: number;
            maxInteractionsPerEvent: number;
            contextWindowSize: number;
        },
    ): Promise<string> {
        let eventContextText: string = "无相关事件上下文";
        const eventsForContext =
            scoredEventsWithInteractions.length > 0
                ? scoredEventsWithInteractions
                : selectedEventsWithInteractions.length > 0
                  ? selectedEventsWithInteractions.map((e) => ({
                        event: e,
                        interactions: e.interactions.map((i, iIdx) => ({
                            interaction: i,
                            relevanceScore: 0.5,
                            reason: "",
                            interactionIndex: iIdx,
                        })),
                        eventRelevanceScore: 0.5,
                    }))
                  : [];

        if (eventsForContext.length > 0) {
            const allInteractionTimes: Date[] = [];
            for (const e of eventsForContext) {
                for (const ir of e.interactions) {
                    allInteractionTimes.push(
                        new Date(ir.interaction.createdAt),
                    );
                }
            }
            const { hasCrossYear, hasCrossDay } =
                this.getTimeFlags(allInteractionTimes);
            const eventsForBuild = eventsForContext.map((e) => ({
                topic: e.event.topic,
                description: e.event.description,
                entities: e.event.entities,
                createdAt: e.event.createdAt,
                updatedAt: e.event.updatedAt,
                interactions: e.interactions
                    .slice(0, thresholds.maxInteractionsPerEvent)
                    .map((ir) => ({
                        createdAt: ir.interaction.createdAt,
                        messageIds: ir.interaction.messageIds,
                        interactionIndex: ir.interactionIndex,
                    })),
            }));
            eventContextText = await this.buildEventsText(
                eventsForBuild,
                hasCrossYear,
                hasCrossDay,
                { useSummary: true, showSkipped: true },
            );
        }
        return eventContextText;
    }

    /**
     * 价值判断
     * 判断用户问题是否具有实质性的信息价值，决定是否需要存储
     * @param query 用户问题
     * @param content 助手回答内容
     * @returns 包含判断结果和建议的结构
     */
    async evaluateValue(
        query: string,
        content: string,
    ): Promise<{
        isValuable: boolean;
        reason: string;
        userQueryNeedSummary: boolean;
        assistantResponseNeedSummary: boolean;
    }> {
        const valuablePrompt = `判断以下用户问题是否具有实质性的信息价值。
【用户问题】${query}
【AI 回答】${content}
【判断标准】无价值：问候语、感谢语、简单客套、确认性语句、祝福语、查询性/元问题。有价值：技术帮助、概念解释、实质内容对话。
请以JSON格式返回：{"isValuable": true或false, "reason": "判断理由", "userQueryNeedSummary": true或false, "assistantResponseNeedSummary": true或false}`;

        try {
            const valuableResponse = await this.llm.chat.completions.create({
                model: this.llmModel,
                messages: [
                    { role: "system", content: "你是一个对话质量评估专家。" },
                    { role: "user", content: valuablePrompt },
                ],
                temperature: 0.1,
            });
            const valuableContent =
                valuableResponse.choices[0]?.message?.content;
            const valuableJsonMatch = valuableContent?.match(/\{[\s\S]*\}/);
            if (valuableJsonMatch) {
                const valuableResult = JSON.parse(valuableJsonMatch[0]);
                return {
                    isValuable: valuableResult.isValuable !== false,
                    reason: valuableResult.reason || "",
                    userQueryNeedSummary:
                        valuableResult?.userQueryNeedSummary ?? true,
                    assistantResponseNeedSummary:
                        valuableResult?.assistantResponseNeedSummary ?? true,
                };
            }
        } catch (error) {
            console.warn("[价值判断] 判断失败，继续处理:", error);
        }
        return {
            isValuable: true,
            reason: "",
            userQueryNeedSummary: true,
            assistantResponseNeedSummary: true,
        };
    }

    /**
     * 代词消解
     * 根据对话历史和事件上下文，将用户问题中的代词替换为具体实体
     * @param query 用户原始问题
     * @param eventContextText 事件上下文文本
     * @param historyText 对话历史文本
     * @param rl Readline接口（用于询问用户确认歧义）
     * @returns 消解后的完整查询语句
     */
    async resolvePronouns(
        query: string,
        eventContextText: string,
        historyText: string,
        rl: ReadlineInterface,
    ): Promise<string> {
        const rewrittenQueryprompt = `当前时间: ${new Date().toLocaleString("zh-CN")}
【用户当前问题】
${query}
【对话历史】
${historyText}
【相关事件上下文】
${eventContextText}
【任务】你是一个查询改写专家，擅长代词消解。请根据对话历史和事件上下文，将用户问题中的代词替换为具体实体。
【指代词类型及消解策略】1. 人称代词 2. 指示代词 3. 时间词 4. 省略句
【消解优先级】1. 事件上下文最优先 2. 对话历史 3. 常识推理
【输出格式】{"rewrittenQuery": "消解后的完整查询语句", "resolvedPronouns": ["代词1->实体1"]}
【无法消解时的处理】{"rewrittenQuery": "[NEED_USER_CONFIRM]", "ambiguousTerms": [{"term": "刚才的", "options": ["选项1"]}]}`;

        let rewrittenQuery = query;
        let clarifications: { term: string; selected: string }[] = [];
        let rewriteSuccess = false;
        let rewriteRetryCount = 0;
        const maxRetries = 10;

        while (!rewriteSuccess && rewriteRetryCount < maxRetries) {
            rewriteRetryCount++;
            let rewritePrompt = rewrittenQueryprompt;
            if (clarifications.length > 0) {
                const clarificationText = clarifications
                    .map((c) => `${c.term} -> ${c.selected}`)
                    .join(", ");
                rewritePrompt = rewritePrompt.replace(
                    "【任务】",
                    `【用户已确认的含义】\n${clarificationText}\n\n【任务】`,
                );
            }
            try {
                const response = await this.llm.chat.completions.create({
                    model: this.llmModel,
                    messages: [
                        { role: "system", content: "你是一个查询改写专家，擅长代词消解。" },
                        { role: "user", content: rewritePrompt },
                    ],
                    temperature: 0.1,
                });
                const rewriteContent = response.choices[0]?.message?.content;
                if (!rewriteContent) continue;
                const jsonMatch = rewriteContent.match(/\{[\s\S]*\}/);
                if (!jsonMatch) continue;
                try {
                    const result = JSON.parse(jsonMatch[0]);
                    if (result.rewrittenQuery === "[NEED_USER_CONFIRM]") {
                        if (Array.isArray(result.ambiguousTerms) && result.ambiguousTerms.length > 0) {
                            const newClarifications = await this.askUserClarification(result.ambiguousTerms, rl);
                            if (newClarifications && newClarifications.length > 0) {
                                clarifications = [...clarifications, ...newClarifications];
                            }
                        }
                        continue;
                    }
                    rewrittenQuery = result.rewrittenQuery;
                    rewriteSuccess = true;
                } catch {
                    continue;
                }
            } catch (error) {
                throw new Error(`Query改写失败: ${error}`);
            }
        }
        return rewrittenQuery;
    }

    /**
     * 存储记忆
     * 纯粹的存储函数，执行给定的存储操作，不包含用户确认逻辑
     * @param destination 存储目标决策
     * @param entities 实体列表
     * @param selectedEvents 被选中的事件列表（用于 merge_and_join）
     * @param rewrittenQuery 改写后的用户问题（用于生成 interaction）
     * @param content 助手回答内容（用于生成 interaction）
     * @returns 存储后的事件 ID
     */
    async storeMemory(
        destination: InteractionDestination,
        entities: string[],
        selectedEvents?: (Event & { interactions: Interaction[] })[],
        rewrittenQuery?: string,
        content?: string,
    ): Promise<string> {
        if (destination.action === "create_new") {
            return await this.episodic.addEvent(
                destination.newEventInfo!.topic,
                destination.newEventInfo!.description,
                entities,
                await this.encoder.encode(destination.newEventInfo!.description),
            );
        } else if (destination.action === "join_existing") {
            return destination.existingEventInfo!.eventId;
        } else if (destination.action === "merge_and_join") {
            if (!selectedEvents || !destination.mergedEventInfo) {
                throw new MemorySystemError(
                    "merge_and_join 操作需要 selectedEvents 参数",
                    "MISSING_SELECTED_EVENTS",
                );
            }
            // 执行合并
            const mergedEventId = await this.executeMerge(
                destination.mergedEventInfo,
                selectedEvents,
            );

            // 将当前 interaction 加入合并后的新事件
            if (rewrittenQuery && content) {
                const vector = await this.encoder.encode(
                    `${rewrittenQuery} ${content}`,
                );
                const userQuerySummary = await this.summaryUserQuery(rewrittenQuery);
                const assistantResponseSummary = await this.summaryAssistantResponse(content);

                // 1. 创建 userQuery message
                const userQueryMessageId = await this.episodic.addMessage(
                    mergedEventId,
                    "temp",
                    "user",
                    rewrittenQuery,
                    vector,
                    userQuerySummary,
                    entities,
                    0,
                );

                // 2. 创建 assistantResponse message
                const assistantResponseMessageId = await this.episodic.addMessage(
                    mergedEventId,
                    "temp",
                    "assistant",
                    content,
                    vector,
                    assistantResponseSummary,
                    [],
                    1,
                );

                // 3. 创建 interaction 并获取真实 interactionId
                const interactionId = await this.episodic.addInteraction(
                    mergedEventId,
                    [userQueryMessageId, assistantResponseMessageId],
                    vector,
                );

                // 4. 更新 messages 的 interactionId 为真实值
                await this.episodic.addMessage(
                    mergedEventId,
                    interactionId,
                    "user",
                    rewrittenQuery,
                    vector,
                    userQuerySummary,
                    entities,
                    0,
                );
                await this.episodic.addMessage(
                    mergedEventId,
                    interactionId,
                    "assistant",
                    content,
                    vector,
                    assistantResponseSummary,
                    [],
                    1,
                );
            }
            return mergedEventId;
        }
        return "";
    }

    /**
     * 生成摘要
     */
    private async _generateSummaries(
        rewrittenQuery: string,
        content: string,
        needStoreSummary: boolean,
        userQueryNeedSummary: boolean,
        assistantResponseNeedSummary: boolean,
    ): Promise<{ userQuerySummary: string; assistantResponseSummary: string }> {
        let userQuerySummary = "";
        let assistantResponseSummary = "";

        if (needStoreSummary) {
            if (userQueryNeedSummary) {
                userQuerySummary = await this.summaryUserQuery(rewrittenQuery);
            }
            if (assistantResponseNeedSummary) {
                assistantResponseSummary = await this.summaryAssistantResponse(content);
            }
        }

        return { userQuerySummary, assistantResponseSummary };
    }

    /**
     * 处理待确认操作
     * 统一处理所有需要用户确认的操作，返回确认结果
     */
    private async _processConfirmations(
        pendingConfirmations: PendingConfirmation[],
        rl: ReadlineInterface,
    ): Promise<ConfirmationResult[]> {
        const results: ConfirmationResult[] = [];

        for (const confirmation of pendingConfirmations) {
            if (confirmation.type === "merge_and_join") {
                const userChoice = await this._handleMergeConfirmation(
                    { destination: confirmation.destination!, selectedEvents: confirmation.selectedEvents! },
                    rl,
                );
                if (userChoice === "accept") {
                    await this._handleMergeAccept(
                        { rewrittenQuery: confirmation.data.rewrittenQuery as string, content: confirmation.data.content as string, entities: confirmation.data.entities as string[] },
                        confirmation.destination!,
                        rl,
                    );
                    results.push({ confirmed: true, action: "accept", data: confirmation.data });
                } else {
                    await this._handleMergeReject(
                        { selectedEvents: confirmation.selectedEvents! },
                        rl,
                    );
                    results.push({ confirmed: false, action: "reject", data: confirmation.data });
                }
            }
            // 可以继续添加其他类型的确认处理...
        }

        return results;
    }

    /**
     * 检索流程：多事件选择、Interactions精筛选、构建上下文
     */
    private async _processRetrieval(
        query: string,
        queryEmbedding: number[],
        entities: string[],
        timeWindowFilter: { startTime: string; endTime: string } | undefined,
        history: Message[] | undefined,
        thresholds: {
            eventRelevanceThreshold: number;
            interactionRelevanceThreshold: number;
            maxEvents: number;
            maxInteractionsPerEvent: number;
            contextWindowSize: number;
        },
    ): Promise<{
        selectedEventsWithInteractions: (Event & { interactions: Interaction[] })[];
        scoredEventsWithInteractions: EventWithScoredInteractions[];
        eventContextText: string;
        historyText: string;
    }> {
        // 1. 并行记忆检索
        const candidateEventList = await this.retrieveMemories(
            queryEmbedding, entities, timeWindowFilter,
        );

        // 2. 多事件选择
        let selectedEventsWithInteractions: (Event & { interactions: Interaction[] })[] = [];
        let scoredEventsWithInteractions: EventWithScoredInteractions[] = [];

        if (candidateEventList.length > 0) {
            const selection = await this.selectRelevantEvents(query, candidateEventList);
            if (selection && selection.hasRelevantEvents && selection.indices.length > 0) {
                selectedEventsWithInteractions = selection.indices
                    .filter((idx) => idx >= 0 && idx < candidateEventList.length)
                    .map((idx) => candidateEventList[idx])
                    .filter((e): e is Event & { interactions: Interaction[] } => e !== undefined);

                // 3. Interactions 精筛选
                const queryType = await this.classifyQueryType(query);
                scoredEventsWithInteractions = await this.selectRelevantInteractions(
                    query, selectedEventsWithInteractions, queryType,
                );
            }
        }

        // 4. 构建历史文本
        const historyText = history && history.length > 0
            ? history.map((m) => `[${m.role}] ${m.content}`).join("\n")
            : "无对话历史";

        // 5. 构建事件上下文文本
        const eventContextText = await this._buildEventContext(
            query, scoredEventsWithInteractions, selectedEventsWithInteractions, thresholds,
        );

        return {
            selectedEventsWithInteractions,
            scoredEventsWithInteractions,
            eventContextText,
            historyText,
        };
    }

    /**
     * 存储流程：价值判断、分析目标、执行存储、生成摘要
     */
    private async _processStorage(
        query: string,
        rewrittenQuery: string,
        content: string,
        entities: string[],
        selectedEventsWithInteractions: (Event & { interactions: Interaction[] })[],
        currentHistory: Message[],
        userQueryNeedSummary: boolean,
        assistantResponseNeedSummary: boolean,
    ): Promise<{
        destination: InteractionDestination;
        storedEventId: string;
        userQuerySummary: string;
        assistantResponseSummary: string;
    }> {
        // 1. 价值判断
        const valuableResult = await this.evaluateValue(query, content);
        let destination: InteractionDestination | undefined;

        if (!valuableResult.isValuable) {
            console.log("[价值判断] 检测到无价值内容，跳过存储");
            destination = { action: "skip", reason: valuableResult.reason || "内容无价值，跳过存储" };
        }

        const { isValuable: _isValuable, userQueryNeedSummary: _userQueryNeedSummary, assistantResponseNeedSummary: _assistantResponseNeedSummary, ..._rest } = valuableResult;

        // 2. 分析存储目标
        if (destination === undefined) {
            destination = await this.analyzeInteractionDestination(
                selectedEventsWithInteractions, query, content,
            );
        }

        // 3. 执行存储
        const storedEventId = await this.storeMemory(
            destination,
            entities,
            selectedEventsWithInteractions,
            rewrittenQuery,
            content,
        );

        // 4. 生成摘要
        const needStoreSummary = destination.action !== "skip" && destination.action !== "merge_and_join";
        const { userQuerySummary, assistantResponseSummary } = await this._generateSummaries(
            rewrittenQuery, content, needStoreSummary,
            userQueryNeedSummary, assistantResponseNeedSummary,
        );

        return { destination: destination!, storedEventId, userQuerySummary, assistantResponseSummary };
    }

    // ============================================================================
    // 标准化阶段函数
    // ============================================================================

    /**
     * 阶段1: QUERY_ANALYSIS (查询分析)
     * 对用户输入进行预处理，提取关键信息
     */
    private async queryAnalysis(rawQuery: string): Promise<QueryAnalysisResult> {
        // 向量编码 + 实体/时间提取 (并行)
        const [queryEmbedding, extractionResult] = await Promise.all([
            this.encoder.encode(rawQuery),
            this.extractEntitiesAndTimeWindow(rawQuery),
        ]);

        // 查询类型分类
        const queryType = await this.classifyQueryType(rawQuery);
        const thresholds = this.getThresholdsForQueryType(queryType);

        return {
            queryEmbedding,
            entities: extractionResult.entities,
            timeWindow: extractionResult.timeWindow,
            queryType,
            thresholds,
        };
    }

    /**
     * 阶段2: RETRIEVE (记忆检索)
     * 从情景记忆和语义记忆检索相关内容
     *
     * 新算法流程:
     * 1. 双触发初始化种子 (向量 + 关键词)
     * 2. 扩散激活 (Fan Effect, Sigmoid, 多轮迭代)
     * 3. 分离 V_S 和 V_E 节点
     * 4. 获取间接相关消息 (通过 ABSTRACTION 边)
     */
    private async retrieve(
        rawQuery: string,
        analysis: QueryAnalysisResult,
    ): Promise<RetrievalResult> {
        // 构建时间过滤
        const timeWindowFilter =
            analysis.timeWindow?.startTime && analysis.timeWindow?.endTime
                ? { startTime: analysis.timeWindow.startTime, endTime: analysis.timeWindow.endTime }
                : undefined;

        // 情景记忆检索 (直接相关事件)
        const candidateEvents = await this.retrieveMemories(
            analysis.queryEmbedding,
            analysis.entities,
            timeWindowFilter,
        );

        // 语义记忆激活
        let activatedSemantics: SemanticNodeVector[] = [];
        let allActivatedMessages: Message[] = [];
        const indirectActivationMap = new Map<string, number>();
        const semanticToMessagesMap = new Map<string, string[]>();

        if (this.semantic) {
            // 1. 双触发初始化: 向量检索
            const activationResults = await this.semantic.activateFromVector(
                analysis.queryEmbedding,
                0.92,
                { maxIterations: 3, threshold: 0.5 }
            );

            // 2. 分离 V_S 和 V_E 节点
            const activatedSemanticIds: string[] = [];
            const episodicNodeIds: string[] = [];

            for (const result of activationResults) {
                if (result.nodeType === "semantic") {
                    activatedSemanticIds.push(result.nodeId);
                } else {
                    episodicNodeIds.push(result.nodeId); // nodeId 是 messageId
                }
                indirectActivationMap.set(result.nodeId, result.finalActivation);
            }

            // 3. 获取激活的语义节点详情
            if (activatedSemanticIds.length > 0) {
                const semantics = await Promise.all(
                    activatedSemanticIds.map((id) => this.semantic!.getSemanticNode(id))
                );
                activatedSemantics = semantics.filter((s): s is SemanticNodeVector => s !== null);
            }

            // 4. 获取间接相关消息 (语义激活 → ABSTRACTION 边 → V_E)
            const indirectMessageIds: string[] = [];

            for (const semantic of activatedSemantics) {
                const linkedMessageIds = await this.semantic!.getLinkedEpisodics(semantic.id);

                if (linkedMessageIds.length > 0) {
                    semanticToMessagesMap.set(semantic.id, linkedMessageIds);

                    for (const messageId of linkedMessageIds) {
                        if (!indirectMessageIds.includes(messageId)) {
                            indirectMessageIds.push(messageId);
                        }
                    }
                }
            }

            // 5. 合并直接和间接的消息
            const allMessageIds = new Set([...episodicNodeIds, ...indirectMessageIds]);
            if (allMessageIds.size > 0) {
                allActivatedMessages = await this.episodic.getMessagesByIds(
                    Array.from(allMessageIds)
                );
            }
        }

        // 转换为 EventWithInteractions 格式
        const candidateEventsWithFormat: EventWithInteractions[] = candidateEvents.map(
            (e) => ({ event: e, interactions: e.interactions }),
        );

        return {
            candidateEvents: candidateEventsWithFormat,
            activatedMessages: allActivatedMessages,
            activatedSemantics,
            indirectActivationMap,
            semanticToMessagesMap,
        };
    }

    /**
     * 阶段3: SELECT (筛选)
     * 从候选记忆中筛选相关内容
     */
    private async select(
        rawQuery: string,
        retrieval: RetrievalResult,
        analysis: QueryAnalysisResult,
    ): Promise<SelectResult> {
        // 选择相关事件
        let selectedEventsWithInteractions: (Event & { interactions: Interaction[] })[] = [];

        if (retrieval.candidateEvents.length > 0) {
            // 转换为 selectRelevantEvents 期望的格式
            const eventsForSelection = retrieval.candidateEvents.map(
                (e) => ({ ...e.event, interactions: e.interactions }),
            );

            const selection = await this.selectRelevantEvents(
                rawQuery,
                eventsForSelection,
            );

            if (selection && selection.hasRelevantEvents && selection.indices.length > 0) {
                selectedEventsWithInteractions = selection.indices
                    .filter((idx) => idx >= 0 && idx < eventsForSelection.length)
                    .map((idx) => eventsForSelection[idx])
                    .filter((e): e is Event & { interactions: Interaction[] } => e !== undefined);
            }
        }

        // 精筛 Interactions
        const scoredEvents = await this.selectRelevantInteractions(
            rawQuery,
            selectedEventsWithInteractions,
            analysis.queryType,
        );

        // LLM 降级筛选（如果启用且处于边界情况）
        let finalSelectedEvents = scoredEvents;
        if (this.shouldUseLLMFallback(scoredEvents, analysis.thresholds.eventRelevanceThreshold)) {
            console.log("[LLM 降级] 处于边界区间，使用 LLM 进行二次筛选");
            const llmSelectedIds = await this.llmFallbackSelect(rawQuery, scoredEvents);
            finalSelectedEvents = scoredEvents.filter((e) =>
                llmSelectedIds.includes(e.event.id),
            );
        }

        return {
            selectedEvents: finalSelectedEvents,
            activatedMessages: retrieval.activatedMessages,
            activatedSemantics: retrieval.activatedSemantics,
            activationMap: retrieval.indirectActivationMap,
            semanticToMessagesMap: retrieval.semanticToMessagesMap,
        };
    }

    /**
     * 阶段4: CONTEXT_BUILD (上下文构建)
     * 将筛选结果构建为格式化的上下文文本
     */
    private async contextBuild(
        select: SelectResult,
        history: Message[],
    ): Promise<ContextBuildResult> {
        // 构建事件上下文文本
        let eventContextText = "无相关事件上下文";
        if (select.selectedEvents.length > 0) {
            const parts: string[] = [];
            for (const scoredEvent of select.selectedEvents.slice(0, 3)) {
                const eventLines = [`事件: ${scoredEvent.event.topic}`];
                for (const int of scoredEvent.interactions.slice(0, 3)) {
                    eventLines.push(`  - [${int.interactionIndex}]: 相关度 ${int.relevanceScore.toFixed(2)}`);
                }
                parts.push(eventLines.join("\n"));
            }
            eventContextText = parts.join("\n\n");
        }

        // 构建历史文本
        const historyText = history
            .map((m) => `[${m.role}] ${m.content}`)
            .join("\n");

        // 构建语义上下文
        let semanticContext: string | undefined;
        if (select.activatedSemantics.length > 0) {
            semanticContext = select.activatedSemantics
                .map((s) => `- ${s.name} (${s.type})`)
                .join("\n");
        }

        // 构建激活内容文本
        const activatedContent =
            select.activatedMessages.length > 0
                ? select.activatedMessages
                    .slice(0, 5)
                    .map((m) => `[${m.role}] ${m.content}`)
                : undefined;

        return {
            eventContextText,
            historyText,
            semanticContext,
            activatedContent,
        };
    }

    /**
     * 阶段5: RESOLVE (代词消解)
     * 对查询进行代词消解和语义改写
     */
    private async resolve(
        rawQuery: string,
        context: ContextBuildResult,
        rl: ReadlineInterface,
    ): Promise<ResolveResult> {
        const resolvedQuery = await this.resolvePronouns(
            rawQuery,
            context.eventContextText,
            context.historyText,
            rl,
        );

        return {
            resolvedQuery,
            needsClarification: resolvedQuery.includes("[NEED_USER_CONFIRM]"),
        };
    }

    /**
     * 阶段6: GENERATE (生成回答)
     * 基于上下文文本生成回答
     */
    private async generate(
        resolve: ResolveResult,
        context: ContextBuildResult,
        history: Message[],
    ): Promise<GenerateResponseResult> {
        // 构建完整的上下文文本
        const fullContext = this.buildFullContext(context);

        return await this.generateResponse(
            resolve.resolvedQuery,
            fullContext,
            history,
        );
    }

    /**
     * 构建完整上下文文本
     */
    private buildFullContext(context: ContextBuildResult): string {
        const parts: string[] = [];

        if (context.eventContextText) {
            parts.push(`【事件上下文】\n${context.eventContextText}`);
        }
        if (context.semanticContext) {
            parts.push(`【相关概念】\n${context.semanticContext}`);
        }
        if (context.activatedContent && context.activatedContent.length > 0) {
            parts.push(`【相关记忆】\n${context.activatedContent.join("\n")}`);
        }
        if (context.historyText) {
            parts.push(`【对话历史】\n${context.historyText}`);
        }

        return parts.join("\n\n");
    }

    /**
     * 阶段7: STORE (存储记忆)
     * 评估交互价值，确定存储目标，执行存储
     */
    private async store(
        rawQuery: string,
        content: string,
        analysis: QueryAnalysisResult,
        context: ContextBuildResult,
        resolvedQuery: string,
    ): Promise<StoreResult> {
        // 评估价值
        const valuableResult = await this.evaluateValue(rawQuery, content);

        // 获取选中事件 (用于分析存储目标)
        // 注意: getSelectedEventsFromContext 返回 Event[] 但 analyzeInteractionDestination 需要 (Event & { interactions: Interaction[] })[]
        // 由于该方法目前返回空数组，直接传递空数组
        const selectedEventsWithInteractions: (Event & { interactions: Interaction[] })[] =
            context.eventContextText
                ? await this.getSelectedEventsFromContext(context).then(events =>
                    events.map(e => ({ ...e, interactions: [] as Interaction[] }))
                )
                : [];

        // 确定存储目标
        const destination = await this.analyzeInteractionDestination(
            selectedEventsWithInteractions,
            rawQuery,
            content,
        );

        // 执行存储（获取事件ID）
        const storedEventId = await this.executeStore(
            destination,
            resolvedQuery,
            content,
            analysis.entities,
            analysis.queryEmbedding,
        );

        // 存储消息并获取消息ID
        const messageIds: string[] = [];
        if (storedEventId && destination.action !== "skip") {
            const queryMessageId = await this.storeMessage(
                storedEventId,
                "temp",
                "user",
                resolvedQuery,
                analysis.queryEmbedding,
                analysis.entities,
                0,
            );
            const responseMessageId = await this.storeMessage(
                storedEventId,
                "temp",
                "assistant",
                content,
                analysis.queryEmbedding,
                [],
                1,
            );

            if (queryMessageId) messageIds.push(queryMessageId);
            if (responseMessageId) messageIds.push(responseMessageId);

            // 创建交互
            if (queryMessageId && responseMessageId) {
                await this.episodic.addInteraction(
                    storedEventId,
                    [queryMessageId, responseMessageId],
                    analysis.queryEmbedding,
                );
            }

            // 存储到语义记忆
            if (this.semantic && messageIds.length > 0) {
                await this.storeToSemantic(
                    storedEventId,
                    messageIds,
                    analysis.entities,
                );
            }
        }

        return {
            destination,
            storedEventId,
            messageIds,
        };
    }

    /**
     * 存储单条消息到情景记忆
     */
    private async storeMessage(
        eventId: string,
        interactionId: string,
        role: "user" | "assistant",
        content: string,
        vector: number[],
        entities: string[],
        messageIndex: number,
    ): Promise<string | null> {
        try {
            return await this.episodic.addMessage(
                eventId,
                interactionId,
                role,
                content,
                vector,
                "",
                entities,
                messageIndex,
            );
        } catch (error) {
            console.error("[存储消息失败]", error instanceof Error ? error.message : String(error));
            return null;
        }
    }

    /**
     * 存储交互到语义记忆
     * 创建 V_E 节点、TEMPORAL 边和 ABSTRACTION 边
     */
    private async storeToSemantic(
        eventId: string,
        messageIds: string[],
        entities: string[],
    ): Promise<void> {
        if (!this.semantic || messageIds.length === 0) return;

        try {
            // 1. 为消息创建 V_E 节点
            for (const messageId of messageIds) {
                await this.semantic.createEpisodicNode(messageId);
            }

            // 2. 创建 TEMPORAL 边（消息之间，按时间顺序）
            for (let i = 0; i < messageIds.length - 1; i++) {
                const fromId = messageIds[i];
                const toId = messageIds[i + 1];
                if (fromId && toId) {
                    await this.semantic.linkEpisodicToEpisodic(fromId, toId, 0.8);
                }
            }

            // 3. 为实体创建/更新 V_S 节点，并创建 ABSTRACTION 边
            for (const entity of entities) {
                const entityVector = await this.encoder.encode(entity);
                await this.semantic.upsertSemanticNode(
                    entity,
                    this.inferEntityType(entity),
                    entityVector,
                    { eventId },
                );

                // 4. 创建 ABSTRACTION 边（从消息到概念的抽象）
                for (const messageId of messageIds) {
                    await this.semantic.linkEpisodicToSemantic(
                        messageId,
                        entity,
                        0.7,
                    );
                }
            }

            console.log(`[语义记忆] 已存储 ${messageIds.length} 条消息 V_E 节点`);
        } catch (error) {
            console.error("[存储到语义记忆失败]", error);
        }
    }

    /**
     * 推断实体类型
     */
    private inferEntityType(entity: string): string {
        // 简单基于模式的类型推断
        const lowerEntity = entity.toLowerCase();

        if (/\d+\.\d+\.\d+/.test(entity)) return "version";
        if (/\.git|\.env|\.json|\.ts|\.js|\.py$/.test(entity)) return "file";
        if (/^https?:\/\//.test(entity)) return "url";
        if (/^[A-Z][a-z]+[A-Z]/.test(entity)) return "class";
        if (/^[a-z][a-z0-9]*\(/.test(entity)) return "function";
        if (/[A-Z]/.test(entity)) return "constant";

        return "concept";
    }

    /**
     * 从上下文文本获取选中事件 (临时实现)
     */
    private async getSelectedEventsFromContext(
        _context: ContextBuildResult,
    ): Promise<Event[]> {
        // 临时返回空数组，实际需要从上下文解析或传递
        return [];
    }

    /**
     * 执行存储
     */
    private async executeStore(
        destination: InteractionDestination,
        rewrittenQuery: string,
        content: string,
        entities: string[],
        eventVector: number[],
    ): Promise<string> {
        if (destination.action === "skip") {
            return "";
        }

        // 根据 destination.action 执行不同操作
        if (destination.action === "create_new" && destination.newEventInfo) {
            const eventId = await this.episodic.addEvent(
                destination.newEventInfo.topic,
                destination.newEventInfo.description,
                entities,
                eventVector,
            );
            return eventId;
        }

        if (destination.action === "join_existing" && destination.existingEventInfo) {
            return destination.existingEventInfo.eventId;
        }

        if (destination.action === "merge_and_join" && destination.mergedEventInfo) {
            // 合并事件后返回合并后的事件 ID
            const mergedEventId = destination.mergedEventInfo.eventIds[0];
            return mergedEventId ?? "";
        }

        return "";
    }

    /**
     * 阶段8: CONFIRM (确认处理)
     * 处理需要用户确认的操作
     */
    private async confirm(
        store: StoreResult,
        context: ContextBuildResult,
        rl: ReadlineInterface,
    ): Promise<ConfirmResult> {
        if (store.destination.action !== "merge_and_join") {
            return { confirmed: true, action: store.destination.action };
        }

        // 获取选中事件列表
        const selectedEvents = await this.getSelectedEventsFromContext(context);

        const pendingConfirmations: PendingConfirmation[] = [
            {
                type: "merge_and_join",
                action: "建议合并事件",
                data: { entities: [] },
                destination: store.destination,
                selectedEvents: selectedEvents.map((e) => ({
                    id: e.id,
                    topic: e.topic,
                    description: e.description,
                })),
            },
        ];

        const results = await this._processConfirmations(
            pendingConfirmations,
            rl,
        );
        const firstResult = results[0];
        if (firstResult) {
            return { confirmed: firstResult.confirmed, action: firstResult.action || "unknown" };
        }
        return { confirmed: false, action: "unknown" };
    }

    /**
     * 循环对话模式
     * 进入交互式对话循环，持续接收用户输入并返回助手回答
     *
     * @param options 可配置选项
     * @param options.onStart 开始对话前的回调
     * @param options.onEnd 结束对话后的回调
     * @param options.onError 发生错误时的回调
     * @param options.welcomeMessage 欢迎信息
     * @param options.exitCommands 退出命令列表
     */
    async chatLoop(options?: {
        onStart?: (history: Message[]) => void;
        onEnd?: (history: Message[], finalEventId: string) => void;
        onError?: (error: Error) => void;
        welcomeMessage?: string;
        exitCommands?: string[];
    }): Promise<void> {
        // 动态导入 readline（仅在 Node.js 环境中可用）
        const readline = await import("readline");

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        // 配置
        const exitCommands = options?.exitCommands || ["quit", "exit", "q"];
        const welcomeMessage =
            options?.welcomeMessage || "欢迎使用循环对话模式，输入 quit 退出";

        // 对话历史
        let history: Message[] = [];

        // 回调
        options?.onStart?.(history);

        // 欢迎信息
        console.log("\n" + "=".repeat(60));
        console.log(welcomeMessage);
        console.log("=".repeat(60) + "\n");

        // 问题函数
        const askQuestion = (): void => {
            rl.question("【用户】 ", async (query) => {
                // 检查退出命令
                if (this._isExitCommand(query, exitCommands)) {
                    await this._handleExitCommand(rl, history, options);
                    return;
                }

                // 跳过空输入
                if (!query.trim()) {
                    askQuestion();
                    return;
                }

                try {
                    // ========== 标准化流程 ==========

                    // 1. QUERY_ANALYSIS: 查询分析
                    const analysis = await this.queryAnalysis(query);
                    console.log(
                        `[Query类型] ${analysis.queryType}, 阈值配置:`,
                        analysis.thresholds,
                    );

                    // 检测窗口边界
                    const boundary = await this.detectWindowBoundary(query);
                    if (boundary.topicChanged) {
                        console.log(`[窗口边界检测] 话题变化: ${boundary.oldTopic} -> ${boundary.newTopic}`);
                        await this.onWindowBoundary(boundary.oldTopic!, boundary.newTopic!);
                    }

                    // 2. RETRIEVE: 记忆检索
                    const retrieval = await this.retrieve(query, analysis);

                    // 3. SELECT: 筛选
                    const select = await this.select(query, retrieval, analysis);

                    // 4. CONTEXT_BUILD: 上下文构建
                    const context = await this.contextBuild(select, history);

                    // 5. RESOLVE: 代词消解
                    const resolve = await this.resolve(query, context, rl);

                    // 6. GENERATE: 生成回答
                    const generate = await this.generate(resolve, context, history);

                    // 7. STORE: 存储记忆
                    const store = await this.store(
                        query,
                        generate.content,
                        analysis,
                        context,
                        resolve.resolvedQuery,
                    );

                    // 8. CONFIRM: 确认处理
                    await this.confirm(store, context, rl);

                    // ========== 流程结束 ==========

                    // 打印 action 结果
                    this._printActionResult(store.destination);

                    // 打印助手回复
                    this._printAssistantResponse({
                        content: generate.content,
                        eventId: store.storedEventId || "",
                        history: [
                            ...history,
                            { role: "user" as const, content: query },
                            { role: "assistant" as const, content: generate.content },
                        ],
                    });

                    // 更新对话历史
                    history = [
                        ...history,
                        { role: "user" as const, content: query },
                        { role: "assistant" as const, content: generate.content },
                    ];
                } catch (error) {
                    const err =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    console.error("\n【错误】", err.message);
                    options?.onError?.(err);
                }

                console.log();
                askQuestion();
            });
        };

        // 开始对话循环
        askQuestion();
    }

    // ============================================================================
    // 辅助方法
    // ============================================================================

    /**
     * 获取编码器维度
     */
    getDimension(): number {
        return this.encoder.getDimension();
    }

    /**
     * 检查健康状态
     */
    async health(): Promise<boolean> {
        try {
            const encoderHealth = await this.encoder.health();
            return encoderHealth;
        } catch {
            return false;
        }
    }
}
