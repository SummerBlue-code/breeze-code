import type { LLMMessage, LLMResponseNonStream } from "..";
import type { IAgentMessages } from "../../Agent/Messages";
import type { LLMResponseStream } from "..";
import type { StreamChunk } from "../streamState/IStreamState";
import type { NonStreamState } from "../nonStreamState/INonStreamState";
import type { MessageManager } from "@/Agent/MessageManager/MessageManager";
import type {
  NonStreamInterceptor,
  StreamInterceptor,
} from "@/Interceptor/types";

export interface ILLM {
  generateNonStream(
    messages: MessageManager,
    model: string,
    tools?: unknown, // TODO: Add type
  ): Promise<LLMResponseNonStream>;

  useNonStreamInterceptor(interceptor: NonStreamInterceptor): void;

  generateStream(
    messages: MessageManager,
    model: string,
    tools?: unknown, // TODO: Add type
  ): AsyncGenerator<StreamChunk | LLMResponseStream>;

  useStreamInterceptor(interceptor: StreamInterceptor): void;
}
