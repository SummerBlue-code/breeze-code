# Breeze Code

一个基于 AI Agent 的双层记忆系统，实现情景记忆 (Episodic Memory) 和语义记忆 (Semantic Memory) 架构，支持向量检索和图关系查询。

## 功能特性

- **双层记忆架构**: 结合情景记忆与语义记忆，模拟人类记忆系统
- **向量检索**: 基于 Qdrant 的高效向量存储与相似度搜索
- **图数据库**: 使用 Neo4j 构建语义关系网络
- **传播激活算法**: 支持记忆激活扩散与侧抑制机制
- **ReAct 推理**: 内置 ReAct (Reasoning + Acting) 代理实现
- **多 AI 提供商**: 支持 OpenAI 和 Anthropic
- **拦截器系统**: 灵活的消息/响应拦截与日志记录
- **工具管理系统**: Zod schema 验证的工具注册与执行

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Bun 1.3.6+ |
| 语言 | TypeScript (strict mode) |
| 前端 | React 19, React DOM 19 |
| 样式 | TailwindCSS 4.x |
| 向量数据库 | Qdrant |
| 图数据库 | Neo4j |
| LLM | OpenAI, Anthropic |

## 快速开始

### 环境要求

- Bun 1.3.6 或更高版本
- Node.js 18+ (备用)

### 安装依赖

```bash
bun install
```

### 配置环境变量

创建 `.env` 文件：

```env
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key  # 可选
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
QDRANT_URL=http://localhost:6333
```

### 运行项目

```bash
# 开发模式 (热重载)
bun dev

# 生产模式
bun start
```

## 项目结构

```
src/
├── index.ts                 # 服务器入口 (Bun HTTP)
├── index.html               # HTML 模板
├── index.css                # TailwindCSS 入口
├── App.tsx                  # React 主组件
│
├── Agent/                   # Agent 系统
│   ├── core/
│   │   ├── BaseAgent.ts     # Agent 基类
│   │   ├── Config.ts        # 配置类型
│   │   └── AgentState.ts    # 状态定义
│   ├── implementations/
│   │   ├── SimpleAgent.ts   # 简单 Agent
│   │   └── ReActAgent.ts    # ReAct 推理 Agent
│   └── Memory/
│       ├── MemorySystem.ts      # 记忆系统编排
│       ├── coordination/        # 协调层 (日志等)
│       ├── processing/          # 处理层 (编码/提取/查询)
│       ├── services/            # 服务层 (SQLite/Neo4j 客户端)
│       └── storage/             # 存储层
│           ├── EpisodicMemory.ts    # 情景记忆 (Qdrant)
│           └── SemanticMemory.ts    # 语义记忆 (Neo4j+Qdrant)
│
├── LLM/                     # LLM 集成
│   ├── core/
│   │   ├── BaseLLM.ts       # LLM 基类
│   │   └── ILLM.ts          # LLM 接口
│   └── implementations/
│       └── OpenAILLM.ts     # OpenAI 实现
│
├── Interceptor/             # 拦截器
├── Errors/                  # 错误层次
└── Utils/                   # 工具函数
```

## 核心模块

### 记忆系统

本项目的记忆系统基于两篇核心论文实现：

#### 记忆系统架构

本项目的记忆系统实现了一套完整的双层记忆架构，受 SYNAPSE 论文启发并做了大量定制化实现。

**情景记忆 (EpisodicMemory)**

情景记忆负责存储对话交互的原始数据，采用 Events → Interactions → Messages 三层结构：

- **Event**: 最高层的事件容器，如"讨论 Python 装饰器"、"解决 Bug #123"等事件
- **Interaction**: 一次用户-助手的完整对话回合，包含多条 Message
- **Message**: 单独的用户消息或助手回复，包含角色、内容、向量、摘要等

所有数据存储在 Qdrant 向量数据库中，支持：
- 向量相似度搜索，快速找到相关内容
- 基于实体的过滤检索
- 时间窗口过滤，限定搜索范围

**语义记忆 (SemanticMemory)**

语义记忆负责存储抽象的概念知识，采用 Neo4j (图) + Qdrant (向量) 的混合存储：

- **V_S (语义节点)**: 存储抽象概念，如技术名词、设计模式、用户偏好等，数据存在 Qdrant
- **V_E (情景节点)**: 存储对话片段的引用，通过 messageId 关联到情景记忆中的具体消息，数据存在 Neo4j
- **边关系**:
  - **TEMPORAL**: 连接连续的 V_E 节点，表示时间上的临近关系
  - **ABSTRACTION**: V_E → V_S 的映射边，建立情景到语义的抽象关联
  - **ASSOCIATION**: V_S ↔ V_S 之间的语义关联，根据向量相似度自动建立

**传播激活算法 (Spreading Activation)**

当用户提问时，系统通过以下步骤检索记忆：

1. **双触发初始化**: 使用查询向量和提取的实体关键词同时触发检索
2. **激活扩散**: 从初始节点出发，通过边关系将激活值传播到相邻节点
3. **迭代衰减**: 每一轮传播后激活值按 damping 系数衰减，并应用 Sigmoid 函数平滑

