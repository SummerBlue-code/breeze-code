import type { LLMResponseStream, LLMResponseNonStream, LLMMessage } from "..";
import type { StreamChunk, StreamState } from "../streamState/IStreamState";
import type { NonStreamState } from "../nonStreamState/INonStreamState";
import type {
  InterceptorContext,
  NonStreamInterceptor,
  StreamInterceptor,
} from "@/Interceptor/types";
import type { MessageManager } from "@/Agent/MessageManager/MessageManager";
import type { ToolManager } from "@/Agent/ToolManager/ToolManager";
import type { ToolMetadata } from "@/Agent/ToolManager/types";

export abstract class BaseLLM {
  protected nonStreamInterceptors: NonStreamInterceptor[] = [];
  protected streamInterceptors: StreamInterceptor[] = [];

  abstract converterMessage(messages: LLMMessage): unknown;
  abstract convertToolSchema(toolMetadata: ToolMetadata): unknown;

  abstract buildRequestData(
    manager: MessageManager,
    model: string,
    stream: boolean,
    tools?: unknown,
  ): unknown;
  abstract getRawResponse(requestData: unknown): Promise<unknown>;

  abstract createNonStreamState(rawResponse: unknown): NonStreamState;

  protected getLLMResponseNonStream(NonStreamState: NonStreamState) {
    const result: LLMResponseNonStream = {};
    if (NonStreamState.content) {
      result.content = NonStreamState.content;
    }
    if (NonStreamState.tool_calls) {
      result.tool_calls = NonStreamState.tool_calls;
    }
    if (NonStreamState.finish_reason) {
      result.finish_reason = NonStreamState.finish_reason;
    }
    if (NonStreamState.usage) {
      result.usage = NonStreamState.usage;
    }
    return result;
  }

  async generateNonStream(
    messageManager: MessageManager,
    model: string,
    tools?: ToolManager,
  ): Promise<LLMResponseNonStream> {
    /**
     * 初始化拦截器的context
     */
    const context: InterceptorContext = {};
    /**
     * 获取requestData
     */
    const requestData = this.buildRequestData(
      messageManager,
      model,
      false,
      tools,
    );
    /**
     * 定义处理后的requestData
     */
    let processedRequestData = requestData;
    /**
     * 调用requestData的拦截器
     */
    for (const interceptor of this.nonStreamInterceptors) {
      if (interceptor.onRequestData)
        processedRequestData = await interceptor.onRequestData(
          context,
          processedRequestData,
        );
    }
    /**
     * 使用处理后的requestData获取rawResponse
     */
    const rawResponse = await this.getRawResponse(processedRequestData);
    /**
     * 定义处理后的rawResponse
     */
    let processedRawResponse = rawResponse;
    /**
     * 调用rawResponse的拦截器
     */
    for (const interceptor of this.nonStreamInterceptors) {
      if (interceptor.onRawResponse)
        processedRawResponse = await interceptor.onRawResponse(
          context,
          processedRawResponse,
        );
    }
    /**
     * 将处理后的rawResponse转换为NonStreamState
     */
    const NonStreamState: NonStreamState =
      this.createNonStreamState(processedRawResponse);
    /**
     * 定义处理后的NonStreamState
     */
    let processedNonStreamState = NonStreamState;
    /**
     * 调用NonStreamState的拦截器
     */
    for (const interceptor of this.nonStreamInterceptors) {
      if (interceptor.onStateUpdate)
        processedNonStreamState = await interceptor.onStateUpdate(
          context,
          processedNonStreamState,
        );
    }
    /**
     * 将处理后的NonStreamState转换为LLMResponseNonStream
     */
    const result = this.getLLMResponseNonStream(processedNonStreamState);
    /**
     * 定义处理后的LLMResponseNonStream
     */
    let processedResult = result;
    /**
     * 调用LLMResponseNonStream的拦截器
     */
    for (const interceptor of this.nonStreamInterceptors) {
      if (interceptor.onFinalResult)
        processedResult = await interceptor.onFinalResult(
          context,
          processedResult,
        );
    }
    return processedResult;
  }

  useNonStreamInterceptor(interceptor: NonStreamInterceptor) {
    this.nonStreamInterceptors.push(interceptor);
  }

  abstract getRawStream(requestData: unknown): Promise<unknown>;

  abstract createStreamChunk(rawChunk: unknown): StreamChunk;

