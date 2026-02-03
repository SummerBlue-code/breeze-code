// ToolManager.ts
import { z, ZodType } from "zod";
import type { Tool, ToolContext, ToolMetadata, ToolCallInput } from "./types";
import type { ToolInterceptor } from "@/Interceptor/types";
import {
  ToolExecutionError,
  ToolNotFound,
  ToolNotEnabled,
  ToolValidationError,
  ToolAlreadyExists,
} from "@/Errors/ToolErrors";

/**
 * 🧰 LLM Agent 工具管理器
 *
 * 职责：
 * 1. 注册工具（带类型校验）
 * 2. 生成 LLM 可读的工具描述（function_call schema）
 * 3. 安全校验并执行工具调用
 * 4. 支持权限控制、动态开关、可观测性
 */
export class ToolManager {
  // ───────────────────────────────────────
  // 【内部存储】：用 Map 存储所有注册的工具
  // key = 工具名，value = 完整工具对象
  // ───────────────────────────────────────
  private tools = new Map<string, Tool>();

  private toolInterceptors: ToolInterceptor[] = [];

  register<TArgs extends Record<string, any>, TReturn>(
    name: string,
    description: string,
    ZodSchema: ZodType<TArgs>,
    fn: (args: TArgs, ctx: ToolContext) => Promise<TReturn> | TReturn,
    options: { enabled?: boolean } = {},
  ): void {
    const interceptorContext = {};
    /**
     * 如果工具已经注册，抛出错误
     */
    if (this.tools.has(name)) {
      throw new ToolAlreadyExists(name);
    }

    const tool: Tool = {
      name,
      description,
      ZodSchema,
      fn, // 可执行函数
      enabled: options.enabled ?? true, // 默认启用
    };

    const toolMetadata: ToolMetadata = {
      name: tool.name,
      description: tool.description,
      ZodSchema: tool.ZodSchema,
      enabled: tool.enabled,
    };

    for (const interceptor of this.toolInterceptors) {
      if (interceptor.beforeRegister) {
        interceptor.beforeRegister(interceptorContext, toolMetadata);
      }
    }

    /**
     * 将工具注册到 Map 中
     */
    this.tools.set(name, tool);

    for (const interceptor of this.toolInterceptors) {
      if (interceptor.afterRegister) {
        interceptor.afterRegister(interceptorContext, toolMetadata);
      }
    }
  }

  /**
   * 获取所有启用的工具，不会返回工具函数本身，以免泄漏工具实现
   * @returns
   */
  getEnabledTools(): ToolMetadata[] {
    return Array.from(this.tools.values())
      .filter((tool) => tool.enabled) // 只返回启用的
      .map(({ fn, ...meta }) => meta); // 剥离函数
  }

  // ───────────────────────────────────────
  // 【执行单个工具调用】—— 核心方法！
  //
  // 流程：
  // 1. 查找工具
  // 2. 检查启用状态
  // 3. 检查权限
  // 4. 校验参数（TODO: 用 Zod 校验）
  // 5. 执行函数
  // 6. 错误处理
  // ───────────────────────────────────────
  async execute(call: ToolCallInput, ctx: ToolContext): Promise<any> {
    const interceptorContext = {};

    // 1️⃣ 查找工具
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new ToolNotFound(call.name);
    }

    // 2️⃣ 检查是否启用
    if (!tool.enabled) {
      throw new ToolNotEnabled(tool.name);
    }

    // 4️⃣ 参数校验
    let validatedArgs: any;
    try {
      validatedArgs = tool.ZodSchema.parse(call.arguments);
    } catch (e) {
      throw new ToolValidationError(tool.name, e as Error);
    }

    const toolMetadata: ToolMetadata = {
      name: tool.name,
      description: tool.description,
      ZodSchema: tool.ZodSchema,
      enabled: tool.enabled,
    };

    for (const interceptor of this.toolInterceptors) {
      if (interceptor.beforeExecute) {
        interceptor.beforeExecute(interceptorContext, toolMetadata, call);
      }
    }

    // 5️⃣ 执行工具函数
    try {
      const result = await tool.fn(validatedArgs, ctx);
      for (const interceptor of this.toolInterceptors) {
        if (interceptor.afterExecute) {
          interceptor.afterExecute(
            interceptorContext,
            toolMetadata,
            call,
            result,
          );
        }
      }
      return result;
    } catch (e) {
      throw new ToolExecutionError(tool.name, e as Error, validatedArgs);
    }
  }

  useToolInterceptor(interceptor: ToolInterceptor) {
    this.toolInterceptors.push(interceptor);
  }
}
