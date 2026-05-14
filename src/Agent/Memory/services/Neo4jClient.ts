import neo4j, { type Driver } from "neo4j-driver";

/**
 * Neo4j 客户端配置
 */
export interface Neo4jClientConfig {
  /** Neo4j URI */
  uri: string;
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
}

/**
 * 查询结果
 */
export interface QueryResult {
  records: Record<string, unknown>[];
  summary: {
    counters: Record<string, number>;
  };
}

/**
 * Neo4j 客户端
 *
 * 用于执行原生 Cypher 查询
 */
export class Neo4jClient {
  private driver: Driver;

  constructor(config: Neo4jClientConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
    );
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    await this.driver.close();
  }

  /**
   * 验证连接
   */
  async verifyConnectivity(): Promise<boolean> {
    try {
      await this.driver.verifyConnectivity();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 执行查询
   *
   * @param cypher - Cypher 查询语句
   * @param params - 查询参数
   * @returns 查询结果
   */
  async execute(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
    const session = this.driver.session();

    try {
      const result = await session.run(cypher, params);

      const records: Record<string, unknown>[] = [];
      for (const record of result.records) {
        const obj: Record<string, unknown> = {};
        for (const key of record.keys as string[]) {
          obj[key] = record.get(key);
        }
        records.push(obj);
      }

      return {
        records,
        summary: {
          counters: result.summary.counters.toString() as any,
        },
      };
    } finally {
      await session.close();
    }
  }

  /**
   * 执行单条查询（返回第一条记录）
   */
  async executeOne(cypher: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
    const result = await this.execute(cypher, params);
    return result.records[0] || null;
  }

  /**
   * 执行写操作（自动提交事务）
   */
  async write(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
    return this.execute(cypher, params);
  }

  /**
   * 执行读操作
   */
  async read(cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> {
    return this.execute(cypher, params);
  }
}
