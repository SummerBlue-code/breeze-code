import type { LLMMessage, LLMResponseNonStream } from "..";
import type { LLMResponseStream } from "..";
import type { StreamChunk } from "../streamState/IStreamState";
import type { NonStreamState } from "../nonStreamState/INonStreamState";
import type { MessageManager } from "@/Agent/MessageManager/MessageManager";
import type {
  NonStreamInterceptor,
  StreamInterceptor,
} from "@/Interceptor/types";
import type { ToolManager } from "@/Agent/ToolManager/ToolManager";

export interface ILLM {
  generateNonStream(
    messages: MessageManager,
    model: string,
    tools?: ToolManager,
  ): Promise<LLMResponseNonStream>;

  useNonStreamInterceptor(interceptor: NonStreamInterceptor): void;

  generateStream(
    messages: MessageManager,
    model: string,
    tools?: ToolManager,
  ): AsyncGenerator<StreamChunk | LLMResponseStream>;

  useStreamInterceptor(interceptor: StreamInterceptor): void;
}
