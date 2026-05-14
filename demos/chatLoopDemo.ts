/**
 * MemorySystem ChatLoop Demo
 *
 * 这个 demo 展示了如何使用 MemorySystem 的 chatLoop 方法
 * 进行交互式对话，并自动管理记忆。
 *
 * 运行方式：
 * 1. 确保 Qdrant 服务运行在 localhost:6333
 * 2. 确保 OPENAI_API_KEY 环境变量已设置
 * 3. 运行: npx ts-node demos/chatLoopDemo.ts
 */

import {
    MemorySystem,
    type MemorySystemConfig,
} from "../src/Agent/Memory/MemorySystem";

// 测试配置
const TEST_INTERACTIONS_COLLECTION = "_test_ms_bc_interactions";
const TEST_EVENTS_COLLECTION = "_test_ms_bc_events";
const TEST_MESSAGES_COLLECTION = "_test_ms_bc_messages";

// 创建 MemorySystem 配置
const config: MemorySystemConfig = {
    encoder: {
        apiKey: "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
        baseURL: "https://yunwu.ai/v1",
        modelName: "text-embedding-3-small",
        dimension: 1536,
        timeout: 10000,
    },
    episodic: {
        dimension: 1536,
        interactionsCollectionName: TEST_INTERACTIONS_COLLECTION,
        eventsCollectionName: TEST_EVENTS_COLLECTION,
        messagesCollectionName: TEST_MESSAGES_COLLECTION,
        qdrantUrl: "http://localhost:6333",
    },
    llm: {
        apiKey: "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
        baseURL: "https://yunwu.ai/v1",
        model: "gpt-5-nano",
    },
};

async function main() {
    console.log("=".repeat(60));
    console.log("MemorySystem ChatLoop Demo");
    console.log("=".repeat(60));
    console.log();
    console.log("这个 demo 将启动一个交互式对话循环。");
    console.log("每次对话后，系统会：");
    console.log("1. 分析哪些事件与当前问题相关");
    console.log("2. 判断对话内容是否有价值（跳过寒暄）");
    console.log("3. 分析应该加入哪个事件或创建新事件");
    console.log("4. 如果需要合并，会询问您的意见");
    console.log();
    console.log("输入 'quit' 或 'exit' 退出");
    console.log("=".repeat(60));
    console.log();

    // 创建 MemorySystem 实例
    const memorySystem = new MemorySystem(config);

    // 启动对话循环
    await memorySystem.chatLoop({
        welcomeMessage: "欢迎使用 MemorySystem！开始对话吧（输入 quit 退出）",
        exitCommands: ["quit", "exit", "q"],
        onStart: (history) => {
            console.log("[系统] 对话开始");
        },
        onEnd: (history, finalEventId) => {
            console.log("[系统] 对话结束");
            console.log(`[系统] 最终事件 ID: ${finalEventId}`);
            console.log(`[系统] 对话历史长度: ${history.length}`);
        },
        onError: (error) => {
            console.error("[系统错误]", error.message);
        },
    });
}

// 运行 demo
main().catch(console.error);
