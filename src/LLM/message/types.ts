/**
 * 统一的消息角色类型
 *
 * @remarks
 * | 角色 | 用途 | 示例 |
 * |------|------|------|
 * | `user` | 用户消息，发送给 LLM 的输入 | "今天天气怎么样？" |
 * | `assistant` | LLM 的回复消息，可能包含 tool_calls | "让我帮您查一下..." |
 * | `system` | 系统提示词，设置 LLM 行为规范 | "你是一个有用的助手" |
 * | `tool` | 工具执行结果，需要通过 tool_call_id 关联 | '{"temp": 25}' |
 *
 * @remarks
 * - 消息流通常: user → assistant → (tool_calls) → tool → assistant → ...
 * - system 消息通常只在对话开始时设置一次
 * - tool 消息必须搭配 tool_call_id 使用
 */
export type LLMMessageRole = "user" | "assistant" | "system" | "tool";

/**
 * 统一的消息内容类型
 *
 * 用于表示消息内容，支持纯文本和多模态（图文混合）形式。
 * 可转换为各 Provider（OpenAI、Anthropic 等）的消息格式。
 *
 * @example 纯文本（最常用）
 * "你好"
 *
 * @example 结构化文本
 * { type: "text", text: "你好" }
 *
 * @example 图片
 * { type: "image", source: { type: "url", url: "https://..." } }
 *
 * @remarks
 * | 类型 | 说明 |
 * |------|------|
 * | `string` | 纯文本内容，推荐用于简单文本场景 |
 * | `{type: "text"}` | 结构化文本块，用于多模态场景 |
 * | `{type: "image"}` | 图片内容，用于多模态场景 |
 *
 * @remarks
 * - 当 content 为数组时（多模态场景），必须使用结构化对象形式
 * - 简单文本场景优先使用 `string`，更简洁
 */
export type LLMMessageContent =
  | string
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      source: {
        type: "url";
        url: string;
      };
    };

/**
 * 统一的工具调用消息
 *
 * 当 LLM 需要调用工具时，会在 assistant 消息中包含类型为 LLMMessageToolCall[] 的 tool_calls 数组。
 *
 * @example 单个工具调用
 * {
 *   id: "call_abc123",
 *   name: "getWeather",
 *   input: '{"city":"北京","unit":"celsius"}'
 * }
 *
 * @remarks
 * | 字段 | 类型 | 说明 |
 * |------|------|------|
 * | `id` | string | 工具调用的唯一标识，用于关联工具响应（tool_call_id） |
 * | `name` | string | 要调用的函数/工具名称 |
 * | `input` | string 或 null | JSON 字符串格式的参数 |
 *
 * @remarks
 * - input 必须是字符串形式的 JSON，需要手动 `JSON.parse()` 解析
 * - tool 消息的 tool_call_id 必须与此 id 匹配
 * - 一次响应可能包含多个 tool_call
 */
export type LLMMessageToolCall = {
  /** LLM 给本次工具调用赋予的 id */
  id: string;
  /** 工具调用的函数名 */
  name: string;
  /** 工具调用的函数的输入参数(JSON格式) */
  input?: string | null;
};

/**
 * 统一的消息格式
 *
 * @example 简单文本消息（user/system/assistant）
 * { role: "user", content: "你好" }
 * { role: "system", content: "你是一个助手" }
 * { role: "assistant", content: "你好！" }
 *
 * @example 多模态消息（图文混合）
 * {
 *   role: "user",
 *   content: [
 *     { type: "text", text: "这张图是什么？" },
 *     { type: "image", source: { type: "url", url: "https://..." } }
 *   ]
 * }
 *
 * @example 工具调用消息（assistant）
 * {
 *   role: "assistant",
 *   content: "让我查一下天气",
 *   tool_calls: [
 *     { id: "call_123", type: "function", function: { name: "getWeather", arguments: '{"city":"北京"}' } }
 *   ]
 * }
 *
 * @example 工具响应消息（tool）
 * {
 *   role: "tool",
 *   tool_call_id: "call_123",
 *   content: '{"temp":25,"weather":"晴天"}'
 * }
 *
 * @remarks
 * - content: 可以是简单字符串（文本）或结构化对象数组（多模态）
 * - tool_calls: 仅 role="assistant" 时使用，表示 LLM 请求调用工具
 * - tool_call_id: 仅 role="tool" 时使用，用于关联对应的 tool_calls.id
 */
export type LLMMessage = {
  role: LLMMessageRole;
  content: LLMMessageContent | LLMMessageContent[];
  tool_calls?: LLMMessageToolCall[];
  tool_call_id?: string;
};

export type OpenAIMessageRole = "user" | "assistant" | "system" | "tool";
export type OpenAIMessageToolCall = {
  id: string;
  type: "function";
  function: {
    arguments: string;
    name: string;
  };
};
export type OpenAIMessage = {
  role: OpenAIMessageRole;
  content?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIMessageToolCall[];
};
