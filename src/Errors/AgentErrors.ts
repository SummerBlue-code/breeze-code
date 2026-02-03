import { BaseError } from "./BaseError";

/**
 * Agent 决策与执行流程中的逻辑错误基类。
 *
 * 统一前缀：`AGENT_`
 * 此类错误通常表示**系统设计缺陷**或**异常状态**，需重点监控
 */
export class AgentError extends BaseError {
  constructor(
    message: string,
    code: string,
    metadata: Record<string, unknown> = {},
  ) {
    super(message, `AGENT_${code}`, metadata);
  }
}

export class AgentConfigError extends AgentError {
  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super(message, `CONFIG_ERROR`, metadata);
  }
}
