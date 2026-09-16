import { t } from '../../i18n';
// 可视化公式面板的符号表：每一项给 Typst 与 LaTeX 两种写法，按钮上用 KaTeX 画个样子。
// 模板里的 □ 是占位，插入后光标停在第一个占位上。

export interface PaletteItem {
  /** 按钮上画的 LaTeX（只用于显示） */
  show: string;
  typst: string;
  latex: string;
  title?: string;
}

export interface PaletteGroup {
  name: string;
  items: PaletteItem[];
}

const S = (show: string, typst: string, latex: string, title?: string): PaletteItem => ({ show, typst, latex, title });

export const PALETTE: PaletteGroup[] = [
  {
    name: t("结构"),
    items: [
      S('\\frac{a}{b}', '(□)/(□)', '\\frac{□}{□}', t("分式")),
      S('x^{2}', '□^(□)', '□^{□}', t("上标")),
      S('x_{i}', '□_(□)', '□_{□}', t("下标")),
      S('x_{i}^{2}', '□_(□)^(□)', '□_{□}^{□}', t("上下标")),
      S('\\sqrt{x}', 'sqrt(□)', '\\sqrt{□}', t("平方根")),
      S('\\sqrt[n]{x}', 'root(□, □)', '\\sqrt[□]{□}', t("n 次根")),
      S('\\sum_{i=1}^{n}', 'sum_(□)^(□)', '\\sum_{□}^{□}', t("求和")),
      S('\\prod_{i=1}^{n}', 'product_(□)^(□)', '\\prod_{□}^{□}', t("连乘")),
      S('\\int_{a}^{b}', 'integral_(□)^(□)', '\\int_{□}^{□}', t("积分")),
      S('\\iint', 'integral.double', '\\iint', t("二重积分")),
      S('\\oint', 'integral.cont', '\\oint', t("环路积分")),
      S('\\lim_{x\\to 0}', 'lim_(□ -> □)', '\\lim_{□ \\to □}', t("极限")),
      S('\\frac{\\mathrm{d}y}{\\mathrm{d}x}', '(dif □)/(dif □)', '\\frac{\\mathrm{d}□}{\\mathrm{d}□}', t("导数")),
      S('\\frac{\\partial y}{\\partial x}', '(diff □)/(diff □)', '\\frac{\\partial □}{\\partial □}', t("偏导")),
      S('\\left(x\\right)', '(□)', '\\left(□\\right)', t("括号")),
      S('\\left[x\\right]', '[□]', '\\left[□\\right]', t("方括号")),
      S('\\left\\{x\\right\\}', '{□}', '\\left\\{□\\right\\}', t("花括号")),
      S('\\left|x\\right|', 'abs(□)', '\\left|□\\right|', t("绝对值")),
      S('\\left\\|x\\right\\|', 'norm(□)', '\\left\\|□\\right\\|', t("范数")),
      S('\\langle x\\rangle', 'angle.l □ angle.r', '\\langle □ \\rangle', t("尖括号")),
      S('\\lfloor x\\rfloor', 'floor(□)', '\\lfloor □ \\rfloor', t("向下取整")),
      S('\\lceil x\\rceil', 'ceil(□)', '\\lceil □ \\rceil', t("向上取整")),
      S('\\binom{n}{k}', 'binom(□, □)', '\\binom{□}{□}', t("二项式")),
      S('\\mathrm{e}^{x}', 'e^(□)', '\\mathrm{e}^{□}', t("指数")),
    ],
  },
  {
    name: t("矩阵"),
    items: [
      S('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', 'mat(□, □; □, □)', '\\begin{pmatrix} □ & □ \\\\ □ & □ \\end{pmatrix}', t("2×2 矩阵（圆括号）")),
      S('\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}', 'mat(delim: "[", □, □; □, □)', '\\begin{bmatrix} □ & □ \\\\ □ & □ \\end{bmatrix}', t("2×2 矩阵（方括号）")),
      S('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}', 'mat(delim: "|", □, □; □, □)', '\\begin{vmatrix} □ & □ \\\\ □ & □ \\end{vmatrix}', t("行列式")),
      S('\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}', 'mat(□, □, □; □, □, □; □, □, □)', '\\begin{pmatrix} □ & □ & □ \\\\ □ & □ & □ \\\\ □ & □ & □ \\end{pmatrix}', t("3×3 矩阵")),
      S('\\begin{pmatrix}a\\\\b\\end{pmatrix}', 'vec(□, □)', '\\begin{pmatrix} □ \\\\ □ \\end{pmatrix}', t("列向量")),
      S('\\begin{cases}a&x>0\\\\b&x\\le 0\\end{cases}', 'cases(□ & "if" □, □ & "otherwise")', '\\begin{cases} □ & □ \\\\ □ & □ \\end{cases}', t("分段函数")),
      S('\\ddots', 'dots.down', '\\ddots'), S('\\cdots', 'dots.c', '\\cdots'), S('\\vdots', 'dots.v', '\\vdots'),
    ],
  },
  {
    name: t("希腊"),
    items: [
      ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'], ['theta', 'θ'], ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'], ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
      ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
    ].map(([n]) => S(`\\${n}`, n, `\\${n}`)).concat([S('\\varepsilon', 'epsilon.alt', '\\varepsilon'), S('\\varphi', 'phi.alt', '\\varphi'), S('\\vartheta', 'theta.alt', '\\vartheta'), S('\\nabla', 'nabla', '\\nabla'), S('\\partial', 'diff', '\\partial'), S('\\infty', 'oo', '\\infty')]),
  },
  {
    name: t("运算"),
    items: [
      S('\\times', 'times', '\\times'), S('\\div', 'div', '\\div'), S('\\pm', 'plus.minus', '\\pm'), S('\\mp', 'minus.plus', '\\mp'), S('\\cdot', 'dot.op', '\\cdot'), S('\\circ', 'compose', '\\circ'), S('\\ast', 'ast', '\\ast'), S('\\otimes', 'times.circle', '\\otimes'), S('\\oplus', 'plus.circle', '\\oplus'),
      S('=', '=', '='), S('\\ne', '!=', '\\ne'), S('\\approx', 'approx', '\\approx'), S('\\equiv', 'equiv', '\\equiv'), S('\\sim', 'tilde.op', '\\sim'), S('\\propto', 'prop', '\\propto'), S('<', '<', '<'), S('>', '>', '>'), S('\\le', '<=', '\\le'), S('\\ge', '>=', '\\ge'), S('\\ll', '<<', '\\ll'), S('\\gg', '>>', '\\gg'),
      S('\\in', 'in', '\\in'), S('\\notin', 'in.not', '\\notin'), S('\\subset', 'subset', '\\subset'), S('\\subseteq', 'subset.eq', '\\subseteq'), S('\\cup', 'union', '\\cup'), S('\\cap', 'sect', '\\cap'), S('\\emptyset', 'emptyset', '\\emptyset'), S('\\forall', 'forall', '\\forall'), S('\\exists', 'exists', '\\exists'),
      S('\\land', 'and', '\\land'), S('\\lor', 'or', '\\lor'), S('\\neg', 'not', '\\neg'), S('\\perp', 'perp', '\\perp'), S('\\parallel', 'parallel', '\\parallel'), S('\\angle', 'angle', '\\angle'), S('^\\circ', 'degree', '^\\circ'), S('\\%', '%', '\\%'), S('\\hbar', 'planck.reduce', '\\hbar'),
    ],
  },
  {
    name: t("箭头"),
    items: [
      S('\\to', '->', '\\to'), S('\\gets', '<-', '\\gets'), S('\\leftrightarrow', '<->', '\\leftrightarrow'), S('\\Rightarrow', '=>', '\\Rightarrow'), S('\\Leftarrow', '<==', '\\Leftarrow'), S('\\Leftrightarrow', '<=>', '\\Leftrightarrow'), S('\\mapsto', '|->', '\\mapsto'), S('\\uparrow', 'arrow.t', '\\uparrow'), S('\\downarrow', 'arrow.b', '\\downarrow'), S('\\nearrow', 'arrow.tr', '\\nearrow'), S('\\longrightarrow', '-->', '\\longrightarrow'), S('\\xrightarrow{a}', 'arrow.r.long^(□)', '\\xrightarrow{□}', t("带注的箭头")),
    ],
  },
  {
    name: t("修饰"),
    items: [
      S('\\hat{x}', 'hat(□)', '\\hat{□}'), S('\\bar{x}', 'macron(□)', '\\bar{□}'), S('\\overline{x}', 'overline(□)', '\\overline{□}'), S('\\vec{x}', 'arrow(□)', '\\vec{□}'), S('\\dot{x}', 'dot(□)', '\\dot{□}'), S('\\ddot{x}', 'dot.double(□)', '\\ddot{□}'), S('\\tilde{x}', 'tilde(□)', '\\tilde{□}'), S('\\underline{x}', 'underline(□)', '\\underline{□}'),
      S('\\overbrace{x}^{n}', 'overbrace(□, □)', '\\overbrace{□}^{□}'), S('\\underbrace{x}_{n}', 'underbrace(□, □)', '\\underbrace{□}_{□}'),
      S('\\mathbf{x}', 'bold(□)', '\\mathbf{□}', t("粗体")), S('\\mathrm{x}', 'upright(□)', '\\mathrm{□}', t("正体")), S('\\mathbb{R}', 'RR', '\\mathbb{R}', t("实数集")), S('\\mathcal{L}', 'cal(□)', '\\mathcal{□}', t("花体")), S(t("\\text{文字}"), '"□"', '\\text{□}', t("文字")),
      S('\\sin', 'sin', '\\sin'), S('\\cos', 'cos', '\\cos'), S('\\tan', 'tan', '\\tan'), S('\\ln', 'ln', '\\ln'), S('\\log', 'log', '\\log'), S('\\exp', 'exp', '\\exp'), S('\\max', 'max', '\\max'), S('\\min', 'min', '\\min'), S('\\det', 'det', '\\det'),
    ],
  },
];

