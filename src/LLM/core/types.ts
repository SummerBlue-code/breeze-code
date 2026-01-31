/**
 * LLM 流式响应结束原因
 *
 * 统一的结束原因类型，将不同LLM接口的值映射为统一标准。
 */
export type LLMFinishReason =
  | "stop" // 正常完成
  | "stop_sequence" // 遇到停止序列
  | "max_tokens" // 达到最大 token 数
  | "tool_calls" // 工具调用
  | "refusal"; // 内容被拒绝

/**
 * LLM Token 使用统计
 */
export interface LLMUsage {
  /** 提示词 tokens */
  prompt_tokens: number;
  /** 完成 tokens */
  completion_tokens: number;
  /** 总 tokens */
  total_tokens: number;
}

/**
 * 统一的 LLM 非流式响应
 *
 * 将不同LLM接口的响应格式映射为统一标准。
 */
export type LLMResponseNonStream = {
  /** 完整的文本内容 */
  content?: string | null;
  /** 完整的工具调用 */
  tool_calls?: {
    /** LLM 给本次工具调用赋予的 id */
    id: string;
    /** 工具调用的函数名 */
    name: string;
    /** 工具调用的函数的输入参数(JSON格式) */
    input?: string | null;
  }[];
  /** LLM的结束原因 */
  finish_reason?: LLMFinishReason;
  /** 本次对话 LLM 使用的 tokens 详情 */
  usage?: LLMUsage;
};

export type LLMResponseStream = {
  /** 完整的文本内容 */
  content?: string | null;
  /** 完整的工具调用 */
  tool_calls?: {
    /** LLM 给本次工具调用赋予的 id */
    id: string;
    /** 工具调用的函数名 */
    name: string;
    /** 工具调用的函数的输入参数(JSON格式) */
    input?: string | null;
  }[];
  /** LLM的结束原因 */
  finish_reason?: LLMFinishReason;
  /** 本次对话 LLM 使用的 tokens 详情 */
  usage?: LLMUsage;
};
