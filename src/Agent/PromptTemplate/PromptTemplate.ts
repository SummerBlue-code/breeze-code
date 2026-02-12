/**
 * PromptTemplate - 支持 {{var}} 语法的轻量模板引擎
 * @template T 变量类型（建议显式声明接口）
 */
export class PromptTemplate<
  T extends Record<string, any> = Record<string, any>,
> {
  private readonly regex = /\{\{(\w+)(?:\|default:([^}]+))?\}\}/g;
  private readonly requiredKeys: Set<string> = new Set();
  private readonly hasDefaults: Set<string> = new Set();

  /**
   *
   * @param template
   * @param options strict: true：渲染时强制校验所有必需变量（即模板中出现且无默认值的变量）是否已提供，缺失则抛出错误。strict: false：缺失变量时静默处理，保留原始占位符 {{var}}，适合调试或非关键场景。 autoTrim: 自动去除空白
   *
   */
  constructor(
    private template: string,
    private options: { strict?: boolean; autoTrim?: boolean } = {},
  ) {
    // 预解析：提取所有变量名（含默认值标记）
    let match: RegExpExecArray | null;
    while ((match = this.regex.exec(template)) !== null) {
      const [_, key, defaultValue] = match;
      this.requiredKeys.add(key!);
      if (defaultValue !== undefined) this.hasDefaults.add(key!);
    }
  }

  /** 渲染模板 */
  render(variables: Partial<T>): string {
    if (this.options.strict) {
      const missing = Array.from(this.requiredKeys).filter(
        (k) => !(k in variables) && !this.hasDefaults.has(k),
      );
      if (missing.length > 0) {
        throw new Error(`Missing required variables: ${missing.join(", ")}`);
      }
    }

    let result = this.template.replace(
      this.regex,
      (_, key: string, defaultValue?: string) => {
        if (key in variables && variables[key] !== undefined) {
          return String(variables[key]);
        }
        return defaultValue !== undefined ? defaultValue : `{{${key}}}`; // 保留占位符或用默认值
      },
    );

    return this.options.autoTrim ? result.trim() : result;
  }

  /** 获取模板所需变量名列表 */
  getRequiredVariables(): string[] {
    return Array.from(this.requiredKeys);
  }

  /** 验证变量是否满足要求（strict 模式下必需） */
  validate(variables: Partial<T>): boolean {
    return this.getRequiredVariables().every(
      (k) => k in variables || this.hasDefaults.has(k),
    );
  }
}