/** 把模板插到光标处；返回新文本与该落的光标位置（第一个占位上，选中它） */
export function insertTemplate(text: string, selStart: number, selEnd: number, tpl: string): { text: string; start: number; end: number } {
  const selected = text.slice(selStart, selEnd);
  // 选中了东西：塞进第一个占位
  let piece = tpl;
  if (selected && piece.includes('□')) piece = piece.replace('□', selected);
  const before = text.slice(0, selStart);
  const after = text.slice(selEnd);
  // 前面贴着字时补个空格；上下标模板（^ _ 开头）例外，它就是要贴着前面那个量
  const needSpaceBefore = before.length > 0 && !/\s$/.test(before) && !/^[\^_]/.test(piece);
  const needSpaceAfter = after.length > 0 && !/^\s/.test(after);
  const inserted = (needSpaceBefore ? ' ' : '') + piece + (needSpaceAfter ? ' ' : '');
  const out = before + inserted + after;
  const hole = out.indexOf('□', before.length);
  if (hole >= 0) return { text: out, start: hole, end: hole + 1 };
  const pos = before.length + inserted.length;
  return { text: out, start: pos, end: pos };
}

/** 从当前光标往后找下一个占位 */
export function nextHole(text: string, from: number): [number, number] | null {
  const i = text.indexOf('□', from);
  if (i >= 0) return [i, i + 1];
  const j = text.indexOf('□');
  return j >= 0 ? [j, j + 1] : null;
}
