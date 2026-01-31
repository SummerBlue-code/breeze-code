import type { LLMMessage } from "..";
import type { OpenAIMessage } from "../message/types";

export class MessageConverter {
  public static convertToOpenAIMessageFromLLMMessage(
    message: LLMMessage,
  ): OpenAIMessage {
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

  public static convertToOpenAIMessagesFromLLMMessages(
    messages: LLMMessage[],
  ): OpenAIMessage[] {
    return messages.map((message) => {
      return MessageConverter.convertToOpenAIMessageFromLLMMessage(message);
    });
  }
}
