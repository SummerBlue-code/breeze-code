import type {
  LLMMessage,
  LLMResponseNonStream,
  LLMResponseStream,
} from "@/LLM";
import type { StreamChunk, StreamState } from "@/LLM/streamState/IStreamState";
import type { NonStreamState } from "@/LLM/nonStreamState/INonStreamState";
import type {
  LLMMessageContent,
  LLMMessageToolCall,
} from "@/LLM/message/types";
import type {
  Tool,
  ToolCallInput,
  ToolMetadata,
} from "@/Agent/ToolManager/types";

export interface InterceptorContext {
  [key: string]: any;
}

export interface Interceptor<TArgs extends any[], TReturn> {
  /**
   * 在目标函数执行前调用
   * @returns 修改后的参数数组，或 false 表示中断
   */
  before?: (
    ctx: InterceptorContext,
    ...args: TArgs
  ) => TArgs | Promise<TArgs> | false | Promise<false>;

  /**
   * 在目标函数成功返回后调用（洋葱模型：逆序执行）
   */
  after?: (
    ctx: InterceptorContext,
    result: TReturn,
  ) => TReturn | Promise<TReturn>;

  /**
   * 在目标函数抛出错误时调用（从内向外）
   */
  onError?: (
    ctx: InterceptorContext,
    error: unknown,
  ) => TReturn | Promise<TReturn> | void;
}

export interface ToolInterceptor {
  beforeRegister?: (
    ctx: InterceptorContext,
    toolMetadata: ToolMetadata,
  ) => void;
  afterRegister?: (ctx: InterceptorContext, toolMetadata: ToolMetadata) => void;
  beforeExecute?: (
    ctx: InterceptorContext,
    toolMetadata: ToolMetadata,
    callInput: ToolCallInput,
  ) => void;
  afterExecute?: (
    ctx: InterceptorContext,
    toolMetadata: ToolMetadata,
    callInput: ToolCallInput,
    result: unknown,
  ) => void;
}

export interface StreamInterceptor {
  onRequestData?: (ctx: InterceptorContext, data: unknown) => unknown;
  onRawChunk?: (ctx: InterceptorContext, raw: unknown) => unknown;
  onStreamChunk?: (ctx: InterceptorContext, chunk: StreamChunk) => StreamChunk;
  onStateUpdate?: (
    ctx: InterceptorContext,
    state: Partial<StreamState>,
    chunk: StreamChunk,
  ) => Partial<StreamState>;
  onFinalResult?: (
    ctx: InterceptorContext,
    result: LLMResponseStream,
  ) => LLMResponseStream;
}

export interface NonStreamInterceptor {
  onRequestData?: (ctx: InterceptorContext, data: unknown) => unknown;
  onRawResponse?: (ctx: InterceptorContext, raw: unknown) => unknown;
  onStateUpdate?: (
    ctx: InterceptorContext,
    state: NonStreamState,
  ) => NonStreamState;
  onFinalResult?: (
    ctx: InterceptorContext,
    result: LLMResponseNonStream,
  ) => LLMResponseNonStream;
}

export interface MessageInterceptor {
  beforeAddUserMessage?: (
    ctx: InterceptorContext,
    content: LLMMessageContent,
  ) => LLMMessageContent | Promise<LLMMessageContent> | false | Promise<false>;
  afterAddUserMessage?: (ctx: InterceptorContext, message: LLMMessage) => void;

  beforeAddAssistantMessage?: (
    ctx: InterceptorContext,
    content: LLMMessageContent,
    toolCalls?: LLMMessageToolCall[],
  ) =>
    | { content: LLMMessageContent; toolCalls?: LLMMessageToolCall[] }
    | Promise<{ content: LLMMessageContent; toolCalls?: LLMMessageToolCall[] }>
    | false
    | Promise<false>;
  afterAddAssistantMessage?: (
    ctx: InterceptorContext,
    message: LLMMessage,
  ) => void;

  beforeAddToolMessage?: (
    ctx: InterceptorContext,
    toolCallId: string,
    content: LLMMessageContent,
  ) =>
    | { toolCallId: string; content: LLMMessageContent }
    | Promise<{ toolCallId: string; content: LLMMessageContent }>
    | false
    | Promise<false>;
  afterAddToolMessage?: (ctx: InterceptorContext, message: LLMMessage) => void;

  beforeSetSystemMessage?: (
    ctx: InterceptorContext,
    content: LLMMessageContent,
  ) => LLMMessageContent | Promise<LLMMessageContent> | false | Promise<false>;
  afterSetSystemMessage?: (
    ctx: InterceptorContext,
    content: LLMMessageContent,
  ) => void;
}
