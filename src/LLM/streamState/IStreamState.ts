import type { LLMFinishReason, LLMUsage } from "..";

export interface StreamChunk {
  /** 完整的文本内容 */
  content?: string;
  /** 完整的工具调用 */
  tool_calls?: {
    /** LLM 给本次工具调用赋予的 id */
    id?: string;
    /** 工具调用的函数名 */
    name?: string;
    /** 工具调用的函数的输入参数(JSON格式) */
    input?: string | null;
  }[];
  /** LLM的结束原因 */
  finish_reason?: LLMFinishReason;
  /** 本次对话 LLM 使用的 tokens 详情 */
  usage?: LLMUsage;
  /** LLM的原始响应 */
  rawChunk: unknown;
}

export interface StreamState {
  /** 完整的文本内容 */
  content?: string;
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
  usage: LLMUsage;
  /** LLM的原始响应 */
  rawChunks: unknown[];
}
