// 定理类环境：模板 src/math/theorem.typ 的十三个（与 hithesis 同）加不编号的 proof，词条在 theorem 桶
export const THEOREM_KINDS = ['theorem', 'lemma', 'definition', 'proposition', 'corollary', 'axiom', 'assumption', 'example', 'remark', 'problem', 'conjecture', 'fact', 'exercise', 'proof'] as const;
export type TheoremKind = (typeof THEOREM_KINDS)[number];
export const THEOREM_NAMES: Record<TheoremKind, { zh: string; en: string }> = {
  theorem: { zh: '定理', en: 'Theorem' },
  lemma: { zh: '引理', en: 'Lemma' },
  definition: { zh: '定义', en: 'Definition' },
  proposition: { zh: '命题', en: 'Proposition' },
  corollary: { zh: '推论', en: 'Corollary' },
  axiom: { zh: '公理', en: 'Axiom' },
  assumption: { zh: '假设', en: 'Assumption' },
  example: { zh: '例', en: 'Example' },
  remark: { zh: '注释', en: 'Remark' },
  problem: { zh: '问题', en: 'Problem' },
  conjecture: { zh: '猜想', en: 'Conjecture' },
  fact: { zh: '事实', en: 'Fact' },
  exercise: { zh: '练习', en: 'Exercise' },
  proof: { zh: '证明', en: 'Proof' },
};
export const theoremKind = (v: unknown): TheoremKind => (THEOREM_KINDS.includes(v as TheoremKind) ? (v as TheoremKind) : 'theorem');
/** 名与号、号与说明之间：前一截末字是中日文字不空，是西文空一格（模板 _join，同题注） */
export const joinHead = (a: string, b: string) => (!b ? a : !a || /[⺀-鿿豈-﫿]$/.test(a) ? a + b : `${a} ${b}`);
