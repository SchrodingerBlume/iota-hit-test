// 第一次打开时的样例工程：抄自 iota-hit/template/example.typ 的片段，
// 让人一眼看到标题、图、表、公式、引用都长什么样。
import type { ThesisDoc, RichDoc } from './types';
import { newDoc } from './store';

const p = (...content: any[]): any => ({ type: 'paragraph', content: content.length ? content : undefined });
const t = (text: string, marks?: any[]): any => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const h = (level: number, text: string, en: string, uid: string): any => ({ type: 'heading', attrs: { level, en, uid }, content: [t(text)] });

export const SAMPLE_IMAGE = 'sample-bearing.png';

const body: RichDoc = {
  type: 'doc',
  content: [
    h(1, '绪论', 'Introduction', 'intro'),
    h(2, '课题背景及研究的目的和意义', 'Background, objective and significance of the subject', 'bg'),
    p(t('发展国防工业、微电子工业等尖端技术需要精密和超精密的仪器设备，精密仪器设备要求高速、高精度、低摩擦……这一段是普通正文：首行缩进两个字，行距、字号全由模板定，这里只管写字。')),
    p(t('选中文字可以'), t('加粗', [{ type: 'bold' }]), t('、'), t('强调', [{ type: 'italic' }]), t('（排成楷体）、上标 m'), t('2', [{ type: 'superscript' }]), t('，也可以插入行内公式 '), { type: 'mathInline', attrs: { src: 'p = rho R T', mode: 'typst' } }, t('，引用文献'), { type: 'cite', attrs: { keys: 'willis1828' } }, t('，或者提一句缩略语 '), { type: 'abbr', attrs: { key: 'FEM' } }, t('——首次出现自动展开，之后只印缩写。')),
    h(2, '气体润滑轴承的分类', 'Classification of gas-lubricated bearing', 'cls'),
    p(t('根据间隙内气膜压力的产生原理，气体轴承可以分为四种基本形式，其结构如'), { type: 'ref', attrs: { target: 'fig:bearing' } }, t('所示。')),
    { type: 'figure', attrs: { image: SAMPLE_IMAGE, width: 7, caption: '气体静压轴承', captionEn: 'Externally pressurized gas bearing', uid: 'bearing', label: 'fig:bearing' } },
    p(t('1 号试样的试验数据见'), { type: 'ref', attrs: { target: 'tab:sample1' } }, t('。')),
    {
      type: 'tableFigure',
      attrs: { caption: '1 号试样渗透率测试数据', captionEn: 'Data of measured permeability of sample 1', uid: 'sample1', label: 'tab:sample1' },
      content: [{
        type: 'table',
        content: [
          { type: 'tableRow', content: [['供气压力 (MPa)'], ['流量测量 (m³/h)'], ['压力差 (Pa)']].map((c) => ({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
          { type: 'tableRow', content: [['0.15'], ['0.009'], ['46 900']].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
          { type: 'tableRow', content: [['0.20'], ['0.021'], ['96 900']].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
          { type: 'tableRow', content: [['0.25'], ['0.039'], ['146 900']].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
        ],
      }],
    },
    h(2, '多孔质材料的渗透率', 'Permeability of porous materials', 'perm'),
    p(t('本文采用 Ergun 方程描述多孔质材料的渗透特性，粘性阻力系数由'), { type: 'ref', attrs: { target: 'eq:ergun' } }, t('求得：')),
    { type: 'equation', attrs: { src: 'phi.alt = D_"p"^2/150 psi^3/(1 - psi)^2', mode: 'typst', uid: 'ergun', label: 'eq:ergun', numbered: true } },
    p(t('式中 '), { type: 'mathInline', attrs: { src: 'D_"p"', mode: 'typst' } }, t(' 为多孔质材料的平均粒子直径，'), { type: 'mathInline', attrs: { src: 'psi', mode: 'typst' } }, t(' 为孔隙度。也可以用 LaTeX 写公式，底层由 mitex 转成 Typst：')),
    { type: 'equation', attrs: { src: 'C_2 = \\frac{3.5}{D_p}\\frac{1-\\psi}{\\psi^3}', mode: 'latex', uid: 'c2', label: 'eq:c2', numbered: true } },
    h(1, '基于 FLUENT 软件的轴承静态特性研究', 'Research on static characteristics of bearing based on FLUENT', 'fluent'),
    h(2, '引言', 'Introduction', 'fluent-intro'),
    p(t('利用现成的商用软件来研究流场，可以免去对 N-S 方程求解程序的编写……')),
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p(t('无序列表的一项'))] },
      { type: 'listItem', content: [p(t('另一项'))] },
    ] },
    h(2, '本章小结', 'Brief summary', 'fluent-sum'),
    p(t('……')),
  ],
};

const abstractZh: RichDoc = { type: 'doc', content: [
  p(t('气体静压轴承由于具有运动精度高、摩擦损耗小、发热变形小、寿命长、无污染等特点，在航空航天工业、半导体工业、纺织工业和测量仪器中得到广泛应用。本文在分析国内外气体静压轴承的基础上，以改善气体静压轴承的静态特性和稳定性为目的，通过理论分析、仿真计算和实验研究对局部多孔质气体静压止推轴承进行了研究。')),
  p(t('本文在理论分析的基础上，建立局部多孔质气体静压止推轴承静态特性的数学模型，通过工程方法和 '), { type: 'abbr', attrs: { key: 'FEM' } }, t(' 对所建立的模型进行求解。')),
] };

const abstractEn: RichDoc = { type: 'doc', content: [
  p(t('Externally pressurized gas bearing has been widely used in the field of aviation, semiconductor, weave, and measurement apparatus because of its advantage of high accuracy, little friction, low heat distortion, long life-span, and no pollution. In this thesis, the author investigated the partial porous externally pressurized gas thrust bearing by theoretical analysis, computer simulation, and experiments.')),
  p(t('The static characteristics model was analyzed by engineering solution and '), { type: 'abbr', attrs: { key: 'FEM' } }, t('.')),
] };

const conclusion: RichDoc = { type: 'doc', content: [
  p(t('本文对局部多孔质气体静压止推轴承的静态特性和稳定性进行了理论研究。本论文的主要创造性工作归纳如下：')),
  p(t('1. 建立了基于分形几何理论的多孔质石墨渗透率与分形维数之间关系的数学模型。')),
  p(t('2. 分别建立了局部多孔质气体静压轴承的承载能力、静态刚度和质量流量的数学模型。')),
] };

const acknowledgement: RichDoc = { type: 'doc', content: [
  p(t('衷心感谢导师×××教授对本人的精心指导。他的言传身教将使我终身受益。')),
  p(t('感谢实验室全体老师和同窗们的热情帮助和支持！')),
] };

const bib = `@article{willis1828,
  author = {Willis, R.},
  title = {On the pressure produced on a flat plate when opposed to a stream of air issuing from an orifice in a plane surface},
  journal = {Transactions of the Cambridge Philosophical Society},
  year = {1828},
  volume = {3},
  pages = {121--140},
}

@book{zhang2020,
  author = {张三 and 李四},
  title = {气体润滑理论与应用},
  publisher = {科学出版社},
  address = {北京},
  year = {2020},
}
`;

export function sampleDoc(): ThesisDoc {
  const d = newDoc();
  d.settings.degreeLevel = 'doctor';
  d.info.title = '局部多孔质气体静压轴承\n关键技术的研究';
  d.info.titleEn = 'RESEARCH ON KEY TECHNOLOGIES OF PARTIAL POROUS EXTERNALLY PRESSURIZED GAS BEARING';
  d.info.author = '□□□';
  d.info.supervisor = '×××　教授';
  d.info.supervisorEn = 'Prof. ×××';
  d.info.degreeApplied = '工学博士';
  d.info.degreeAppliedEn = 'Doctor of Engineering';
  d.info.speciality = '机械工程';
  d.info.specialityEn = 'Mechanical Engineering';
  d.info.affiliation = '机电工程学院';
  d.info.affiliationEn = 'School of Mechatronics Engineering';
  d.info.defenseDate = '2026-06';
  d.info.date = '2026-06';
  d.info.keywords = ['气体静压轴承', '局部多孔质', '动态特性', '数值仿真'];
  d.info.keywordsEn = ['porous graphite', 'gas bearing', 'stability'];
  d.info.secrecy = '公开';
  d.info.classifiedIndex = 'TH133.3';
  d.info.udc = '621.8';
  d.info.schoolCode = '10213';
  d.abstractZh = abstractZh;
  d.abstractEn = abstractEn;
  d.abbreviations = [{ key: 'FEM', long: '有限元方法', longEn: 'Finite Element Method' }];
  d.symbols = [
    { symbol: 'p', meaning: '气膜压力，Pa' },
    { symbol: 'h', meaning: '气膜厚度，m' },
    { symbol: 'eta', meaning: '气体动力黏度，Pa·s' },
  ];
  d.body = body;
  d.conclusion = conclusion;
  d.bibliography = bib;
  d.acknowledgement = acknowledgement;
  d.images = [{ name: SAMPLE_IMAGE, mime: 'image/png' }];
  return d;
}
