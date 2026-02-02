// ───────────────────────────────────────
// 【上下文】：每个工具调用时传入的运行时环境

import type { ZodType } from "zod";

// ───────────────────────────────────────
export interface ToolContext {
  [key: string]: any;
}

// ───────────────────────────────────────
// 【工具元数据】：描述工具的信息，供 LLM 理解
// 兼容 OpenAI function_call 格式
// ───────────────────────────────────────
export interface ToolMetadata {
  name: string; // 工具唯一标识，如 "get_weather"
  description: string; // 工具用途描述
  ZodSchema: ZodType; // JSON Schema，描述输入参数结构
  required?: string[]; // 必填字段列表
  enabled?: boolean; // 是否启用（可动态开关）
}

// ───────────────────────────────────────
// 【工具函数类型】：所有工具必须符合此签名
// ───────────────────────────────────────
export type ToolFunction<TArgs = any, TReturn = any> = (
  args: TArgs,
  ctx: ToolContext,
) => Promise<TReturn> | TReturn;

// ───────────────────────────────────────
// 【完整工具对象】：元数据 + 可执行函数
// ───────────────────────────────────────
export interface Tool<TArgs = any, TReturn = any> extends ToolMetadata {
  fn: ToolFunction<TArgs, TReturn>; // 实际执行逻辑
}

// ───────────────────────────────────────
// 【LLM 调用指令】：LLM 决定调用工具时生成的结构
// ───────────────────────────────────────
export interface ToolCallInput {
  name: string; // 工具名
  arguments?: Record<string, any>; // 参数（JSON 对象）
}
