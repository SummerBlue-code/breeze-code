import { BaseError } from "./BaseError";

/**
 * 底层基础设施错误基类（数据库、缓存、消息队列等）。
 *
 * 统一前缀：`SYS_`
 * 此类错误通常需要运维介入
 */
export class SystemError extends BaseError {
  constructor(
    message: string,
    code: string,
    metadata: Record<string, unknown> = {},
  ) {
    super(message, `SYS_${code}`, metadata);
  }
}

/**
 * 数据库连接失败。
 *
 * **错误码**：`SYS_DB_CONNECTION_FAILED`
 * **应对策略**：
 * - 重试连接（带指数退避）
 * - 切换只读副本
 * - 返回服务降级提示
 *
 * @param dbName - 数据库名称或标识
 * @param originalError - 原始连接错误
 */
export class DatabaseConnectionError extends SystemError {
  constructor(dbName: string, originalError: Error) {
    super(
      `无法连接数据库 ${dbName}, 原因如下: ${originalError.message}`,
      "DB_CONNECTION_FAILED",
      {
        dbName,
        originalError: originalError.message,
      },
    );
  }
}

/**
 * 缓存操作（GET/SET）失败。
 *
 * **错误码**：`SYS_CACHE_OPERATION_FAILED`
 * **注意**：缓存失败通常应降级（继续执行主逻辑），而非中断
 *
 * @param operation - 操作类型（"GET" 或 "SET"）
 * @param key - 缓存键
 * @param originalError - 原始错误
 */
export class CacheError extends SystemError {
  constructor(operation: "GET" | "SET", key: string, originalError: Error) {
    super(
      `针对缓存 ${key} 键的 ${operation} 操作失败`,
      "CACHE_OPERATION_FAILED",
      { operation, key, originalError: originalError.message },
    );
  }
}