核心配置参数（定义在 `SemanticMemory.ts`）:
- `damping`: 衰减系数，默认 0.8
- `maxIterations`: 最大迭代次数，默认 3
- `threshold`: 激活值阈值，默认 0.5
- `steepness`: Sigmoid 陡度，默认 5.0
- `nodeDecay`: 节点衰减率，默认 0.5

**侧抑制算法 (Lateral Inhibition)**

传播激活后，相邻的高激活节点会相互竞争：

- 如果某节点的邻居激活值超过自身的一定比例，该节点被抑制
- 抑制后激活值乘以 inhibitionFactor (默认 0.5)
- 最后只保留激活值最高的 topM 个节点 (默认 7 个)

这模拟了神经网络的侧抑制现象，让最相关的记忆脱颖而出。

**三信号混合排序 (Three-Signal Hybrid Ranking)**

QueryProcessor 将多个信号组合计算最终相关性分数：

```
S_total = α·A + β·S_sem + γ·T
```

- **A (activation)**: 传播激活值，反映从语义网络激活的程度
- **S_sem (semantic)**: 向量相似度分数，反映内容上的相似程度
- **T (temporal)**: 时间衰减因子，越新的记忆分数越高
- **α, β, γ**: 权重配置，默认分别为 0.4, 0.4, 0.2

**EMA 向量更新**

当新内容与已有语义节点相似时，使用指数移动平均更新向量：

```
h_new = α * h_new + (1 - α) * h_old
```

这样可以让概念节点随时间积累新知识，同时保留核心语义。

#### 查询处理流程 (QueryProcessor)

`QueryProcessor.ts` 实现了完整的查询处理流水线：

1. **Query 分类**: 判断是知识问答 (knowledge)、闲聊 (chat)、还是总结 (summary)
2. **Query 改写**: 扩展同义词、添加上下文
3. **并行检索**: 同时从 V_E (Qdrant) 和 V_S (Neo4j+Qdrant) 检索
4. **混合排序**: 应用三信号公式计算最终分数
5. **置信度检查**: 过滤低于阈值的低质量结果

#### 记忆存储流程 (MemorySystem)

`MemorySystem.ts` 实现了八阶段处理流水线：

```
QUERY_ANALYSIS → RETRIEVE → SELECT → CONTEXT_BUILD
     → RESOLVE → GENERATE → STORE → CONFIRM
```

- **QUERY_ANALYSIS**: 解析用户输入，提取实体、时间窗口、生成向量
- **RETRIEVE**: 从情景记忆和语义记忆并行检索相关记忆
- **SELECT**: LLM 判断哪些事件相关，再对 interactions 精筛选
- **CONTEXT_BUILD**: 构建格式化的上下文文本
- **RESOLVE**: 代词消解，将"刚才"、"它"等指代词替换为具体实体
- **GENERATE**: 基于上下文生成回答
- **STORE**: 评估交互价值，决定存储目标（合并/加入现有/创建新事件）
- **CONFIRM**: 用户确认（主要是事件合并操作）

#### ProcMEM: Learning Reusable Procedural Memory from Experience via Non-Parametric PPO for LLM Agents

本项目参考曾参考过 ProcMEM 论文中关于程序记忆的思路，后续将扩展出基于Agent的工具调用记录来生成程序记忆。

### Agent 系统

- **BaseAgent**: 所有 Agent 的抽象基类，管理 LLM、消息管理器和工具管理器
- **ReActAgent**: 实现 ReAct 推理模式，支持流式和非流式响应

### 拦截器

支持请求/响应拦截，可用于：

- 日志记录
- 性能监控
- 消息流程追踪

## 如何运行

### 前置依赖

确保 Docker 服务运行后，启动数据库服务：

```bash
cd docker
docker-compose up -d
```

这将启动：
- **Qdrant**: http://localhost:6333 (向量数据库)
- **Neo4j**: http://localhost:7474 (图数据库)

### 配置

创建 `.env` 文件：

```env
OPENAI_API_KEY=your_openai_api_key
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
QDRANT_URL=http://localhost:6333
```

### 运行 Demo

目前项目提供一个交互式 Demo 演示 MemorySystem 的完整功能：

```bash
bun run demos/chatLoopDemo.ts
```

该 Demo 将启动一个交互式对话循环，演示：
- 八阶段记忆处理流程 (QUERY_ANALYSIS → RETRIEVE → SELECT → CONTEXT_BUILD → RESOLVE → GENERATE → STORE → CONFIRM)
- 情景记忆与语义记忆的检索
- 事件自动管理和合并建议

输入 `quit` 或 `exit` 退出。

## 相关论文

| 论文 | 描述 | 参考实现 |
|------|------|----------|
| SYNAPSE | 双层记忆 + 传播激活 | EpisodicMemory, SemanticMemory, QueryProcessor |
| ProcMEM | 可复用程序记忆 | 暂无，后续打算参考论文来实现程序记忆 |