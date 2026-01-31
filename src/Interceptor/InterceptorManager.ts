import type { Interceptor, InterceptorContext } from "./types";

/**
 * 拦截器管理器
 *
 * 使用示例：
 * ```ts
 * function fn(id: number) {
 *    return id + 1;
 * }
 * const interceptorManager = createInterceptorManager(fn);
 * const logInterceptor = {
 *  before: (context, id) {
 *    if (id <= 0) {
 *      return false; // 中断
 *    }
 *    console.log(`current id: ${id}`);
 *    return [id];
 *  }
 *  after: (context, result) {
 *    console.log(`result id: ${result}`);
 *    return result;
 *  }
 * }
 * interceptorManager.use(logInterceptor); // 返回拦截器的下标: 0
 * context = {};
 * const result = await interceptorManager.execute(fn, context, 1);
 * console.log(result); // 2
 * const result2 = await interceptorManager.execute(fn, context, 0);
 * console.log(result2); // undefined
 * ```
 *
 * // 输出：
 * // current id: 1
 * // result id: 2
 * // 2
 * // undefined
 *
 *
 */
export class InterceptorManager<TArgs extends any[], TReturn> {
  private interceptors: Array<Interceptor<TArgs, TReturn>> = [];

  /**
   * 添加拦截器
   * @returns 拦截器 ID（可用于 eject）
   */
  use(interceptor: Interceptor<TArgs, TReturn>): number {
    this.interceptors.push(interceptor);
    return this.interceptors.length - 1; // 返回索引作为 ID
  }

  /**
   * 移除拦截器
   */
  eject(id: number): void {
    if (id >= 0 && id < this.interceptors.length) {
      this.interceptors[id] = null as any; // 标记为 null，避免重排
    }
  }

  /**
   * 执行拦截器链（洋葱模型）
   */
  async execute(
    fn: (...args: TArgs) => Promise<TReturn>,
    context: InterceptorContext = {},
    ...args: TArgs
  ): Promise<TReturn | undefined> {
    // 过滤掉被 eject 的拦截器
    const activeInterceptors = this.interceptors.filter((i) => i != null);

    // 递归实现洋葱模型
    const dispatch = async (index: number): Promise<TReturn | undefined> => {
      if (index >= activeInterceptors.length) {
        return await fn(...args);
      }

      const current = activeInterceptors[index]!;

      // === before 阶段 ===
      if (current.before) {
        const beforeResult = await Promise.resolve(
          current.before(context, ...args),
        );
        if (beforeResult === false) {
          return undefined; // 中断
        }
        args = beforeResult;
      }

      let result: TReturn | undefined;

      // === 执行下一层（递归）===
      try {
        result = await dispatch(index + 1);
      } catch (error) {
        // === onError 阶段 ===
        if (current.onError) {
          const handled = await Promise.resolve(
            current.onError(context, error),
          );
          if (handled !== undefined) {
            return handled; // 错误被吞掉，转为正常结果
          }
        }
        throw error; // 未处理，继续抛出
      }

      // === after 阶段（回溯时执行 → 自然逆序）===
      if (result !== undefined && current.after) {
        result = await Promise.resolve(current.after(context, result));
      }

      return result;
    };

    return dispatch(0);
  }
}

export function createInterceptorManager<
  F extends (...args: any[]) => Promise<any>,
>(fn: F) {
  type Args = Parameters<F>;
  type Return = ReturnType<F>;
  return new InterceptorManager<Args, Return>();
}
