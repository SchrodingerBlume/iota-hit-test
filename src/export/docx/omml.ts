// MathML（MathLive 吐的那一档）→ Word 的 OMML。只认 MathLive 会产出的元素，不认识的当文字
const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BIG = new Set(['∑', '∏', '∫', '∬', '∭', '∮', '⋃', '⋂', '⋁', '⋀', '∐']);
const INVISIBLE = new Set(['⁡', '⁢', '⁣', '⁤']);
const ACCENT: Record<string, string> = { '^': '̂', 'ˆ': '̂', '¯': '̅', '‾': '̅', '⃗': '⃗', '→': '⃗', '˙': '̇', '¨': '̈', '~': '̃', '˜': '̃', 'ˇ': '̌', '´': '́', '`': '̀' };
const OPEN = new Set(['(', '[', '{', '|', '‖', '⟨', '⌊', '⌈']);
const CLOSE = new Set([')', ']', '}', '|', '‖', '⟩', '⌋', '⌉']);

const run = (text: string, upright = false) => text ? `<m:r>${upright ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>` : '';
const e = (inner: string) => `<m:e>${inner}</m:e>`;

function children(el: Element): string { return [...el.childNodes].map((c) => (c.nodeType === 1 ? conv(c as Element) : run((c.textContent ?? '').trim()))).join(''); }

