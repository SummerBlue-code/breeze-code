/**
 * Agent 系统中所有自定义错误的基类。
 *
 * 该类提供统一的错误结构，确保：
 * - 每个错误具有**语义化错误码**（code），便于监控与告警分类
 * - 携带**结构化元数据**（metadata），用于调试与上下文还原
 * - 保留**原始错误链**（cause），支持嵌套错误追踪（ES2022 标准）
 * - 支持**安全序列化**（toJSON），适用于日志、监控上报
 *
 * ✅ 最佳实践：
 * - 所有业务/系统错误必须继承此类
 * - 避免直接抛出 `Error` 或字符串
 * - metadata 中不应包含敏感信息（如密码、token）
 *
 * @example
 * ```ts
 * throw new AppError('Database unreachable', 'DB_UNREACHABLE', { host: 'db.example.com' });
 * ```
 */
export abstract class BaseError extends Error {
  /**
   * 构造函数
   *
   * @param message - 人类可读的错误描述（用于日志/UI 提示）
   * @param code - 机器可读的唯一错误码，格式：`领域_子类_具体`（如 `AGENT_LOOP_DETECTED`）
   * @param metadata - 结构化上下文数据，用于调试、监控、恢复决策（自动注入 timestamp 和精简堆栈）
   * @param cause - 原始错误对象（用于保留调用链，支持 `error.cause` 访问）
   */
  constructor(
    message: string,
    public code: string, // 机器可读错误码，如 'LLM_TIMEOUT'
    public metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    // 修复 TypeScript 原型链问题
    Object.setPrototypeOf(this, new.target.prototype);

    // 自动注入通用上下文
    this.metadata = {
      timestamp: new Date().toISOString(),
      stack: this.stack?.split("\n").slice(0, 5), // 精简堆栈
      ...metadata,
    };
  }

  /**
   * 将错误转换为安全的 JSON 对象，适用于：
   * - 日志记录（如 Winston、Pino）
   * - 监控上报（如 Sentry、Datadog）
   * - API 错误响应（需脱敏后）
   *
   * ⚠️ 注意：不会暴露原始 `cause` 的完整堆栈，仅保留消息
   *
   * @returns 包含 name、message、code、metadata 和简化 cause 的对象
   */
  toJSON(): {
    name: string;
    message: string;
    code: string;
    metadata: Record<string, unknown>;
    cause?:
      | {
          name: string;
          message: string;
          code: string;
          metadata: Record<string, unknown>;
          cause?: any;
        }
      | { message: string };
  } {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      metadata: this.metadata,
    };
  }
}
