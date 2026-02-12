import { getEmbeddingService } from "@/Utils/Embedding";
import { WorkingMemory } from "@/Agent/Memory/WorkingMemory/WorkingMemory";
import type { SensoryInput } from "@/Agent/Memory/SensoryLayer/types";
import { VectorIndex } from "@/Utils/VectorIndex";
import { SensoryLayer } from "@/Agent/Memory/SensoryLayer/SensoryLayer";
import { OpenAILLM } from "@/LLM/implementations/OpenAILLM";

// 初始化
const embeddingService = getEmbeddingService();
const vectorIndex = new VectorIndex({
  clientConfig: { url: "http://localhost:6333" },
  collectionName: "memory",
  dimension: 1536,
});
const llm = new OpenAILLM(
  "https://yunwu.ai/v1",
  "sk-3rsiLb4bRW3aCBhhheeQiKBcEdd4nuTkphOVjlqbiG4fmKAY",
);
const sensoryLayer = new SensoryLayer(embeddingService, llm);
const workingMemory = new WorkingMemory(8, embeddingService, vectorIndex);

const dialogue: SensoryInput[] = [
  {
    type: "text",
    content: "我想预订明天北京到上海的机票，这真赞",
    source: "user",
  },
  { type: "text", content: "最好是上午的航班", source: "user" },
  { type: "text", content: "我姓张，喜欢靠窗座位", source: "user" },
];

async function demo() {
  console.log("🚀 Agent记忆系统 - 纯OpenAI实现\n");

  // 处理对话
  for (const [i, input] of dialogue.entries()) {
    const feature = await sensoryLayer.process(input);
    const slotId = await workingMemory.addFromSensory(feature, {
      returnScoringResult: true,
    });
    console.log(
      `[${i + 1}] "${input.content}" → 重要性: ${feature.importanceScore.toFixed(2)} ${slotId ? "✅" : "❌"} 评分结果: ${JSON.stringify(slotId!.scoringResult)}`,
    );
  }

  // 检索测试
  console.log('\n🔍 检索 "机票":');
  const results = await workingMemory.search("机票", { topK: 2 });
  results.forEach((r, i) =>
    console.log(`  [${i + 1}] ${JSON.stringify(r.content)}`),
  );

  // 显示指标
  const health = embeddingService.getHealthStatus();
  console.log(
    `\n📊 嵌入服务: ${health.metrics.totalRequests}次请求 | 成功率: ${health.metrics.successRate}`,
  );
}

demo().catch((err) => {
  console.error("\n❌ 错误:", err.message);
  if (err.message.includes("OPENAI_API_KEY")) {
    console.log("\n💡 修复: 创建 .env 文件并填入 API 密钥");
    console.log(
      "   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    );
  }
  process.exit(1);
});
