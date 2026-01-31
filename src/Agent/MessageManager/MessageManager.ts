import type {
  InterceptorContext,
  MessageInterceptor,
} from "@/Interceptor/types";
import type { LLMMessage } from "@/LLM";
import type {
  LLMMessageContent,
  LLMMessageToolCall,
} from "@/LLM/message/types";

export class MessageManager {
  private systemMessage: LLMMessageContent | null = null;
  private conversationMessages: LLMMessage[] = [];

  private messageInterceptors: MessageInterceptor[] = [];

  addUserMessage(content: LLMMessageContent) {
    /**
     * 初始化拦截器的context
     */
    const context: InterceptorContext = {};
    /**
     * 定义处理后的content
     */
    let processedContent: LLMMessageContent | false = content;
    /**
     * 调用before拦截器
     */
    this.messageInterceptors.forEach(async (interceptor) => {
      if (interceptor.beforeAddUserMessage) {
        processedContent = await interceptor.beforeAddUserMessage(
          context,
          processedContent as LLMMessageContent,
        );
        if (processedContent === false) {
          return;
        }
      }
    });
    const msg: LLMMessage = {
      role: "user",
      content: processedContent,
    };
    this.conversationMessages.push(msg);
    /**
     * 处理完之后，再调用after拦截器
     */
    this.messageInterceptors.forEach((interceptor) => {
      if (interceptor.afterAddUserMessage) {
        interceptor.afterAddUserMessage(context, msg);
      }
    });
  }
  addAssistantMessage(
    content: LLMMessageContent,
    toolCalls?: LLMMessageToolCall[],
  ) {
    /**
     * 初始化拦截器的context
     */
    const context: InterceptorContext = {};
    /**
     * 定义处理后的content
     */
    let processedContent: LLMMessageContent = content;
    let processedToolCalls: LLMMessageToolCall[] | undefined = toolCalls;
    /**
     * 调用before拦截器
     */
    this.messageInterceptors.forEach(async (interceptor) => {
      if (interceptor.beforeAddAssistantMessage) {
        const processedResult = await interceptor.beforeAddAssistantMessage(
          context,
          processedContent as LLMMessageContent,
          toolCalls,
        );
        if (processedResult === false) {
          return;
        }
        if (processedResult) {
          processedContent = processedResult.content;
          processedToolCalls = processedResult.toolCalls;
        }
      }
    });
    const msg: LLMMessage = {
      role: "assistant",
      content: processedContent,
    };
    if (processedToolCalls) {
      msg.tool_calls = processedToolCalls;
    }
    this.conversationMessages.push(msg);
    /**
     * 处理完之后，再调用after拦截器
     */
    this.messageInterceptors.forEach((interceptor) => {
      if (interceptor.afterAddAssistantMessage) {
        interceptor.afterAddAssistantMessage(context, msg);
      }
    });
  }
  addToolMessage(tool_call_id: string, content: LLMMessageContent) {
    /**
     * 初始化拦截器的context
     */
    const context: InterceptorContext = {};
    /**
     * 定义处理后的content
     */
    let processedContent: LLMMessageContent = content;
    let processedToolCallId: string = tool_call_id;
    /**
     * 调用before拦截器
     */
    this.messageInterceptors.forEach(async (interceptor) => {
      if (interceptor.beforeAddToolMessage) {
        const processedResult = await interceptor.beforeAddToolMessage(
          context,
          processedToolCallId,
          processedContent as LLMMessageContent,
        );
        if (processedResult === false) {
          return;
        }
        if (processedResult) {
          processedContent = processedResult.content;
          processedToolCallId = processedResult.toolCallId;
        }
      }
    });
    const msg: LLMMessage = {
      role: "tool",
      tool_call_id: processedToolCallId,
      content: processedContent,
    };
    this.conversationMessages.push(msg);
    /**
     * 处理完之后，再调用after拦截器
     */
    this.messageInterceptors.forEach((interceptor) => {
      if (interceptor.afterAddToolMessage) {
        interceptor.afterAddToolMessage(context, msg);
      }
    });
  }
  setSystemMessage(content: LLMMessageContent) {
    /**
     * 初始化拦截器的context
     */
    const context: InterceptorContext = {};
    /**
     * 定义处理后的content
     */
    let processedContent: LLMMessageContent | false = content;
    /**
     * 调用before拦截器
     */
    this.messageInterceptors.forEach(async (interceptor) => {
      if (interceptor.beforeSetSystemMessage) {
        processedContent = await interceptor.beforeSetSystemMessage(
          context,
          processedContent as LLMMessageContent,
        );
        if (processedContent === false) {
          return;
        }
      }
    });
    this.systemMessage = processedContent;
    /**
     * 处理完之后，再调用after拦截器
     */
    this.messageInterceptors.forEach((interceptor) => {
      if (interceptor.afterSetSystemMessage) {
        interceptor.afterSetSystemMessage(
          context,
          processedContent as LLMMessageContent,
        );
      }
    });
  }
  getSystemMessage() {
    return this.systemMessage;
  }
  /**
   * 获取**对话消息**（不含 system）
   */
  getConversationMessages() {
    return [...this.conversationMessages];
  }
  /**
   * 获取**所有消息**（含 system）
   */
  getMessages() {
    const msgs = [];
    if (this.systemMessage) {
      msgs.push({
        role: "system",
        content: this.systemMessage,
      } as LLMMessage);
    }
    return [...msgs, ...this.conversationMessages];
  }
  //   getLatestMessage();
  //   getPendingToolCalls();
  //   enforceLimits();
  //   compressHistory();
  //   sanitizeInput();
  //   sanitizeOutput();
  toJSON(): string {
    return JSON.stringify(this.conversationMessages, null, 2);
  }
  //   fromJSON();
  //   clear();

  useMessageInterceptor(interceptor: MessageInterceptor) {
    this.messageInterceptors.push(interceptor);
  }
}
