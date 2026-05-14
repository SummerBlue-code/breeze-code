import OpenAI from "openai";

export class EncoderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NoDataError extends EncoderError {
  constructor() {
    super("Encoder的API调用返回了空数据", "NO_DATA");
  }
}

export class InvalidConfigError extends EncoderError {
  constructor(field: string, value: unknown, expected: string) {
    super(
      `Encoder配置无效: ${field} 值为 ${JSON.stringify(value)}, 期望 ${expected}`,
      "INVALID_CONFIG",
      { field, value, expected },
    );
  }
}

export class ApiCallFailedError extends EncoderError {
  constructor(message: string, statusCode?: number) {
    super(`Encoder的API调用失败: ${message}`, "API_CALL_FAILED", {
      statusCode,
    });
  }
}

export interface EncoderConfig {
  /** API Key */
  apiKey: string;
  /** 嵌入模型名称 */
  modelName: string;
  /** 向量维度 */
  dimension: number;
  /** 自定义 API 地址 */
  baseURL: string;
  /** 超时时间(ms) */
  timeout: number;
}

export interface IEncoder {
  encode(text: string): Promise<number[]>;
  encodeBatch(texts: string[]): Promise<number[][]>;
  health(): Promise<boolean>;
  getDimension(): number;
}

export class Encoder implements IEncoder {
  private config: EncoderConfig;
  private openai: OpenAI;

  constructor(config: EncoderConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new InvalidConfigError(
        "apiKey",
        config.apiKey,
        "API Key (如 sk-xxxxx)",
      );
    }

    if (!config.baseURL || config.baseURL.trim() === "") {
      throw new InvalidConfigError(
        "baseURL",
        config.baseURL,
        "API 地址 (如 https://api.openai.com/v1)",
      );
    }

    if (!config.modelName || config.modelName.trim() === "") {
      throw new InvalidConfigError(
        "modelName",
        config.modelName,
        "模型名称 (如 text-embedding-ada-002)",
      );
    }

    if (
      !config.dimension ||
      typeof config.dimension !== "number" ||
      config.dimension <= 0
    ) {
      throw new InvalidConfigError(
        "dimension",
        config.dimension,
        "正整数 (如 1536)",
      );
    }

    if (
      !config.timeout ||
      typeof config.timeout !== "number" ||
      config.timeout <= 0
    ) {
      throw new InvalidConfigError("timeout", config.timeout, "正整数 (毫秒)");
    }

    this.config = config;

    this.openai = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
    });
  }

  async encode(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.config.modelName,
        input: text,
        dimensions: this.config.dimension,
      });

      const data = response.data?.[0];
      if (!data) {
        throw new NoDataError();
      }

      const vector = data.embedding;

      return vector;
    } catch (error) {
      if (error instanceof EncoderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new ApiCallFailedError(message);
    }
  }

  async encodeBatch(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.config.modelName,
        input: texts,
        dimensions: this.config.dimension,
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      if (error instanceof EncoderError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new ApiCallFailedError(message);
    }
  }

  async health(): Promise<boolean> {
    try {
      const testVector = await this.encode("health check");
      return testVector.length === this.config.dimension;
    } catch {
      return false;
    }
  }

  getDimension(): number {
    return this.config.dimension;
  }
}
