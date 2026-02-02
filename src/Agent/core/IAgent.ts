import type { ILLM } from "@/LLM";
import { OpenAILLM } from "@/LLM/implementations/OpenAILLM";
import { MessageManager } from "../MessageManager/MessageManager";
import type {
  MessageInterceptor,
  NonStreamInterceptor,
  StreamInterceptor,
  ToolInterceptor,
} from "@/Interceptor/types";
import { ToolManager } from "@/Agent/ToolManager/ToolManager";
import { z, ZodType } from "zod";
import type { Tool, ToolCallInput, ToolMetadata } from "../ToolManager/types";
import type { LLMMessageContent } from "@/LLM/message/types";

class IAgent {
  config!: {
    provider: string;
    baseUrl: string;
    apiKey: string;
    stream: boolean;
    defaultModel: string;
  };
  llm!: ILLM;
  messageManager: MessageManager;
  toolManager: ToolManager;
  constructor(
    provider: string,
    baseUrl: string,
    apiKey: string,
    messageManager?: MessageManager,
    toolManager?: ToolManager,
  ) {
    if (messageManager) {
      this.messageManager = messageManager;
    } else {
      this.messageManager = new MessageManager();
    }
    if (toolManager) {
      this.toolManager = toolManager;
    } else {
      this.toolManager = new ToolManager();
    }
    if (provider === "openai") {
      this.llm = new OpenAILLM(baseUrl, apiKey);
    }
  }

  async generator() {
    const response = await this.llm.generateNonStream(
      this.messageManager,
      "gpt-5-nano-2025-08-07",
      this.toolManager,
    );

    if (response.finish_reason === "tool_calls") {
      this.messageManager.addAssistantMessage(
        response.content,
        response.tool_calls,
      );

      await Promise.all(
        response.tool_calls!.map(async (toolCall) => {
          const toolCallInput: ToolCallInput = { name: toolCall.name };
          if (toolCall.input) {
            toolCallInput.arguments = JSON.parse(toolCall.input);
          }
          const toolResult = await this.toolManager.execute(toolCallInput, {});

          this.messageManager.addToolMessage(
            toolCall.id,
            toolResult as LLMMessageContent,
          );
          return {
            tool_call_id: toolCall.id,
            content: toolResult,
          };
        }),
      );

      await this.generator();
    }
  }

  useResponseTimeInterceptor() {
    const LLMNonStreamResponseTimeInterceptor: NonStreamInterceptor = {
      onRequestData(ctx, data) {
        ctx.start = Date.now();
        return data;
      },
      onFinalResult(ctx, result) {
        const responseTime = Date.now() - ctx.start;
        console.log(`[非流式生成] 响应时间: ${responseTime}ms`);
        return result;
      },
    };
    const LLMStreamResponseTimeInterceptor: StreamInterceptor = {
      onRequestData(ctx, message) {
        ctx.start = Date.now();
        return message;
      },
      onFinalResult(ctx, result) {
        const responseTime = Date.now() - ctx.start;
        console.log(`[流式生成] 响应时间: ${responseTime}ms`);
        return result;
      },
    };
    this.llm.useNonStreamInterceptor(LLMNonStreamResponseTimeInterceptor);
    this.llm.useStreamInterceptor(LLMStreamResponseTimeInterceptor);
  }

