// interface AgentHistory {
//   steps: Step[]; // 推理轨迹
//   reflections: Reflection[]; // 元认知记录
//   plan?: ExecutionPlan; // 规划状态
//   // ... 其他业务状态
// }
// interface Step {
//   id: string; // step_001
//   type: "thought" | "action" | "observation" | "reflection";
//   content: string; // 原始内容
//   metadata: {
//     // 业务元数据（关键！）
//     tool?: string;
//     success: boolean;
//     timestamp: number;
//     tokensUsed?: number;
//   };
// }

type StepType =
  | "thought" // 内部推理
  | "action" // 工具调用
  | "observation" // 工具结果
  | "reflection" // 元认知反思
  | "plan_update" // 规划变更
  | "user_input" // 用户干预
  | "error"; // 异常事件

export interface ReasoningStep {
  /** 全局唯一步骤ID (step_001) */
  id: string;

  /** 步骤类型 (决定如何解析content) */
  type: StepType;

  /** 原始内容 (LLM输出或工具结果) */
  content: string;

  /** 结构化元数据 (关键! 业务语义载体) */
  metadata: {
    // 通用元数据
    timestamp: number; // 步骤发生时间
    durationMs?: number; // 执行耗时
    tokensUsed?: number; // 本步骤消耗token
    llmModel?: string; // 使用的LLM型号

    // ReAct专用
    tool?: string; // 调用的工具名
    toolParams?: Record<string, any>; // 工具参数
    toolResult?: any; // 原始工具返回 (非字符串化)
    success?: boolean; // 工具执行是否成功
    errorType?: "rate_limit" | "invalid_params" | "timeout" | "unknown";

    // Reflection专用
    reflectionTrigger?:
      | "consecutive_failures"
      | "contradiction"
      | "user_request"
      | "timeout";
    critique?: string; // 对失败的批判
    insight?: string; // 提取的洞察
    appliedToStep?: string; // 洞察应用到的步骤ID

    // PlanAndSolve专用
    planStepIndex?: number; // 对应计划步骤索引
    planStepStatus?: "pending" | "executing" | "completed" | "skipped";
    planRevisionReason?: string; // 计划修订原因

    // 用户交互专用
    userInputType?: "clarification" | "correction" | "abort";
    userInputContent?: string;

    // 错误处理
    errorStack?: string; // 错误堆栈
    recoveryAction?: "retry" | "fallback" | "abort" | "human_handoff";
  };

  /** 步骤间关系 (构建推理图谱) */
  relations: {
    /** 前驱步骤 (e.g., observation的前驱是action) */
    precedes?: string;

    /** 后继步骤 */
    follows?: string;

    /**
     * step3.relations = {
     *   reflectsOn: "step_1",   // step3是对step1的反思
     *   corrects: "step_2"      // step3修正了step2的错误
     * }
     */
    reflectsOn?: string;

    /**
     * step3.relations = {
     *   reflectsOn: "step_1",   // step3是对step1的反思
     *   corrects: "step_2"      // step3修正了step2的错误
     * }
     */
    corrects?: string;
  };
}

// interface PlanningState {
//   /** 当前活跃计划 (可能有多版本) */
//   activePlan?: ExecutionPlan;

//   /** 计划版本历史 (支持回滚) */
//   planHistory: {
//     version: number;
//     plan: ExecutionPlan;
//     createdAt: number;
//     reason:
//       | "initial"
//       | "reflection_triggered"
//       | "user_modified"
//       | "auto_revised";
//     triggeredByStep?: string; // 触发修订的步骤ID
//   }[];

//   /** 当前执行位置 */
//   currentStepIndex: number;

//   /** 计划执行状态机 */
//   status:
//     | "not_started" // 未生成计划
//     | "planning" // 正在生成计划
//     | "ready" // 计划已批准待执行
//     | "executing" // 执行中
//     | "paused" // 用户暂停
//     | "completed" // 全部完成
//     | "failed" // 计划失败
//     | "aborted"; // 用户中止

