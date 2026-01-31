/**
 * Converter 公共工具模块
 *
 * 提供各转换器共享的常量和工具函数。
 *
 * @module Converter/common
 */

import type { LLMFinishReason } from "..";

/**
 * OpenAI finish_reason 映射表
 *
 * 将 OpenAI 特定的 finish_reason 映射为统一的标准值。
 *
 * @remarks
 * **OpenAI 映射规则**：
 * - `stop` → `stop`
 * - `length` → `max_tokens`
 * - `tool_calls` → `tool_calls`
 * - `content_filter` → `refusal`
 *
 * @example
 * ```typescript
 * const reason = OPENAI_FINISH_REASON_MAP["length"];
 * // reason === "max_tokens"
 * ```
 */
export const OPENAI_FINISH_REASON_MAP: Record<string, LLMFinishReason> = {
  stop: "stop",
  length: "max_tokens",
  tool_calls: "tool_calls",
  content_filter: "refusal",
};
