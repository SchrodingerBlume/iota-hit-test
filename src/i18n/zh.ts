// 全站界面文字。左边是代码里的原文，改右边的值界面就变；{{name}} 是代入的变量，照抄
// 润色：改右边的值，再跑 node scripts/i18n-apply.mjs，改后的文字会反写回代码、键值归一
// 生成自 scripts/i18n-extract.mjs；新增文字直接在代码里写 t("…")，再跑一次抽取即可
const zh: Record<string, string> = {
};
export default zh;
