// 示例工程按校区、阶段、语言、学位与学科分支生成；内容取自配套范例的结构，并保留图表、公式与引用示范。
import type { ThesisDoc, RichDoc, Settings } from './types';
import { newDoc } from './store';
import { parseBibtex } from '../bib/bibtex';

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
    p(t('选中文字可以'), t('加粗', [{ type: 'bold' }]), t('、'), t('强调', [{ type: 'italic' }]), t('（排成楷体）、上标m'), t('2', [{ type: 'superscript' }]), t('，也可以插入行内公式'), { type: 'mathInline', attrs: { src: 'p = \\rho R T', mode: 'latex' } }, t('，引用文献'), { type: 'cite', attrs: { keys: 'willis1828' } }, t('，或者提一句缩略语'), { type: 'abbr', attrs: { key: 'FEM' } }, t('。缩略语首次出现时自动展开，后文只显示缩写。')),
    h(2, '气体润滑轴承的分类', 'Classification of gas-lubricated bearing', 'cls'),
    p(t('根据间隙内气膜压力的产生原理，气体轴承可以分为四种基本形式，其结构如'), { type: 'ref', attrs: { target: 'fig:bearing' } }, t('所示。')),
    { type: 'figure', attrs: { image: SAMPLE_IMAGE, width: 7, caption: '气体静压轴承', captionEn: 'Externally pressurized gas bearing', uid: 'bearing', label: 'fig:bearing' } },
    p(t('1号试样的试验数据见'), { type: 'ref', attrs: { target: 'tab:sample1' } }, t('。')),
    {
      type: 'tableFigure',
      attrs: { caption: '1号试样渗透率测试数据', captionEn: 'Data of measured permeability of sample 1', uid: 'sample1', label: 'tab:sample1' },
      content: [{
        type: 'table',
        content: [
          { type: 'tableRow', content: [['供气压力（MPa）'], ['流量测量（m³/h）'], ['压力差（Pa）']].map((c) => ({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
          { type: 'tableRow', content: [['0.15'], ['0.009'], ['46 900']].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
          { type: 'tableRow', content: [['0.20'], ['0.021'], ['96 900']].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
          { type: 'tableRow', content: [['0.25'], ['0.039'], ['146 900']].map((c) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(t(c[0]))] })) },
        ],
      }],
    },
    h(2, '多孔质材料的渗透率', 'Permeability of porous materials', 'perm'),
    p(t('本文采用Ergun方程描述多孔质材料的渗透特性，黏性阻力系数由'), { type: 'ref', attrs: { target: 'eq:ergun' } }, t('求得：')),
    { type: 'equation', attrs: { src: '\\phi = \\frac{D_{\\mathrm{p}}^2}{150} \\frac{\\psi^3}{(1 - \\psi)^2}', mode: 'latex', uid: 'ergun', label: 'eq:ergun', numbered: true } },
    p(t('式中'), { type: 'mathInline', attrs: { src: 'D_{\\mathrm{p}}', mode: 'latex' } }, t('为多孔质材料的平均粒子直径，'), { type: 'mathInline', attrs: { src: '\\psi', mode: 'latex' } }, t('为孔隙度。公式一律 LaTeX 写法，由 mitex 转成 Typst 排：')),
    { type: 'equation', attrs: { src: 'C_2 = \\frac{3.5}{D_p}\\frac{1-\\psi}{\\psi^3}', mode: 'latex', uid: 'c2', label: 'eq:c2', numbered: true } },
    h(1, '基于FLUENT软件的轴承静态特性研究', 'Research on static characteristics of bearing based on FLUENT', 'fluent'),
    h(2, '引言', 'Introduction', 'fluent-intro'),
    p(t('利用商用软件研究流场，可以省去N-S方程求解程序的编写工作。')),
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
  p(t('在理论分析的基础上，本文建立了局部多孔质气体静压止推轴承静态特性的数学模型，并通过工程方法和'), { type: 'abbr', attrs: { key: 'FEM' } }, t('求解模型。')),
] };

const reportBody = (s: Settings): RichDoc => {
  const en = s.lang === 'en';
  if (s.stage === 'proposal') return { type: 'doc', content: en ? [
    h(1, 'Background, Purpose and Significance', '', 'proposal-background'),
    h(2, 'Background', '', 'proposal-context'),
    p(t('Redundant manipulators can avoid obstacles and singular configurations while completing space operations. This report studies parameterized inverse kinematics and coordinated trajectory planning for a dual-arm robot.')),
    h(1, 'Research Status and Literature Review', '', 'proposal-review'),
    p(t('Existing studies cover redundant-arm modeling, collision avoidance and coordinated control. The proposed work compares analytical and numerical methods before selecting the control scheme.')),
    h(1, 'Research Contents and Methods', '', 'proposal-method'),
    p(t('The work includes kinematic modeling, trajectory planning, simulation and experimental verification. Each stage has a measurable output and a corresponding validation method.')),
    h(1, 'Schedule and Expected Results', '', 'proposal-plan'),
    p(t('The model and simulation will be completed first, followed by controller implementation, experiments and thesis writing.')),
    h(1, 'Available Conditions and Anticipated Difficulties', '', 'proposal-risk'),
    p(t('The laboratory provides a robotic platform and measurement equipment. The main risks are model uncertainty and limited experimental time.')),
  ] : [
    h(1, '课题背景及研究目的和意义', 'Background, purpose and significance', 'proposal-background'),
    h(2, '课题背景', 'Background', 'proposal-context'),
    p(t(s.category === 'hass' ? '数字公共服务已成为城市治理的重要组成部分。本课题拟从服务可达性、办事体验和协同机制三个方面分析现有问题。' : '七自由度冗余机械臂能够在完成操作任务的同时避开障碍与奇异位形。本课题研究参数化逆运动学求解和双臂协调轨迹规划。')),
    h(1, '国内外研究现状及分析', 'Research status and analysis', 'proposal-review'),
    p(t(s.category === 'hass' ? '现有研究多从技术采纳或公共价值出发，针对不同群体使用差异的实证比较仍不充分。' : '现有研究覆盖冗余机械臂建模、避障和协调控制。本课题将在文献梳理的基础上比较解析法与数值法。')),
    h(1, '主要研究内容及研究方案', 'Research contents and methods', 'proposal-method'),
    p(t(s.category === 'hass' ? '研究将结合政策文本、访谈材料和问卷数据，建立指标体系并检验影响机制。' : '研究内容包括运动学建模、轨迹规划、联合仿真和实验验证，每项任务均设置可检验的阶段成果。')),
    h(1, '进度安排及预期成果', 'Schedule and expected results', 'proposal-plan'),
    p(t('先完成资料整理和方案设计，再开展数据分析或系统实验，最后集中完成论文写作与修改。')),
    h(1, '现有条件、预计困难及解决方案', 'Conditions, difficulties and solutions', 'proposal-risk'),
    p(t('现有资料和实验条件能够支持课题开展。对样本不足、模型偏差和进度延误等风险，将通过补充数据与阶段复核及时调整。')),
  ] };

  return { type: 'doc', content: en ? [
    h(1, 'Main Research Contents and Progress', '', 'interim-progress'),
    p(t('The mathematical model and the first simulation round have been completed. The present results agree with the expected trend, while several boundary conditions still require verification.')),
    h(1, 'Completed Work and Results', '', 'interim-results'),
    p(t('The prototype model, parameter study and baseline experiment are complete. The records and scripts have been organized for reproducibility.')),
    h(1, 'Subsequent Work and Schedule', '', 'interim-next'),
    p(t('The next stage will complete validation, analyze errors and prepare the thesis draft.')),
    h(1, 'Difficulties and Solutions', '', 'interim-risk'),
    p(t('The main issue is the difference between simulation and experiment. Additional calibration and repeated measurements will be used to identify its source.')),
    h(1, 'Feasibility of Completion on Schedule', '', 'interim-feasibility'),
    p(t('The critical tasks have started on schedule and the remaining workload is controllable.')),
  ] : [
    h(1, '课题主要研究内容及进度', 'Research contents and progress', 'interim-progress'),
    p(t(s.category === 'hass' ? '目前已完成政策文本整理、访谈提纲设计和首轮样本收集，初步结果显示不同群体的使用体验存在明显差异。' : '目前已完成数学模型和第一轮仿真，结果趋势与预期一致，部分边界条件仍需通过实验核对。')),
    h(1, '已完成的研究工作及结果', 'Completed work and results', 'interim-results'),
    p(t(s.category === 'hass' ? '已建立分析框架并完成数据编码规则，访谈材料和问卷数据均按统一标准整理。' : '已完成原型建模、参数分析和基准实验，实验记录与计算脚本已整理归档。')),
    h(1, '后续研究工作及进度安排', 'Subsequent work and schedule', 'interim-next'),
    p(t('下一阶段将完成验证工作，集中分析误差来源，并按章节推进论文初稿。')),
    h(1, '存在的困难及解决方案', 'Difficulties and solutions', 'interim-risk'),
    p(t(s.category === 'hass' ? '当前困难是部分受访者反馈不完整，后续将补充访谈并采用多种材料交叉验证。' : '当前困难是仿真结果与实验数据存在偏差，后续将通过设备标定和重复试验查找原因。')),
    h(1, '按期完成论文的可能性', 'Feasibility of completion', 'interim-feasibility'),
    p(t('关键任务已按计划启动，剩余工作量可控，具备按期完成的条件。')),
  ] };
};

const hassBody: RichDoc = { type: 'doc', content: [
  h(1, '绪论', 'Introduction', 'hass-intro'),
  h(2, '研究背景与问题提出', 'Background and research questions', 'hass-background'),
  p(t('数字公共服务不断向移动端延伸，但不同年龄、职业和居住地区的使用者仍面临不同障碍。本文关注服务设计如何影响公众的实际获得感。')),
  h(2, '研究思路与资料来源', 'Methods and data', 'hass-method'),
  p(t('研究以政策文本、半结构访谈和问卷数据为主要资料，通过主题分析与统计检验比较不同群体的使用体验。')),
  h(1, '数字公共服务的使用差异', 'Differences in digital public service use', 'hass-findings'),
  p(t('分析结果表明，入口是否统一、说明是否清楚以及线下帮助是否可得，是影响服务体验的三个主要因素。')),
  h(2, '本章小结', 'Summary', 'hass-summary'),
  p(t('本章说明了使用差异的具体表现，并为后文的机制分析和改进建议提供依据。')),
] };

const englishFinalBody: RichDoc = { type: 'doc', content: [
  h(1, 'Introduction', '', 'en-intro'),
  h(2, 'Background and Motivation', '', 'en-background'),
  p(t('Precision equipment requires bearing systems with low friction, stable motion and reliable load capacity. This thesis investigates a partial porous externally pressurized gas thrust bearing.')),
  h(2, 'Research Methods', '', 'en-method'),
  p(t('A mathematical model is established and verified through numerical simulation and experiments. The discussion focuses on static characteristics and stability.')),
  h(1, 'Model and Analysis', '', 'en-analysis'),
  p(t('The permeability coefficient is obtained from the porous-material model, and the pressure field is solved under several operating conditions.')),
  { type: 'equation', attrs: { src: '\\phi = \\frac{D_{\\mathrm{p}}^2}{150} \\frac{\\psi^3}{(1 - \\psi)^2}', mode: 'latex', uid: 'en-ergun', label: 'eq:en-ergun', numbered: true } },
  h(2, 'Chapter Summary', '', 'en-summary'),
  p(t('The model provides the basis for the subsequent parameter study and experimental validation.')),
] };

const practiceBody: RichDoc = { type: 'doc', content: [
  h(1, '项目概述', 'Project overview', 'practice-overview'),
  h(2, '任务来源与设计目标', 'Project background and objectives', 'practice-objective'),
  p(t('本项目面向复杂装备运行状态监测，设计一套集数据采集、特征分析、故障识别和结果追溯于一体的诊断系统。')),
  h(2, '需求分析', 'Requirements', 'practice-requirements'),
  p(t('系统应支持多通道信号接入、实时状态显示、历史数据查询和诊断结果导出，并在异常情况下保留完整记录。')),
  h(1, '系统设计与实现', 'System design and implementation', 'practice-design'),
  p(t('系统采用分层结构组织采集、计算和界面模块。各模块通过明确的数据接口连接，便于单独测试和后续扩展。')),
  h(2, '测试方案', 'Test plan', 'practice-test'),
  p(t('测试覆盖功能正确性、连续运行稳定性和典型故障识别准确率。每项测试均记录输入条件、预期结果和实际结果。')),
  h(1, '结果分析', 'Results and discussion', 'practice-results'),
  p(t('测试结果表明，系统能够完成预定功能。对识别误差较大的工况，需进一步补充样本并调整特征参数。')),
] };

const appendix: RichDoc = { type: 'doc', content: [
  h(1, '补充试验数据', 'Supplementary experimental data', 'appendix-data'),
  p(t('本附录列出正文分析所用的补充数据和计算说明。附录只有一章时，标题显示为“附录”，图、表和公式按附录规则编号。')),
  { type: 'equation', attrs: { src: 'K = \\frac{Q \\mu L}{A \\Delta p}', mode: 'latex', uid: 'appendix-k', label: 'eq:appendix-k', numbered: true } },
  h(2, '数据处理说明', 'Notes on data processing', 'appendix-notes'),
  p(t('原始测量值保留三位有效数字，重复试验取算术平均值。异常数据须结合实验记录说明原因，不直接删除。')),
] };

const abstractEn: RichDoc = { type: 'doc', content: [
  p(t('Externally pressurized gas bearings are widely used in aerospace equipment, semiconductor manufacturing and precision instruments because they provide accurate motion with low friction and little thermal deformation. This thesis investigates a partial porous externally pressurized gas thrust bearing through theoretical analysis, numerical simulation and experiments.')),
  p(t('A mathematical model of the static characteristics is established and solved by an engineering method and the '), { type: 'abbr', attrs: { key: 'FEM' } }, t('.')),
] };

const hassAbstractZh: RichDoc = { type: 'doc', content: [
  p(t('数字公共服务在提升办事效率的同时，也可能因入口分散、信息表达复杂和线下支持不足而形成新的使用障碍。本文以城市公共服务平台为对象，结合政策文本、半结构访谈和问卷数据，分析不同群体的使用差异及其形成机制。')),
  p(t('研究发现，服务入口的统一程度、说明文字的可理解性和人工协助的可得性，会显著影响公众完成事项的时间与满意度。据此，本文提出统一服务路径、改写关键说明并保留必要线下渠道等建议。')),
] };

const hassAbstractEn: RichDoc = { type: 'doc', content: [
  p(t('Digital public services improve administrative efficiency, but fragmented entry points, complex instructions and limited offline support may create new barriers. This study combines policy documents, interviews and survey data to examine differences in service use among social groups.')),
  p(t('The findings show that a unified service path, understandable instructions and accessible human assistance significantly affect completion time and user satisfaction.')),
] };

const conclusion: RichDoc = { type: 'doc', content: [
  p(t('本文对局部多孔质气体静压止推轴承的静态特性和稳定性进行了理论研究。本论文的主要创造性工作归纳如下：')),
  p(t('1. 建立了基于分形几何理论的多孔质石墨渗透率与分形维数之间关系的数学模型。')),
  p(t('2. 分别建立了局部多孔质气体静压轴承的承载能力、静态刚度和质量流量的数学模型。')),
] };

const hassConclusion: RichDoc = { type: 'doc', content: [
  p(t('本文分析了数字公共服务的使用差异及其形成机制。主要结论如下：')),
  p(t('1. 服务入口、说明文字和协助渠道共同影响公众能否顺利完成事项。')),
  p(t('2. 不同群体面临的障碍并不相同，服务改进需要同时考虑线上流程与线下支持。')),
] };

const practiceConclusion: RichDoc = { type: 'doc', content: [
  p(t('本项目完成了复杂装备故障诊断系统的设计、实现与测试。系统具备数据采集、状态显示、故障识别和结果追溯等功能，达到了预定设计目标。')),
  p(t('后续工作将补充更多实际工况数据，并继续改进识别模型与异常处理机制。')),
] };

const englishConclusion: RichDoc = { type: 'doc', content: [
  p(t('This thesis establishes and validates a model for the static characteristics of a partial porous externally pressurized gas thrust bearing. The results clarify the effects of the main structural and operating parameters.')),
  p(t('Future work should extend the experiments to transient operating conditions and improve the uncertainty analysis.')),
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

export function sampleDoc(settings?: Settings): ThesisDoc {
  const d = newDoc();
  if (settings) d.settings = { ...d.settings, ...settings };
  const s = d.settings;
  const topic = s.category === 'hass'
    ? '数字公共服务使用差异及其影响机制研究'
    : s.form === 'practice'
      ? '复杂装备故障诊断系统设计与实现'
      : s.stage === 'proposal'
        ? '冗余双臂机器人协调控制研究'
        : s.stage === 'interim'
          ? '人工心脏泵体优化设计'
      : s.degreeLevel === 'bachelor'
        ? '空气静压轴承试验台设计与性能分析'
        : s.degreeLevel === 'master'
          ? '局部多孔质气体静压轴承静态特性研究'
          : '局部多孔质气体静压轴承关键技术研究';
  const topicEn = s.category === 'hass'
    ? 'DIFFERENCES IN DIGITAL PUBLIC SERVICE USE AND THEIR MECHANISMS'
    : s.form === 'practice'
      ? 'DESIGN AND IMPLEMENTATION OF A FAULT DIAGNOSIS SYSTEM FOR COMPLEX EQUIPMENT'
      : s.stage === 'proposal'
        ? 'COORDINATED CONTROL OF A REDUNDANT DUAL-ARM ROBOT'
        : s.stage === 'interim'
          ? 'OPTIMIZATION OF AN ARTIFICIAL HEART PUMP'
          : s.degreeLevel === 'bachelor'
            ? 'DESIGN AND PERFORMANCE ANALYSIS OF AN AEROSTATIC BEARING TEST RIG'
            : s.degreeLevel === 'master'
              ? 'STATIC CHARACTERISTICS OF A PARTIAL POROUS EXTERNALLY PRESSURIZED GAS BEARING'
              : 'KEY TECHNOLOGIES OF A PARTIAL POROUS EXTERNALLY PRESSURIZED GAS BEARING';
  const stageName = s.stage === 'proposal' ? '开题报告' : s.stage === 'interim' ? '中期报告' : s.degreeLevel === 'bachelor' ? '本科毕业论文' : s.degreeLevel === 'master' ? '硕士学位论文' : '博士学位论文';
  d.name = `示例：${topic}（${stageName}）`;
  d.info.title = topic;
  d.info.titleEn = topicEn;
  d.info.author = '□□□';
  d.info.supervisor = '×××　教授';
  d.info.supervisorEn = 'Prof. ×××';
  d.info.degreeApplied = s.degreeLevel === 'doctor' ? '工学博士' : s.degreeLevel === 'master' ? '工学硕士' : '工学学士';
  d.info.degreeAppliedEn = s.degreeLevel === 'doctor' ? 'Doctor of Engineering' : s.degreeLevel === 'master' ? 'Master of Engineering' : 'Bachelor of Engineering';
  d.info.speciality = s.category === 'hass' ? '公共管理' : '机械工程';
  d.info.specialityEn = s.category === 'hass' ? 'Public Administration' : 'Mechanical Engineering';
  d.info.affiliation = s.campus === 'shenzhen' ? '深圳校区机电工程与自动化学院' : s.category === 'hass' ? '经济与管理学院' : '机电工程学院';
  d.info.affiliationEn = s.campus === 'shenzhen' ? 'School of Mechanical Engineering and Automation, Shenzhen' : s.category === 'hass' ? 'School of Management' : 'School of Mechatronics Engineering';
  d.info.defenseDate = '2026-06';
  d.info.date = '2026-06';
  d.info.keywords = s.category === 'hass' ? ['数字公共服务', '使用差异', '公共价值'] : s.form === 'practice' ? ['故障诊断', '状态监测', '系统设计'] : ['气体静压轴承', '局部多孔质', '动态特性', '数值仿真'];
  d.info.keywordsEn = s.category === 'hass' ? ['digital public services', 'usage differences', 'public value'] : s.form === 'practice' ? ['fault diagnosis', 'condition monitoring', 'system design'] : ['porous graphite', 'gas bearing', 'stability'];
  d.info.secrecy = '公开';
  d.info.classifiedIndex = 'TH133.3';
  d.info.udc = '621.8';
  d.info.schoolCode = '10213';
  d.abstractZh = s.category === 'hass' ? hassAbstractZh : abstractZh;
  d.abstractEn = s.category === 'hass' ? hassAbstractEn : abstractEn;
  d.abbreviations = [{ key: 'FEM', long: '有限元方法', longEn: 'Finite Element Method' }];
  d.symbols = [
    { symbol: 'p', mode: 'latex', meaning: '气膜压力，Pa' },
    { symbol: 'h', mode: 'latex', meaning: '气膜厚度，m' },
    { symbol: '\\eta', mode: 'latex', meaning: '气体动力黏度，Pa·s' },
  ];
  d.body = s.stage === 'final' ? (s.lang === 'en' ? englishFinalBody : s.category === 'hass' ? hassBody : s.form === 'practice' ? practiceBody : body) : reportBody(s);
  d.conclusion = s.lang === 'en' ? englishConclusion : s.category === 'hass' ? hassConclusion : s.form === 'practice' ? practiceConclusion : conclusion;
  d.references = parseBibtex(bib);
  d.acknowledgement = acknowledgement;
  d.appendix = s.stage === 'final' && s.lang === 'zh' ? appendix : { type: 'doc' };
  d.images = s.stage === 'final' && s.lang === 'zh' && s.category === 'stem' && s.form === 'dissertation' ? [{ name: SAMPLE_IMAGE, mime: 'image/png' }] : [];
  return d;
}
