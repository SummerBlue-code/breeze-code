/**
 * Qdrant 向量索引封装
 * 支持完整的 CRUD 操作、元数据过滤、持久化存储
 */

import { QdrantClient } from "@qdrant/js-client-rest";

export interface VectorIndexConfig {
  /** Qdrant 客户端配置 */
  clientConfig: {
    url: string;
    apiKey?: string;
  };

  /** 集合名称 */
  collectionName: string;

  /** 向量维度 */
  dimension: number;

  /** 距离度量（默认 cosine） */
  distance?: "Cosine" | "Euclid" | "Dot";

  /** 是否在初始化时自动创建集合 */
  autoCreateCollection?: boolean;
}

export interface SearchResult {
  id: string;
  score: number;
  payload?: Record<string, any>;
}

export class VectorIndex {
  private readonly client: QdrantClient;
  private readonly config: Required<Omit<VectorIndexConfig, "clientConfig">> & {
    clientConfig: VectorIndexConfig["clientConfig"];
  };

  constructor(config: VectorIndexConfig) {
    this.config = {
      clientConfig: config.clientConfig,
      collectionName: config.collectionName,
      dimension: config.dimension,
      distance: config.distance || "Cosine",
      autoCreateCollection: config.autoCreateCollection ?? true,
    };

    // 初始化 Qdrant 客户端
    this.client = new QdrantClient({
      url: this.config.clientConfig.url,
      apiKey: this.config.clientConfig.apiKey,
    });

    console.log(
      `[VectorIndex] ✅ Qdrant 连接 | 集合: ${this.config.collectionName} | ${this.config.dimension}d`,
    );
  }

  /**
   * 确保集合存在（按需创建）
   */
  private async ensureCollectionExists(): Promise<void> {
    try {
      await this.client.getCollection(this.config.collectionName);
    } catch (error) {
      if (this.config.autoCreateCollection) {
        console.log(
          `[VectorIndex] 集合不存在，正在创建: ${this.config.collectionName}`,
        );
        await this.createCollection();
      } else {
        throw new Error(`集合 ${this.config.collectionName} 不存在`);
      }
    }
  }

  /**
   * 创建集合
   */
  private async createCollection(): Promise<void> {
    try {
      // 先检查集合是否已存在
      const existing = await this.client.getCollection(
        this.config.collectionName,
      );

      // 验证现有集合配置是否匹配
      const vectorConfig = existing.config.params.vectors;
      if (typeof vectorConfig === "object" && vectorConfig !== null) {
        if (vectorConfig.size !== this.config.dimension) {
          throw new Error(
            `集合维度不匹配: 期望 ${this.config.dimension}d, 实际 ${vectorConfig.size}d`,
          );
        }
        if (vectorConfig.distance !== this.config.distance) {
          throw new Error(
            `集合距离度量不匹配: 期望 ${this.config.distance}, 实际 ${vectorConfig.distance}`,
          );
        }
        console.log(
          `[VectorIndex] 集合已存在且配置匹配: ${this.config.collectionName}`,
        );
        return;
      }
    } catch (error) {
      // 集合不存在，继续创建
      if ((error as any)?.status === 404) {
        // 继续创建逻辑
      } else {
        throw error;
      }
    }

    // 创建新集合
    const collectionConfig = {
      vectors: {
        size: this.config.dimension,
        distance: this.config.distance,
      },
    };

    await this.client.createCollection(
      this.config.collectionName,
      collectionConfig,
    );
    console.log(`[VectorIndex] 集合创建成功: ${this.config.collectionName}`);
  }

  /**
   * 添加向量到索引
   */
  async add(
    id: string,
    vector: Float32Array,
    payload: Record<string, any> = {},
  ): Promise<void> {
    await this.ensureCollectionExists();

    // Qdrant 要求 ID 为数字或字符串
    const pointId = id;

    // 转换为 number[]（Qdrant 要求）
    const vectorAsNumberArray = Array.from(vector);

    const points = [
      {
        id: pointId,
        vector: vectorAsNumberArray,
        payload: {
          ...payload,
          _id: id, // 保留原始ID
          _timestamp: Date.now(),
        },
      },
    ];

    console.log(
      `[VectorIndex] 添加向量: ${pointId} | ${vectorAsNumberArray.length}d`,
    );

    try {
      await this.client.upsert(this.config.collectionName, {
        wait: true,
        points,
      });
    } catch (error: any) {
      if (error?.status === 409) {
        throw new Error(
          `Qdrant 冲突错误: 可能是向量维度不匹配\n` +
            `检查集合 "${this.config.collectionName}" 的配置是否为 ${this.config.dimension}d`,
        );
      }
      throw error;
    }
  }

  /**
   * 搜索最相似的 K 个向量
   */
  async search(query: Float32Array, topK: number, filter?: any): Promise<any> {
    await this.ensureCollectionExists();

    const searchRequest = {
      vector: Array.from(query),
      limit: topK,
      with_payload: true,
      with_vector: false,
      filter: undefined,
    };

    if (filter) {
      searchRequest.filter = filter;
    }

    const response = await this.client.search(
      this.config.collectionName,
      searchRequest,
    );

    return response.map((hit) => ({
      id: (hit.payload?._id as string) || String(hit.id),
      score: hit.score,
      payload: hit.payload,
    }));
  }

  /**
   * 根据 ID 获取向量（用于更新/删除前的验证）
   */
  async getById(id: string): Promise<any> {
    await this.ensureCollectionExists();

    const response = await this.client.retrieve(this.config.collectionName, {
      ids: [id],
      with_payload: true,
      with_vector: false,
    });

    if (response.length === 0) return null;

    return {
      id: (response[0]!.payload?._id as string) || String(response[0]!.id),
      score: 1.0, // 精确匹配
      payload: response[0]!.payload,
    };
  }

  /**
   * 删除指定 ID 的向量
   */
  async remove(id: string): Promise<boolean> {
    await this.ensureCollectionExists();

    try {
      await this.client.delete(this.config.collectionName, {
        wait: true,
        points: [id],
      });
      return true;
    } catch (error) {
      console.error(`[VectorIndex] 删除失败 (${id}):`, error);
      return false;
    }
  }

  /**
   * 清空集合（谨慎使用）
   */
  async clear(): Promise<void> {
    await this.ensureCollectionExists();

    // Qdrant 没有直接的"清空"操作，需要删除并重建
    await this.client.deleteCollection(this.config.collectionName);
    await this.createCollection();

    console.log(`[VectorIndex] 集合已清空: ${this.config.collectionName}`);
  }

  /**
   * 获取集合状态
   */
  async getHealthStatus() {
    try {
      const info = await this.client.getCollection(this.config.collectionName);
      return {
        status: "healthy",
        type: "qdrant",
        collection: this.config.collectionName,
        vectorsCount: info.indexed_vectors_count,
        dimension: this.config.dimension,
        distance: this.config.distance,
      };
    } catch (error) {
      return {
        status: "error",
        type: "qdrant",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取向量数量
   */
  async size(): Promise<number> {
    try {
      const info = await this.client.getCollection(this.config.collectionName);
      return info.indexed_vectors_count ? info.indexed_vectors_count : 0;
    } catch (error) {
      return 0;
    }
  }
}