  uselogInterceptor() {
    const messageManagerLogInterceptor: MessageInterceptor = {
      beforeAddAssistantMessage(ctx, content, toolCalls) {
        console.log("[消息管理器] 准备添加助手消息: [");
        console.log("消息内容:", content);
        if (toolCalls) {
          console.log("工具调用:", toolCalls);
        }
        console.log("]");
        return { content, toolCalls };
      },
      afterAddAssistantMessage(ctx, message) {
        console.log("[消息管理器] 成功添加助手消息:", message);
      },
      beforeAddUserMessage(ctx, content) {
        console.log("[消息管理器] 准备添加用户消息: [");
        console.log("消息内容:", content);
        console.log("]");
        return content;
      },
      afterAddUserMessage(ctx, message) {
        console.log("[消息管理器] 成功添加用户消息:", message);
      },
      beforeSetSystemMessage(ctx, content) {
        console.log("[消息管理器] 准备设置系统消息: [");
        console.log("消息内容:", content);
        console.log("]");
        return content;
      },
      afterSetSystemMessage(ctx, content) {
        console.log("[消息管理器] 成功设置系统消息:", content);
      },
      beforeAddToolMessage(ctx, toolCallId, content) {
        console.log("[消息管理器] 准备添加工具消息: [");
        console.log("工具调用ID:", toolCallId);
        console.log("消息内容:", content);
        console.log("]");
        return { toolCallId, content };
      },
      afterAddToolMessage(ctx, message) {
        console.log("[消息管理器] 成功添加工具消息:", message);
      },
    };
    const LLMNonStreamLogInterceptor: NonStreamInterceptor = {
      onRequestData(ctx, data) {
        console.log("[非流式生成] 正在构建请求数据: [");
        console.log("请求数据:", data);
        console.log("]");
        return data;
      },
      onRawResponse(ctx, raw) {
        console.log("[非流式生成] 收到原始响应:", raw);
        console.log(
          "[非流式生成] 打印原始消息:",
          (raw as any).choices[0].message,
        );
        return raw;
      },
      onStateUpdate(ctx, state) {
        console.log("[非流式生成] 状态更新:", state);
        return state;
      },
      onFinalResult(ctx, result) {
        console.log("[非流式生成] 最终响应结果:", result);
        return result;
      },
    };
    const LLMStreamLogInterceptor: StreamInterceptor = {
      onRequestData(ctx, data) {
        console.log("[流式生成] 正在构建请求数据: [");
        console.log("请求数据:", data);
        console.log("]");
        return data;
      },
      onRawChunk(ctx, raw) {
        console.log("[流式生成] 收到原始响应块:", raw);
        return raw;
      },
      onStreamChunk(ctx, chunk) {
        console.log("[流式生成] 成功构建统一响应块:", chunk);
        return chunk;
      },
      onStateUpdate(ctx, state, chunk) {
        console.log("[流式生成] 成功更新状态: [");
        console.log("当前状态: ", state);
        console.log("当前响应块:", chunk);
        console.log("]");
        return state;
      },
      onFinalResult(ctx, result) {
        console.log("[流式生成] 最终响应结果:", result);
        return result;
      },
    };
    const ToolManagerLogInterceptor: ToolInterceptor = {
      beforeRegister(ctx, toolMetaData) {
        console.log("[工具管理器] 准备注册工具: [");
        console.log("工具信息:", toolMetaData);
        console.log("]");
      },
      afterRegister(ctx, toolMetadata) {
        console.log("[工具管理器] 成功注册工具:", toolMetadata);
      },
      beforeExecute(ctx, toolMetadata, callInput) {
        console.log("[工具管理器] 准备执行工具: [");
        console.log("工具信息:", toolMetadata);
        console.log("工具输入:", callInput);
        console.log("]");
      },
      afterExecute(ctx, toolMetadata, callInput, result) {
        console.log("[工具管理器] 成功执行工具: [");
        console.log("工具信息:", toolMetadata);
        console.log("工具输入:", callInput);
        console.log("工具输出:", result);
        console.log("]");
      },
    };
    this.messageManager.useMessageInterceptor(messageManagerLogInterceptor);
    this.llm.useStreamInterceptor(LLMStreamLogInterceptor);
    this.llm.useNonStreamInterceptor(LLMNonStreamLogInterceptor);
    this.toolManager.useToolInterceptor(ToolManagerLogInterceptor);
  }
}

const messageManager = new MessageManager();

const toolManager = new ToolManager();

const agent = new IAgent(
  "openai",
  "https://yunwu.ai/v1",
  "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
  messageManager,
  toolManager,
);
agent.useResponseTimeInterceptor();
agent.uselogInterceptor();

messageManager.setSystemMessage("你是一个高级的人工智能助手Alice");
messageManager.addUserMessage("北京今天天气怎么样");

// toolManager.register(
//   "get_current_weather",
//   "Get the current weather in a given location",
//   z.object({
//     location: z.string(),
//     unit: z.enum(["celsius", "fahrenheit"]).optional(),
//   }),
//   async (args: { location: string; unit?: string }) => {
//     // Call the weather API and return the result
//     return (
//       "The current weather in " + args.location + " is 20 degrees " + args.unit
//     );
//   },
//   { enabled: true },
// );

agent.generator();
