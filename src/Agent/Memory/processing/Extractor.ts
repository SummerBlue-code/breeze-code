import { OpenAI } from "openai";

/**
 * 提取器配置选项
 */
export interface ExtractorOptions {
  /** OpenAI API Key */
  apiKey: string;
  /** OpenAI API 基础地址（可选） */
  baseURL?: string;
  /** LLM 模型名称 */
  model: string;
  /** 系统提示词（可选） */
  systemPrompt?: string;
  /** 温度参数（可选） */
  temperature?: number;
}

/**
 * 提取的实体
 */
export interface ExtractedEntity {
  /** 实体类型 */
  type: string;
  /** 实体名称/值 */
  name: string;
  /** 置信度（可选） */
  confidence?: number;
  /** 实体属性（可选） */
  properties?: Record<string, unknown>;
}

/**
 * 提取的关系
 */
export interface ExtractedRelation {
  /** 源实体名称 */
  source: string;
  /** 目标实体名称 */
  target: string;
  /** 关系类型 */
  type: string;
  /** 置信度（可选） */
  confidence?: number;
  /** 关系属性（可选） */
  properties?: Record<string, unknown>;
}

/**
 * 提取结果
 */
export interface ExtractionResult {
  /** 提取到的实体列表 */
  entities: ExtractedEntity[];
  /** 提取到的关系列表 */
  relations: ExtractedRelation[];
  /** 原始文本 */
  text: string;
  /** 错误信息（如果有） */
  error?: string;
}

/**
 * 使用 LLM 进行实体和关系提取的类
 *
 * @example
 * ```typescript
 * const extractor = new Extractor({
 *   apiKey: "your-api-key",
 *   model: "gpt-4",
 *   systemPrompt: "你是一个提取专家"
 * });
 *
 * const result = await extractor.extract("今天北京的张三去上海参加了阿里巴巴举办的会议。");
 *
 * console.log(result.entities);
 * // [
 * //   { type: "地点", name: "北京" },
 * //   { type: "人物", name: "张三" },
 * //   { type: "地点", name: "上海" },
 * //   { type: "组织", name: "阿里巴巴" }
 * // ]
 *
 * console.log(result.relations);
 * // [
 * //   { source: "张三", target: "北京", type: "位于" },
 * //   { source: "张三", target: "上海", type: "前往" },
 * //   { source: "张三", target: "阿里巴巴", type: "参加" }
 * // ]
 * ```
 */
export class Extractor {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;
  private temperature?: number;

  constructor(options: ExtractorOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
    this.temperature = options.temperature;
    this.systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt();
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return `你是一个实体和关系提取专家。你的任务是从给定的文本中提取所有有意义的实体和它们之间的关系。

请提取以下内容：
1. 实体：自动识别实体类型（如人物、地点、组织、时间、事件、物品等）
2. 关系：实体之间的关系（如位于、前往、参加、拥有、属于、朋友、夫妻、互相认识等）

重要提示 - 双向关系：
- 如果两个实体之间的关系是相互的、双向的（如朋友、夫妻、互相认识、互相帮助、互相喜欢等），请分别创建两个方向的关系
- 例如："张三和李四是朋友" 应该提取为两条关系：
  - {source: "张三", target: "李四", type: "朋友"}
  - {source: "李四", target: "张三", type: "朋友"}

请以JSON对象格式返回结果，包含以下字段：
{
  "entities": [
    {
      "type": "实体类型",
      "name": "实体名称",
      "confidence": 可选，置信度 0-1
    }
  ],
  "relations": [
    {
      "source": "源实体名称",
      "target": "目标实体名称",
      "type": "关系类型",
      "confidence": 可选，置信度 0-1
    }
  ]
}

只返回JSON对象，不要包含任何其他文字。`;
  }

  /**
   * 从文本中提取实体和关系
   *
   * @param text - 要提取的文本
   * @returns 实体和关系提取结果
   */
  async extract(text: string): Promise<ExtractionResult> {
    try {
      // 构建用户提示词，让 LLM 自行决定实体类型和关系
      const userPrompt = `请从以下文本中提取所有有意义的实体和关系：\n\n${text}`;

      // 调用 OpenAI API
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: this.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: this.temperature,
      });

      // 解析结果
      const content = response.choices[0]?.message?.content;
      if (!content) {
        return {
          entities: [],
          relations: [],
          text,
          error: "LLM 返回为空",
        };
      }

      // 清理 JSON 输出（移除可能的 markdown 代码块标记）
      const jsonStr = content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      // 解析 JSON
      const parsed = JSON.parse(jsonStr);
      const entities: ExtractedEntity[] = Array.isArray(parsed)
        ? parsed
        : parsed.entities || [];
      const relations: ExtractedRelation[] = parsed.relations || [];

      return {
        entities,
        relations,
        text,
      };
    } catch (error) {
      return {
        entities: [],
        relations: [],
        text,
        error: error instanceof Error ? error.message : "未知错误",
      };
    }
  }
}
