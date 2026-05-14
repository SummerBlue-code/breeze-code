// 记忆系统核心
export { MemorySystem } from "./MemorySystem";
export type {
  MemorySystemConfig,
  Message,
  ProcessedInteraction,
  EventInfo,
  SearchResult,
  BuildContextResult,
  ContextSelectResult,
  EventContext,
  RewriteResult,
  MemorySystemError,
} from "./MemorySystem";

// 情景记忆
export {
  EpisodicMemory,
} from "./storage/EpisodicMemory";
export type {
  Event,
  Interaction,
  Message as EpisodicMessage,
  MessageRole,
  UserQuery,
  AssistantResponse,
  EpisodicConfig,
  EpisodicMemoryError,
  EpisodicMemoryConfigError,
} from "./storage/EpisodicMemory";

// 语义记忆 (Synapse架构)
export {
  SemanticMemory,
  EdgeType,
} from "./storage/SemanticMemory";
export type {
  SynapseMemoryConfig,
  EpisodicNode,
  SemanticNode,
  SemanticNodeVector,
  UpsertSemanticResult,
  SemanticMemoryConfigError,
  SemanticMemoryError,
  EdgeTypeValue,
} from "./storage/SemanticMemory";

// 处理模块
export { QueryProcessor } from "./processing";
export type {
  QueryProcessorConfig,
  QueryResult,
  QueryRewriteResult,
  QueryType,
} from "./processing";

// 服务客户端
export { Neo4jClient } from "./services/Neo4jClient";
