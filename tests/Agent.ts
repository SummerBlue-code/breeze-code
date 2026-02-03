import { Config } from "@/Agent/core/Config";
import { IAgent } from "@/Agent/core/IAgent";
import { MessageManager } from "@/Agent/MessageManager/MessageManager";
import { ToolManager } from "@/Agent/ToolManager/ToolManager";
import { z } from "zod";

const config = new Config({
  defaultProvider: "openai",
  defaultModel: "gpt-5-nano-2025-08-07",
  baseUrl: "https://yunwu.ai/v1",
  apiKey: "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
  stream: true,
});

const messageManager = new MessageManager();

const toolManager = new ToolManager();

const agent = new IAgent(config, messageManager, toolManager);

agent.useResponseTimeInterceptor();
agent.uselogInterceptor();

messageManager.setSystemMessage("你是一个高级的人工智能助手Alice");
messageManager.addUserMessage("北京今天天气怎么样");

toolManager.register(
  "get_current_weather",
  "Get the current weather in a given location",
  z.object({
    location: z.string(),
    unit: z.enum(["celsius", "fahrenheit"]).optional(),
  }),
  async (args: { location: string; unit?: string }) => {
    // Call the weather API and return the result
    return (
      "The current weather in " + args.location + " is 20 degrees " + args.unit
    );
  },
  { enabled: true },
);

agent.generator();
