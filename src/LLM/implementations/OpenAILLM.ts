import type {
  ILLM,
  LLMMessage,
  LLMResponseNonStream,
  LLMResponseStream,
  LLMUsage,
} from "..";
import { AgentMessages, type IAgentMessages } from "../../Agent/Messages";
import { OpenAI } from "openai";
import { MessageConverter } from "../converter/messageConverter";
import type { NonStreamState } from "../nonStreamState/INonStreamState";
import { OPENAI_FINISH_REASON_MAP } from "../converter/FinishReasonMap";
import type { StreamChunk, StreamState } from "../streamState/IStreamState";
import type { ChatCompletion, ChatCompletionChunk } from "openai/resources";
import { BaseLLM } from "../core/BaseLLM";
import { MessageManager } from "@/Agent/MessageManager/MessageManager";
import type { RequestOptions } from "node_modules/openai/internal/request-options";
import type { OpenAIMessage } from "../message/types";
import type { ToolMetadata } from "@/Agent/ToolManager/types";
import type { ToolManager } from "@/Agent/ToolManager/ToolManager";

export class OpenAILLM extends BaseLLM implements ILLM {
  client: OpenAI;

  constructor(baseURL: string, apiKey: string) {
    super();
    this.client = new OpenAI({ baseURL, apiKey });
  }
  converterMessage(message: LLMMessage): OpenAIMessage {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: JSON.stringify(message.content),
        tool_call_id: message.tool_call_id,
      };
    }
    if (message.role === "assistant" && message.tool_calls) {
      return {
        role: "assistant",
        tool_calls: message.tool_calls.map((toolCall) => {
          return {
            id: toolCall.id,
            type: "function",
            function: {
              arguments: JSON.stringify(toolCall.input),
              name: toolCall.name,
            },
          };
        }),
      };
    }
    return {
      role: message.role,
      content: JSON.stringify(message.content),
    };
  }

  convertToolSchema(ToolMetadata: ToolMetadata): unknown {
    return {
      type: "function",
      function: {
        name: ToolMetadata.name,
        description: ToolMetadata.description,
        parameters: ToolMetadata.ZodSchema.toJSONSchema({
          target: "openapi-3.0",
        }),
      },
    };
  }

  buildRequestData(
    manager: MessageManager,
    model: string,
    stream: boolean,
    toolManager: ToolManager,
  ): unknown {
    /**
     * 通过MessageManager获取LLMMessages
     */
    const messages = manager.getMessages().map((message) => {
      return this.converterMessage(message);
    });
    const tools = toolManager.getEnabledTools().map((toolMetadata) => {
      return this.convertToolSchema(toolMetadata);
    });
    /**
     * 将各种信息整理为请求数据
     */
    return {
      model,
      messages: messages as never[],
      tools,
      stream,
    };
  }

  createNonStreamState(rawResponse: ChatCompletion): NonStreamState {
    /**
     * 初始化NonStreamState
     */
    const result: Partial<NonStreamState> = {};
    /**
     * 提取content
     */
    if (rawResponse.choices[0]?.message.content) {
      result.content = rawResponse.choices[0]?.message.content;
    }
    /**
     * 提取tool_calls
     */
    const tool_calls = rawResponse.choices[0]?.message.tool_calls?.map(
      (tool_call) => {
        const tc: Record<string, any> = {};
        tc.id = tool_call.id as string;
        tc.name = (
          tool_call as { function: { name: string; arguments?: string } }
        ).function.name;
        if (
          (tool_call as { function: { name: string; arguments?: string } })
            .function?.arguments
        )
          tc.input = (
            tool_call as { function: { name: string; arguments?: string } }
          ).function.arguments;
        return tc;
      },
    );
    if (tool_calls && tool_calls.length > 0) {
      result.tool_calls = tool_calls as Array<{
        id: string;
        name: string;
        input?: string;
      }>;
    }
    /**
     * 提取finish_reason
     */
    if (rawResponse.choices[0]?.finish_reason) {
      const mapped =
        OPENAI_FINISH_REASON_MAP[rawResponse.choices[0]?.finish_reason];
      if (mapped) {
        result.finish_reason = mapped;
      }
    }
    /**
     * 提取usage
     */
    if (rawResponse.usage) {
      const usageData: Partial<LLMUsage> = {};
      if (rawResponse.usage.prompt_tokens) {
        usageData.prompt_tokens = rawResponse.usage.prompt_tokens;
      }
      if (rawResponse.usage.completion_tokens) {
        usageData.completion_tokens = rawResponse.usage.completion_tokens;
      }
      if (rawResponse.usage.total_tokens) {
        usageData.total_tokens = rawResponse.usage.total_tokens;
      }
      result.usage = usageData as LLMUsage;
    }
    /**
     * 提取 rawResponse
     */
    result.rawResponse = rawResponse;

    return result as NonStreamState;
  }

  createStreamChunk(rawChunk: ChatCompletionChunk): StreamChunk {
    /**
     * 初始化StreamChunk
     */
    const result: Partial<StreamChunk> = {};
    /**
     * 提取content
     */
    if (rawChunk.choices[0]?.delta?.content) {
      result.content = rawChunk.choices[0]?.delta.content;
    }
    /**
     * 提取tool_calls
     */
    const tool_calls = rawChunk.choices[0]?.delta?.tool_calls?.map(
      (tool_call) => {
        const tc: Record<string, any> = {};
        if (tool_call.id) tc.id = tool_call.id;
        if (tool_call.function?.name) tc.name = tool_call.function.name;
        if (tool_call.function?.arguments)
          tc.input = tool_call.function.arguments;
        return tc;
      },
    );
    if (tool_calls && tool_calls.length > 0) {
      result.tool_calls = tool_calls as Array<{
        id?: string;
        name?: string;
        input?: string;
      }>;
    }
    /**
     * 提取finish_reason
     */
    if (rawChunk.choices[0]?.finish_reason) {
      const mapped =
        OPENAI_FINISH_REASON_MAP[rawChunk.choices[0]?.finish_reason];
      if (mapped) {
        result.finish_reason = mapped;
      }
    }

    /**
     * 提取usage
     */
    if (rawChunk.usage) {
      const usageData: Partial<LLMUsage> = {};
      if (rawChunk.usage.prompt_tokens) {
        usageData.prompt_tokens = rawChunk.usage.prompt_tokens;
      }
      if (rawChunk.usage.completion_tokens) {
        usageData.completion_tokens = rawChunk.usage.completion_tokens;
      }
      if (rawChunk.usage.total_tokens) {
        usageData.total_tokens = rawChunk.usage.total_tokens;
      }
      result.usage = usageData as LLMUsage;
    }

    /**
     * 提取 rawChunk
     */
    result.rawChunk = rawChunk;

    /**
     * 返回最终的StreamChunk
     */
    return result as StreamChunk;
  }

  async getRawResponse(requestData: unknown) {
    /**
     * 获取LLM的原始响应
     */
    const rawResponse = await this.client.chat.completions.create(
      requestData as never,
    );
    return rawResponse;
  }

  async getRawStream(requestData: unknown) {
    /**
     * 获取LLM的原始流
     */
    const rawStream = await this.client.chat.completions.create(
      requestData as never,
    );
    return rawStream;
  }
}

// const llm = new OpenAILLM(
//   "https://yunwu.ai/v1",
//   "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
// );

// const messageManager = new MessageManager();
// messageManager.setSystemMessage("你是一个高级的人工智能助手Alice");
// messageManager.addUserMessage("北京今天天气怎么样");

// const tools = [
//   {
//     type: "function",
//     function: {
//       name: "get_current_weather",
//       description: "Get the current weather in a given location",
//       parameters: {
//         type: "object",
//         properties: {
//           location: {
//             type: "string",
//             description: "The city and state, e.g. San Francisco, CA",
//           },
//           unit: {
//             type: "string",
//             enum: ["celsius", "fahrenheit"],
//           },
//         },
//         required: ["location"],
//       },
//     },
//   },
// ];

// const response = await llm.generateNonStream(
//   messageManager,
//   "gpt-5-nano-2025-08-07",
//   tools,
// );

// console.log(response);

// const stream = llm.generateStream(messageManager, "gpt-5-nano-2025-08-07");

// for await (const chunk of stream) {
//   console.log(chunk);
// }