  updateStreamState(
    streamState: Partial<StreamState>,
    streamChunk: StreamChunk,
  ) {
    /**
     * 初始化streamState副本
     */
    const streamStateCopy: Partial<StreamState> = {};
    /**
     * 更新content
     */
    // 判断streamChunk中是否有content
    let newContent;
    if (streamState.content) {
      newContent = streamState.content;
    }
    if (streamChunk.content) {
      if (streamState.content) {
        newContent = streamState.content + streamChunk.content;
      } else {
        newContent = streamChunk.content;
      }
    }
    // 正式更新content
    if (newContent) {
      streamStateCopy.content = newContent;
    }
    /**
     * 更新tool_calls
     */
    // 判断streamChunk中是否有tool_calls
    let newToolCalls:
      | {
          id: string;
          name: string;
          input?: string | undefined;
        }[]
      | undefined = undefined;
    if (streamState.tool_calls) {
      newToolCalls = [...streamState.tool_calls];
    } else {
      newToolCalls = [];
    }
    if (streamChunk.tool_calls) {
      for (const [index, tool_call] of streamChunk.tool_calls.entries()) {
        const existing = newToolCalls[index] || { id: "", name: "", input: "" };

        const updatedToolCall = {
          id: tool_call.id ?? existing.id,
          name: tool_call.name ?? existing.name,
          input: existing.input + (tool_call.input ?? ""),
        };
        newToolCalls[index] = updatedToolCall;
      }
    }
    // 正式更新tool_calls
    if (newToolCalls.length > 0) {
      streamStateCopy.tool_calls = newToolCalls;
    }
    /**
     * 更新finish_reason
     */
    // 判断streamChunk中是否有finish_reason
    let newFinishReason;
    if (streamChunk.finish_reason) {
      newFinishReason = streamChunk.finish_reason;
    }
    // 正式更新finish_reason
    if (newFinishReason) {
      streamStateCopy.finish_reason = newFinishReason;
    }
    /**
     * 更新usage
     */
    // 判断streamChunk中是否有usage
    let newUsage;
    if (streamChunk.usage) {
      if (streamState.usage) {
        newUsage = {
          prompt_tokens: streamState.usage.prompt_tokens,
          completion_tokens: streamState.usage.completion_tokens,
          total_tokens: streamState.usage.total_tokens,
        };
      } else {
        newUsage = {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        };
      }
      if (streamChunk.usage.prompt_tokens) {
        newUsage.prompt_tokens += streamChunk.usage.prompt_tokens;
      }
      if (streamChunk.usage.completion_tokens) {
        newUsage.completion_tokens += streamChunk.usage.completion_tokens;
      }
      if (streamChunk.usage.total_tokens) {
        newUsage.total_tokens += streamChunk.usage.total_tokens;
      }
    }
    // 正式更新usage
    if (newUsage) {
      streamStateCopy.usage = newUsage;
    }
    /**
     * 更新rawChunks
     */
    // 判断streamState中是否有rawChunk
    let newRawChunks;
    if (streamState.rawChunks) {
      newRawChunks = [...streamState.rawChunks, streamChunk.rawChunk];
    } else {
      newRawChunks = [streamChunk.rawChunk];
    }
    // 正式更新rawChunks
    streamStateCopy.rawChunks = newRawChunks;

    /**
     * 返回streamState副本
     */
    return streamStateCopy as StreamState;
  }

  protected getLLMResponseStream(streamState: Partial<StreamState>) {
    const result: LLMResponseStream = {};
    /**
     * 将streamState的状态赋值给LLMResponseStream
     */
    if (streamState.content) {
      result.content = streamState.content;
    }
    if (streamState.tool_calls) {
      result.tool_calls = streamState.tool_calls;
    }
    if (streamState.finish_reason) {
      result.finish_reason = streamState.finish_reason;
    }
    if (streamState.usage) {
      result.usage = streamState.usage;
    }
    return result;
  }

  async *generateStream(
    messageManager: MessageManager,
    model: string,
    tools?: ToolManager,
  ): AsyncGenerator<StreamChunk | LLMResponseStream> {
    /**
     * 初始化拦截器的context
     */
    const context: InterceptorContext = {};
    /**
     * 初始化streamState
     */
    let streamState: Partial<StreamState> = {};
    /**
     * 获取requestData
     */
    const requestData = this.buildRequestData(
      messageManager,
      model,
      true,
      tools,
    );
    /**
     * 定义处理后的requestData
     */
    let processedRequestData = requestData;
    /**
     * 调用requestData的拦截器
     */
    for (const interceptor of this.streamInterceptors) {
      if (interceptor.onRequestData)
        processedRequestData = await interceptor.onRequestData(
          context,
          processedRequestData,
        );
    }
    /**
     * 使用处理后的requestData获取rawStream
     */
    const rawStream = await this.getRawStream(processedRequestData);

    for await (const rawChunk of rawStream as AsyncGenerator<unknown>) {
      /**
       * 定义处理后的rawChunk变量
       */
      let processedRawChunk = rawChunk;
      /**
       * 调用RawChunk的拦截器
       */
      for (const interceptor of this.streamInterceptors) {
        if (interceptor.onRawChunk)
          processedRawChunk = await interceptor.onRawChunk(
            context,
            processedRawChunk,
          );
      }
      /**
       * 将处理后的rawChunk转换为StreamChunk
       */
      const streamChunk: StreamChunk =
        this.createStreamChunk(processedRawChunk);
      /**
       * 定义处理后的streamChunk变量
       */
      let processedStreamChunk = streamChunk;
      /**
       * 调用StreamChunk的拦截器
       */
      for (const interceptor of this.streamInterceptors) {
        if (interceptor.onStreamChunk)
          processedStreamChunk = await interceptor.onStreamChunk(
            context,
            processedStreamChunk,
          );
      }
      /**
       * 使用处理后的streamChunk更新streamState的状态
       */
      streamState = this.updateStreamState(streamState, processedStreamChunk);
      /**
       * 定义处理后的streamState变量
       */
      let processedStreamState = streamState;
      /**
       * 调用StreamState的拦截器
       */
      for (const interceptor of this.streamInterceptors) {
        if (interceptor.onStateUpdate)
          processedStreamState = await interceptor.onStateUpdate(
            context,
            processedStreamState,
            processedStreamChunk,
          );
      }
      /**
       * 将处理后的streamState应用会streamState变量
       */
      streamState = processedStreamState;
      yield processedStreamChunk;
    }
    /**
     * 初始化LLMResponseStream
     */
    const result: LLMResponseStream = this.getLLMResponseStream(streamState);
    /**
     * 定义处理后的result变量
     */
    let processedResult = result;
    /**
     * 调用LLMResponseStream的拦截器
     */
    for (const interceptor of this.streamInterceptors) {
      if (interceptor.onFinalResult)
        processedResult = await interceptor.onFinalResult(
          context,
          processedResult,
        );
    }
    yield processedResult;
  }
  useStreamInterceptor(interceptor: StreamInterceptor) {
    this.streamInterceptors.push(interceptor);
  }
}