function conv(el: Element | undefined): string {
  if (!el) return '';
  const tag = el.localName;
  // MathLive 认不得的命令吐 merror：整条当转换失败，让上层退回去画图
  if (tag === 'merror') throw new Error('unsupported LaTeX');
  const kids = [...el.children];
  const text = (el.textContent ?? '');
  switch (tag) {
    case 'math': case 'mrow': case 'mstyle': case 'semantics': case 'mpadded': case 'mphantom': {
      // 括号对：开头是开号、结尾是闭号 → m:d
      if (tag === 'mrow' && kids.length >= 2 && kids[0].localName === 'mo' && OPEN.has(kids[0].textContent ?? '') && kids[kids.length - 1].localName === 'mo' && CLOSE.has(kids[kids.length - 1].textContent ?? '')) {
        const beg = kids[0].textContent ?? '(', end = kids[kids.length - 1].textContent ?? ')';
        const inner = kids.slice(1, -1).map(conv).join('');
        return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr>${e(inner)}</m:d>`;
      }
      return children(el);
    }
    case 'mi': return run(text, text.length > 1 && /^[A-Za-z]+$/.test(text));
    case 'mn': return run(text);
    case 'mo': return INVISIBLE.has(text) ? '' : run(text, /^[a-z]{2,}$/i.test(text));
    case 'mtext': return `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
    case 'mspace': return run(' ');
    case 'mfrac': return `<m:f>${el.getAttribute('linethickness') === '0' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${conv(kids[0])}</m:num><m:den>${conv(kids[1])}</m:den></m:f>`;
    case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(children(el))}</m:rad>`;
    case 'mroot': return `<m:rad><m:deg>${conv(kids[1])}</m:deg>${e(conv(kids[0]))}</m:rad>`;
    case 'msup': case 'msub': case 'msubsup': {
      const base = kids[0];
      const isBig = base?.localName === 'mo' && BIG.has(base.textContent ?? '');
      const sub = tag === 'msup' ? '' : conv(kids[1]);
      const sup = tag === 'msub' ? '' : conv(kids[tag === 'msup' ? 1 : 2]);
      if (isBig) return nary(base.textContent ?? '∑', sub, sup, '', 'subSup');
      if (tag === 'msup') return `<m:sSup>${e(conv(base))}<m:sup>${sup}</m:sup></m:sSup>`;
      if (tag === 'msub') return `<m:sSub>${e(conv(base))}<m:sub>${sub}</m:sub></m:sSub>`;
      return `<m:sSubSup>${e(conv(base))}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
    }
    case 'munder': case 'mover': case 'munderover': {
      const base = kids[0];
      const isBig = base?.localName === 'mo' && BIG.has(base.textContent ?? '');
      const under = tag === 'mover' ? '' : conv(kids[1]);
      const over = tag === 'munder' ? '' : conv(kids[tag === 'mover' ? 1 : 2]);
      if (isBig) return nary(base.textContent ?? '∑', under, over, '', 'undOvr');
      if (tag === 'mover' && el.getAttribute('accent') === 'true') {
        const ch = kids[1]?.textContent ?? '';
        if (ch === '¯' || ch === '‾') return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${e(conv(base))}</m:bar>`;
        return `<m:acc><m:accPr><m:chr m:val="${esc(ACCENT[ch] ?? ch)}"/></m:accPr>${e(conv(base))}</m:acc>`;
      }
      if (tag === 'munder' && el.getAttribute('accentunder') === 'true' && (kids[1]?.textContent === '̲' || kids[1]?.textContent === '_')) return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${e(conv(base))}</m:bar>`;
      if (tag === 'munder') return `<m:limLow>${e(conv(base))}<m:lim>${under}</m:lim></m:limLow>`;
      if (tag === 'mover') return `<m:limUpp>${e(conv(base))}<m:lim>${over}</m:lim></m:limUpp>`;
      return `<m:limUpp>${e(`<m:limLow>${e(conv(base))}<m:lim>${under}</m:lim></m:limLow>`)}<m:lim>${over}</m:lim></m:limUpp>`;
    }
    case 'mfenced': {
      const beg = el.getAttribute('open') ?? '(', end = el.getAttribute('close') ?? ')';
      return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr>${kids.map((k) => e(conv(k))).join('')}</m:d>`;
    }
    case 'mtable': {
      const rows = kids.filter((k) => k.localName === 'mtr' || k.localName === 'mlabeledtr');
      const cols = Math.max(1, ...rows.map((r) => r.children.length));
      const body = rows.map((r) => `<m:mr>${[...r.children].map((c) => e(children(c))).join('')}${'<m:e/>'.repeat(cols - r.children.length)}</m:mr>`).join('');
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>${body}</m:m>`;
    }
    case 'mtr': case 'mtd': return children(el);
    case 'menclose': return children(el);
    default: return kids.length ? children(el) : run(text);
  }
}

function nary(chr: string, sub: string, sup: string, body: string, loc: 'subSup' | 'undOvr'): string {
  return `<m:nary><m:naryPr><m:chr m:val="${esc(chr)}"/><m:limLoc m:val="${loc}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup>${e(body)}</m:nary>`;
}

/** 大算符后面紧跟的那一段并进它的正体（Word 把 ∑ 后面的内容放在 m:e 里） */
function foldNary(xml: string): string {
  return xml.replace(/(<m:nary>.*?<\/m:sup>)<m:e><\/m:e><\/m:nary>((?:<m:r>.*?<\/m:r>|<m:sSub>.*?<\/m:sSub>|<m:sSup>.*?<\/m:sSup>|<m:sSubSup>.*?<\/m:sSubSup>|<m:f>.*?<\/m:f>)+)/g, (_m, head, rest) => `${head}<m:e>${rest}</m:e></m:nary>`);
}

/** 一段 MathML → `<m:oMath>…</m:oMath>`；display 时包成 oMathPara（Word 的「显示公式」），
 *  number 是 Word 认的编号写法：公式末尾 `#(1-1)` 会被右对齐到行尾 */
export function mathmlToOmml(mathml: string, opts: { display?: boolean; number?: string } = {}): string {
  const doc = new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML">${mathml.replace(/^<math[^>]*>|<\/math>$/g, '')}</math>`, 'application/xml');
  const root = doc.documentElement;
  const bad = root.localName === 'parsererror' || !!doc.querySelector('parsererror');
  const inner = bad ? run(mathml.replace(/<[^>]+>/g, '')) : foldNary(conv(root));
  const math = `<m:oMath>${inner}${opts.number ? run(`#${opts.number}`) : ''}</m:oMath>`;
  if (!opts.display) return `<m:oMath xmlns:m="${NS}">${inner}</m:oMath>`;
  return `<m:oMathPara xmlns:m="${NS}"><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${math}</m:oMathPara>`;
}
