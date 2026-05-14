// bun:sqlite import

/**
 * SQLiteClient 配置
 */
export interface SQLiteClientConfig {
  dbPath?: string;
}

/**
 * SQLiteClient
 * 使用 bun:sqlite 的 SQLite 数据库客户端
 */
export class SQLiteClient {
  private db: any;

  constructor(config: SQLiteClientConfig = {}) {
    // 使用 bun:sqlite
    const { Database } = require("bun:sqlite");
    this.db = new Database(config.dbPath || ":memory:");
  }

  /**
   * 执行 SQL 语句
   */
  run(sql: string, params: unknown[] = []): void {
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
    stmt.finalize();
  }

  /**
   * 查询单条记录
   */
  get<T>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params) as T | undefined;
    stmt.finalize();
    return result;
  }

  /**
   * 查询多条记录
   */
  all<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    const results = stmt.all(...params) as T[];
    stmt.finalize();
    return results;
  }

  /**
   * 执行 SQL 脚本
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.db.close();
  }
}

export default SQLiteClient;