//   /** 计划质量指标 */
//   metrics?: {
//     estimatedSteps: number;
//     confidence: number; // 计划可行性置信度
//     riskFactors: string[]; // 识别的风险点
//   };
// }

// interface ExecutionPlan {
//   /** 计划ID (plan_v1) */
//   id: string;

//   /** 计划描述 */
//   description: string;

//   /** 步骤列表 (DAG结构) */
//   steps: {
//     id: string; // step_1
//     description: string; // "Search Apple market cap"
//     tool?: string; // 预期工具
//     dependencies: string[]; // 依赖步骤ID
//     expectedOutput: string; // 预期输出描述
//     timeoutMs?: number; // 步骤超时
//     retryPolicy?: {
//       // 重试策略
//       maxRetries: number;
//       backoffMs: number;
//     };
//     status: "pending" | "executing" | "completed" | "failed" | "skipped";
//   }[];

//   /** 全局约束 */
//   constraints: {
//     maxTotalSteps?: number;
//     maxParallelSteps?: number;
//     requiredTools: string[];
//     forbiddenTools?: string[];
//   };
// }

// interface ReflectionSystem {
//   /** 反思触发器配置 */
//   triggers: {
//     consecutiveFailures: number; // 连续失败N次触发
//     contradictionThreshold: number; // 逻辑矛盾置信度阈值
//     timeoutMs: number; // 单步超时触发
//     userRequest: boolean; // 用户显式请求
//   };

//   /** 反思记录 (时间序列) */
//   records: {
//     id: string; // reflection_001
//     timestamp: number;
//     trigger: StepType; // 触发反思的步骤类型
//     triggerStepId: string; // 触发步骤ID
//     critique: string; // 批判内容
//     insight: string; // 提取的洞察
//     actionPlan: string; // 修正行动计划
//     applied: boolean; // 是否已应用
//     appliedAtStep?: string; // 应用到的步骤ID
//     effectiveness?: number; // 修正效果评估 (0-1)
//   }[];

//   /** 元反思 (对反思本身的反思) */
//   metaReflections?: {
//     timestamp: number;
//     critique: string; // "上次反思过于保守，未充分探索替代方案"
//     insight: string;
//   }[];
// }

// interface MemorySystem {
//   /** 短期记忆 (当前对话上下文) */
//   shortTerm: {
//     relevantFacts: { fact: string; sourceStep: string; confidence: number }[];
//     currentFocus: string; // 当前关注点 (e.g., "Apple market cap")
//     unresolvedQuestions: string[];
//   };

//   /** 长期记忆 (跨会话知识) */
//   longTerm?: {
//     sessionId: string;
//     keyInsights: { insight: string; supportingSteps: string[] }[];
//     toolUsagePatterns: {
//       tool: string;
//       successRate: number;
//       avgDurationMs: number;
//     }[];
//     failurePatterns: {
//       pattern: string;
//       frequency: number;
//       mitigation: string;
//     }[];
//   };

//   /** 记忆检索状态 */
//   retrieval: {
//     lastQuery?: string;
//     results?: { content: string; relevance: number }[];
//     timestamp?: number;
//   };
// }

// interface ToolSystem {
//   /** 已注册工具 */
//   registry: ToolDescription[];

//   /** 工具调用历史 (用于学习) */
//   callHistory: {
//     id: string;
//     tool: string;
//     params: Record<string, any>;
//     result: any;
//     success: boolean;
//     timestamp: number;
//     durationMs: number;
//     stepId: string; // 关联的推理步骤
//   }[];

//   /** 工具状态 (有状态工具) */
//   statefulTools: Record<string, any>; // tool_name → state

//   /** 工具选择策略 */
//   selectionStrategy: "llm" | "rule_based" | "hybrid";
// }

// // ==================== 8. 元认知状态 ====================
// interface MetacognitiveState {
//   /** 当前活跃推理范式 */
//   activePattern:
//     | "react"
//     | "reflection"
//     | "plan-and-solve"
//     | "chain-of-thought"
//     | "none";

