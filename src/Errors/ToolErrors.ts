import { BaseError } from "./BaseError";

/**
 * 所有工具（Tool）执行相关错误的基类。
 *
 * 统一前缀：`TOOL_`
 * 工具指 Agent 可调用的外部能力（如搜索、数据库、API）
 *
 * @param toolName - 工具名称（必须与注册名一致）
 * @param message - 错误描述
 * @param code - 子错误码（如 `VALIDATION_ERROR`）
 * @param metadata - 工具特定上下文
 */
export class ToolError extends BaseError {
  constructor(
    toolName: string,
    message: string,
    code: string,
    metadata: Record<string, unknown> = {},
  ) {
    super(message, `TOOL_${code}`, { toolName, ...metadata });
  }
}

/**
 * 工具参数校验失败。
 *
 * **错误码**：`TOOL_VALIDATION_ERROR`
 * **触发条件**：
 * - 参数缺失
 * - 类型不匹配
 * - 值超出范围（如日期格式错误）
 *
 * **应对策略**：
 * - 让 LLM 重新生成参数
 * - 返回结构化错误给前端高亮提示
 *
 * @param toolName - 工具名称
 * @param field - 出错的参数字段名
 * @param reason - 具体校验失败原因
 */
export class ToolValidationError extends ToolError {
  constructor(toolName: string, origin_error: Error) {
    super(
      toolName,
      `${toolName} 工具的参数校验失败, 失败原因: ${origin_error.message}`,
      "VALIDATION_ERROR",
      { toolName, origin_error: origin_error.message },
    );
  }
}

/**
 * 工具执行过程中发生运行时错误。
 *
 * **错误码**：`TOOL_EXECUTION_FAILED`
 * **典型场景**：
 * - 网络请求失败
 * - 第三方 API 返回 5xx
 * - 数据库连接中断
 *
 * **应对策略**：
 * - 重试（幂等操作）
 * - 降级到备用工具
 * - 记录失败并继续（非关键路径）
 *
 * @param toolName - 工具名称
 * @param originalError - 原始错误对象（如 AxiosError）
 * @param params - 调用时的参数（自动安全序列化并截断）
 */
export class ToolExecutionError extends ToolError {
  constructor(
    toolName: string,
    originalError: Error,
    params?: Record<string, unknown>,
  ) {
    super(
      toolName,
      `${toolName} 工具执行失败, 输入参数: ${JSON.stringify(params)}, 失败原因: ${originalError.message}`,
      "EXECUTION_FAILED",
      {
        params: params
          ? JSON.parse(JSON.stringify(params, null, 2).slice(0, 500))
          : undefined, // 安全序列化
        originalError: originalError.message,
        stack: originalError.stack?.split("\n").slice(0, 3),
      },
    );
  }
}

/**
 * 工具未启用错误类
 * 继承自ToolError，用于表示工具未启用时的错误情况
 */
export class ToolNotEnabled extends ToolError {
  /**
   * 构造函数
   * @param toolName - 工具名称，用于标识哪个工具未启用
   */
  constructor(toolName: string) {
    super(toolName, `${toolName} 工具未启用`, "UNENABLED");
  }
}

export class ToolNotFound extends ToolError {
  constructor(toolName: string) {
    super(toolName, `${toolName} 工具未找到}`, "NOT_FOUND");
  }
}
export class ToolAlreadyExists extends ToolError {
  constructor(toolName: string) {
    super(toolName, `${toolName} 工具已存在}`, "ALREADY_EXISTS");
  }
}
