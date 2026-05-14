/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志元数据
 */
export interface LogMetadata {
  error?: Error;
  [key: string]: unknown;
}

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  component?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 日志配置
 */
export interface LoggerConfig {
  level: LogLevel;
  format?: "json" | "text";
}

/**
 * 日志记录器接口
 */
export interface ILogger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  withRequestId(requestId: string): ILogger;
  withComponent(component: string): ILogger;
  getLogs(): LogEntry[];
  clear(): void;
  setLevel(level: LogLevel): void;
}

/**
 * 日志选项
 */
interface LogOptions {
  requestId?: string;
  component?: string;
}

/**
 * 子日志记录器
 * 继承父Logger的上下文（requestId, component）
 */
class ChildLogger implements ILogger {
  constructor(
    private parent: Logger,
    private requestId?: string,
    private component?: string,
  ) {}

  private log(level: LogLevel, message: string, metadata?: LogMetadata): void {
    const options: LogOptions = {};
    if (this.requestId) {
      options.requestId = this.requestId;
    }
    if (this.component) {
      options.component = this.component;
    }
    this.parent.log(level, message, options, metadata);
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.log("debug", message, metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.log("warn", message, metadata);
  }

  error(message: string, metadata?: LogMetadata): void {
    this.log("error", message, metadata);
  }

  withRequestId(requestId: string): ILogger {
    return new ChildLogger(this.parent, requestId, this.component);
  }

  withComponent(component: string): ILogger {
    return new ChildLogger(this.parent, this.requestId, component);
  }

  getLogs(): LogEntry[] {
    return this.parent.getLogs();
  }

  clear(): void {
    this.parent.clear();
  }

  setLevel(level: LogLevel): void {
    this.parent.setLevel(level);
  }
}

/**
 * 日志记录器
 */
export class Logger implements ILogger {
  private logs: LogEntry[] = [];
  private requestIdCounter = 0;
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = {
      ...config,
      level: config.level || "info",
      format: config.format || "text",
    };
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * 获取日志级别
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * 检查是否应该记录该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const configLevel = levels.indexOf(this.config.level);
    const messageLevel = levels.indexOf(level);
    return messageLevel >= configLevel;
  }

  /**
   * 日志方法
   */
  public log(
    level: LogLevel,
    message: string,
    options: LogOptions,
    metadata?: LogMetadata,
  ): void {
    // 检查日志级别
    if (!this.shouldLog(level)) {
      return;
    }

    // 创建日志条目
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: options.requestId,
      component: options.component,
      metadata,
    };

    // 添加到日志数组
    this.logs.push(entry);

    // 输出
    this.output(entry);
  }

  /**
   * 输出日志
   */
  private output(entry: LogEntry): void {
    if (this.config.format === "json") {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      console.log(this.formatText(entry));
    }
  }

  /**
   * 格式化文本输出
   */
  private formatText(entry: LogEntry): string {
    const parts: string[] = [
      `[${entry.timestamp}]`,
      `[${entry.level.toUpperCase()}]`,
    ];

    if (entry.component) {
      parts.push(`[${entry.component}]`);
    }

    if (entry.requestId) {
      parts.push(entry.requestId);
    }

    parts.push("-", entry.message);

    if (entry.metadata) {
      const metaStr = Object.entries(entry.metadata)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(", ");
      if (metaStr) {
        parts.push(`{ ${metaStr} }`);
      }
    }

    return parts.join(" ");
  }

  /**
   * 记录调试信息
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.log("debug", message, {}, metadata);
  }

  /**
   * 记录一般信息
   */
  info(message: string, metadata?: LogMetadata): void {
    this.log("info", message, {}, metadata);
  }

  /**
   * 记录警告信息
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.log("warn", message, {}, metadata);
  }

  /**
   * 记录错误信息
   */
  error(message: string, metadata?: LogMetadata): void {
    this.log("error", message, {}, metadata);
  }

  /**
   * 创建带请求ID的子Logger
   */
  withRequestId(requestId: string): ILogger {
    return new ChildLogger(this, requestId);
  }

  /**
   * 创建带组件名的子Logger
   */
  withComponent(component: string): ILogger {
    return new ChildLogger(this, undefined, component);
  }

  /**
   * 获取所有日志
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * 清理日志
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * 获取日志数量
   */
  getLogCount(): number {
    return this.logs.length;
  }

  /**
   * 根据级别过滤日志
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((entry) => entry.level === level);
  }

  /**
   * 根据请求ID过滤日志
   */
  getLogsByRequestId(requestId: string): LogEntry[] {
    return this.logs.filter((entry) => entry.requestId === requestId);
  }

  /**
   * 根据组件名过滤日志
   */
  getLogsByComponent(component: string): LogEntry[] {
    return this.logs.filter((entry) => entry.component === component);
  }
}

/**
 * 创建默认日志记录器
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return new Logger({
    level: "info",
    format: "text",
    ...config,
  });
}