//   /** 范式切换历史 */
//   patternHistory: {
//     timestamp: number;
//     from: string;
//     to: string;
//     trigger: "failure" | "task_complexity" | "user_request" | "timeout";
//     triggerStep?: string;
//   }[];

//   /** 置信度评估 */
//   confidence: {
//     current: number; // 当前步骤置信度 (0-1)
//     trend: "increasing" | "decreasing" | "stable";
//     lowConfidenceReasons?: string[];
//   };

//   /** 决策依据 */
//   decisionRationale: {
//     stepId: string;
//     rationale: string; // 为什么选择此行动
//     alternativesConsidered: string[];
//     riskAssessment: string;
//   }[];

//   /** 认知负荷指标 */
//   cognitiveLoad: {
//     contextLength: number; // 当前上下文token数
//     branchingFactor: number; // 决策分支复杂度
//     uncertaintyLevel: "low" | "medium" | "high";
//   };
// }

// // ==================== 9. 监控与统计 ====================
// interface MonitoringStats {
//   /** Token使用统计 */
//   tokens: {
//     prompt: number;
//     completion: number;
//     total: number;
//     byModel: Record<string, { prompt: number; completion: number }>;
//   };

//   /** 步骤统计 */
//   steps: {
//     total: number;
//     byType: Record<StepType, number>;
//     successfulActions: number;
//     failedActions: number;
//     avgDurationMs: number;
//   };

//   /** 工具统计 */
//   tools: {
//     totalCalls: number;
//     successRate: number;
//     avgLatencyMs: number;
//     byTool: Record<string, { calls: number; successRate: number }>;
//   };

//   /** 范式统计 */
//   patterns: {
//     reactSteps: number;
//     reflectionTriggers: number;
//     planRevisions: number;
//   };

//   /** SLO/SLI指标 */
//   sla: {
//     deadlineMs?: number;
//     remainingMs?: number;
//     breached: boolean;
//     breachReason?: string;
//   };

//   /** 成本估算 (USD) */
//   costEstimate?: {
//     llm: number;
//     tools: number;
//     total: number;
//   };
// }

// // ==================== 10. 错误与恢复 ====================
// interface ErrorRecovery {
//   /** 当前错误状态 */
//   currentError?: {
//     stepId: string;
//     type: "tool_error" | "llm_error" | "parsing_error" | "timeout" | "unknown";
//     message: string;
//     stack?: string;
//     timestamp: number;
//   };

//   /** 恢复策略历史 */
//   recoveryHistory: {
//     timestamp: number;
//     errorStepId: string;
//     strategy:
//       | "retry"
//       | "fallback_tool"
//       | "simplify_task"
//       | "human_handoff"
//       | "abort";
//     success: boolean;
//     resultStepId?: string;
//   }[];

//   /** 恢复能力配置 */
//   capabilities: {
//     maxRetries: number;
//     fallbackTools: Record<string, string[]>; // 主工具 → 备用工具列表
//     humanHandoffThreshold: number; // 置信度低于此值触发人工
//   };
// }

// // ==================== 11. 完整Agent State ====================
// interface AgentState {
//   // --- 核心状态 ---
//   session: SessionMetadata;
//   task: TaskDefinition;
//   history: ReasoningStep[]; // 推理历史 (时序数组)
//   planning: PlanningState; // 规划状态
//   reflections: ReflectionSystem; // 反思系统
//   memory: MemorySystem; // 记忆系统
//   tools: ToolSystem; // 工具系统
//   metacognition: MetacognitiveState; // 元认知状态

//   // --- 运行时状态 ---
//   currentState:
//     | "initializing" // 初始化中
//     | "planning" // 生成计划
//     | "executing" // 执行步骤
//     | "reflecting" // 反思中
//     | "awaiting_input" // 等待用户输入
//     | "completed" // 任务完成
//     | "failed" // 任务失败
//     | "aborted"; // 用户中止

//   // --- 监控与统计 ---
//   stats: MonitoringStats;

//   // --- 错误与恢复 ---
//   errors: ErrorRecovery;

//   // --- 扩展字段 (插件系统) ---
//   extensions?: Record<string, any>; // 用于插件存储自定义状态
// }
