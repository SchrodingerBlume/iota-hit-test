// 几个常见服务方的牌价与上下文窗口：花费只当「约」用，认不出的模型就不显示。
// 价格是美元/百万 token，随服务方调价会变；上下文窗口取常见档
export interface ModelInfo { in: number; out: number; ctx: number }

const TABLE: [RegExp, ModelInfo][] = [
  [/deepseek-reasoner|deepseek-r\d/i, { in: 0.55, out: 2.19, ctx: 128000 }],
  [/deepseek/i, { in: 0.27, out: 1.1, ctx: 128000 }],
  [/claude.*opus/i, { in: 15, out: 75, ctx: 200000 }],
  [/claude.*sonnet/i, { in: 3, out: 15, ctx: 200000 }],
  [/claude.*haiku/i, { in: 0.8, out: 4, ctx: 200000 }],
  [/kimi|moonshot/i, { in: 0.6, out: 2.5, ctx: 256000 }],
  [/qwen/i, { in: 0.11, out: 0.28, ctx: 131072 }],
  [/glm/i, { in: 0.11, out: 0.28, ctx: 131072 }],
  [/gpt-5/i, { in: 1.25, out: 10, ctx: 400000 }],
  [/gpt-4o|gpt-4\.1/i, { in: 2.5, out: 10, ctx: 128000 }],
  [/gemini.*pro/i, { in: 1.25, out: 10, ctx: 1000000 }],
];

export const modelInfoOf = (model: string): ModelInfo | undefined => TABLE.find(([re]) => re.test(model))?.[1];

export const costOf = (info: ModelInfo, u: { input: number; output: number }): number => (u.input / 1e6) * info.in + (u.output / 1e6) * info.out;

export const fmtCost = (usd: number): string => usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`;

/** 中英混排大约折多少 token：按字符数 × 0.6 估（中文近 1、西文约 1/4），只用来画占比 */
export const estTokens = (s: string): number => Math.round(s.length * 0.6);

const inputLen = new WeakMap<object, number>();
/** 当前上下文大约多少 token：把显示里的对话（含工具输入/结果）折进去估算 */
export function contextTokensOf(items: { text?: string; reasoning?: string; tools?: { input: unknown; result?: string }[] }[]): number {
  let n = 0;
  for (const it of items) {
    n += estTokens(it.text ?? '');
    if (it.reasoning) n += estTokens(it.reasoning);
    for (const t of it.tools ?? []) {
      const key = (t.input ?? {}) as object;
      let len = inputLen.get(key);
      if (len === undefined) { try { len = JSON.stringify(t.input ?? {}).length; } catch { len = 200; } inputLen.set(key, len); }
      n += estTokens(t.result ?? '') + Math.round(len * 0.6);
    }
  }
  return n;
}
