import { Config } from "@/Agent/core/Config";
import { BaseAgent } from "@/Agent/core/BaseAgent";
import { MessageManager } from "@/Agent/MessageManager/MessageManager";
import { ToolManager } from "@/Agent/ToolManager/ToolManager";
import { z } from "zod";
import { SimpleAgent } from "@/Agent/implementations/SimpleAgent";
import { ReActAgent } from "@/Agent/implementations/ReActAgent";
import { PromptTemplate } from "@/Agent/PromptTemplate/PromptTemplate";

const config = new Config({
  defaultProvider: "openai",
  defaultModel: "gpt-5-nano-2025-08-07",
  baseUrl: "https://yunwu.ai/v1",
  apiKey: "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
  stream: true,
});

const messageManager = new MessageManager();

const toolManager = new ToolManager();

const agent = new ReActAgent(config, messageManager);

agent.useResponseTimeInterceptor();
agent.uselogInterceptor();

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

const prompt2 = new PromptTemplate<{
  user_input: string;
  tools: string;
}>(`# 核心原则
- 您仅负责生成 [THOUGHT] 和 [ACTION]
- [OBSERVATION] 由外部环境注入，您**不可生成或修改**它
- 所有工具调用必须通过 [ACTION] 显式声明，禁止假设观测结果

## 输出协议（您仅输出以下内容）
[THOUGHT-{n}]
<推理步骤>

[ACTION-{n}]
TOOL: <工具名>
PARAMS: {<严格遵循 schema 的参数>}

## 环境将自动注入（您无需生成）
[OBSERVATION-{n}]
<工具执行器返回的结构化结果>

## 安全约束
1. 严禁输出 "[OBSERVATION]" 标签或模拟观测结果
2. 若需验证数据，必须通过 [ACTION] 调用验证工具
3. 所有数值结论必须基于至少 1 次真实工具调用的 OBSERVATION`);

const text2 = prompt2.render({
  user_input: "北京今天天气怎么样",
  tools: JSON.stringify(toolManager.getEnabledTools(), null, 2),
});

// console.log(text2);

messageManager.addUserMessage(text2);

await agent.generator();

`[THOUGHT-1]  // 思考-1
<分步逻辑分解>
- 识别需调用工具的知识缺口：需要获取北京当前的天气信息（包含温度、天气状况、湿度等）。
- 显式声明假设并附置信度评分（0.0-1.0）：假设公开天气接口能提供实时天气数据，且“北京”指代北京市区，置信度0.80。
- 基于当前状态与观测结果推导下一步行动：调用 get_current_weather 工具，location 设为 Beijing（或北京），unit 设为 Celsius，以便返回常用的温度单位；在获得结果后需进行数据解读与简要汇总。

[ACTION-1]  // 行动-1
TOOL: get_current_weather
PARAMS: {
  \"location\": \"Beijing\",
    \"unit\": \"celsius\"
    }
`;
