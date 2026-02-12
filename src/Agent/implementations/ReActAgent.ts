import type { LLMResponseNonStream, LLMResponseStream } from "@/LLM";
import { BaseAgent } from "../core/BaseAgent";
import type { Config } from "../core/Config";
import type { MessageManager } from "../MessageManager/MessageManager";
import type { ToolManager } from "../ToolManager/ToolManager";
import type { ToolCallInput } from "../ToolManager/types";
import type { ReasoningStep } from "../core/AgentState";

export class ReActAgent extends BaseAgent {
  constructor(
    config: Config,
    messageManager?: MessageManager,
    toolManager?: ToolManager,
  ) {
    super(config, messageManager, toolManager);
  }

  async generator() {
    let reasoningStep: ReasoningStep[] = [];

    let response!: LLMResponseStream | LLMResponseNonStream;
    if (this.config.stream) {
      const stream = await this.llm.generateStream(
        this.messageManager,
        this.config.defaultModel,
        this.toolManager,
      );
      for await (const chunk of stream) {
        response = chunk as LLMResponseStream;
      }
    } else {
      response = await this.llm.generateNonStream(
        this.messageManager,
        this.config.defaultModel,
        this.toolManager,
      );
    }

    // if (response.finish_reason === "tool_calls") {
    //   this.messageManager.addAssistantMessage(
    //     response.content,
    //     response.tool_calls,
    //   );

    //   await Promise.all(
    //     response.tool_calls!.map(async (toolCall) => {
    //       const toolCallInput: ToolCallInput = { name: toolCall.name };
    //       if (toolCall.input) {
    //         toolCallInput.arguments = JSON.parse(toolCall.input);
    //       }
    //       const toolResult = await this.toolManager.execute(toolCallInput, {});

    //       this.messageManager.addToolMessage(
    //         toolCall.id,
    //         JSON.stringify(toolResult),
    //       );
    //       return {
    //         tool_call_id: toolCall.id,
    //         content: toolResult,
    //       };
    //     }),
    //   );

    //   await this.generator();
    // }
  }
}
