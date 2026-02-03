import { BaseError } from "./BaseError";

/**
 * 所有与大语言模型（LLM）交互相关的错误基类。
 *
 * 统一前缀：`LLM_`
 * 适用场景：OpenAI、Anthropic、本地模型等调用失败
 *
 * @see {@link LLMTimeoutError}
 * @see {@link LLMRateLimitError}
 * @see {@link LLMOutputParsingError}
 */
export class LLMError extends BaseError {
  constructor(
    message: string,
    code: string,
    metadata: Record<string, unknown> = {},
  ) {
    super(message, `LLM_${code}`, metadata);
  }
}

export class LLMMessageConverterError extends LLMError {
  constructor(convert_failed_message: string, origin_error: Error) {
    super(
      `以下消息转换失败: ${convert_failed_message}, 失败原因: ${origin_error.message}`,
      "MESSAGE_CONVERTER_ERROR",
      { convert_failed_message, origin_error: origin_error.message },
    );
  }
}
export class LLMToolSchemaConverterError extends LLMError {
  constructor(convert_failed_tool_metadata: string, origin_error: Error) {
    super(
      `以下工具转换失败: ${convert_failed_tool_metadata}, 失败原因: ${origin_error.message}`,
      "TOOL_SCHEMA_CONVERTER_ERROR",
      { convert_failed_tool_metadata, origin_error: origin_error.message },
    );
  }
}

export class LLMCallError extends LLMError {
  constructor(requestData: unknown, origin_error: Error) {
    super(
      `LLM 请求失败, 请求体: ${JSON.stringify(requestData)}, 失败原因: ${origin_error.message}`,
      "LLM_CALL_ERROR",
      {
        requestData: JSON.stringify(requestData),
        origin_error: origin_error.message,
      },
    );
  }
}
