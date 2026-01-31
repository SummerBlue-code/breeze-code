import type { LLMMessage } from "../LLM";

export interface IAgentMessages {
  messages: LLMMessage[];
  addMessage: (message: LLMMessage) => void;
  getSystemMessage: () => LLMMessage | null;
  getChatMessages: () => LLMMessage[];
}

export class AgentMessages implements IAgentMessages {
  messages: LLMMessage[];
  constructor() {
    this.messages = [];
  }

  addMessage(message: LLMMessage) {
    this.messages.push(message);
  }

  getSystemMessage() {
    return this.messages.find((message) => message.role === "system") || null;
  }

  getChatMessages() {
    return this.messages.filter((message) => message.role !== "system");
  }
}
