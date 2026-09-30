// 把 Agent 卡片里的一笔改动定位回编辑器：切到那一段、选中那几块、滚过去。
// 编辑器一次只挂当前一节（RichEditor 挂上登记、卸下注销），所以要等切完节它挂上来
import { useStore, type RichKey, type Section } from '../model/store';
import { getEditor, whenEditorReady } from '../editor/registry';

/** 富文本是「摘要两栏同属 abstract」这种对应关系 */
const SECTION_OF: Record<RichKey, Section> = { abstractZh: 'abstract', abstractEn: 'abstract', body: 'body', conclusion: 'conclusion', appendix: 'appendix', acknowledgement: 'acknowledgement', resume: 'resume' };

/** 选到第 from–to 块（to = from - 1 是插在 from 前）并滚动到视口里；这一节的编辑器没挂就等一会儿 */
export async function locateInEditor(key: RichKey, from: number, to: number): Promise<boolean> {
  const st = useStore.getState();
  if (st.section !== SECTION_OF[key]) st.setSection(SECTION_OF[key]);
  let ed = getEditor(key);
  if (!ed || ed.isDestroyed) ed = (await whenEditorReady(key, 1500)) ?? undefined;
  if (!ed || ed.isDestroyed) return false;
  const starts: number[] = [];
  let end = 0;
  ed.state.doc.forEach((node, offset) => { starts.push(offset); end = offset + node.nodeSize; });
  if (!starts.length) return false;
  starts.push(end);
  const a = Math.min(Math.max(from, 0), starts.length - 2);
  const b = Math.min(Math.max(to < from ? from : to, 0), starts.length - 2);
  const fromPos = Math.min(starts[a] + 1, Math.max(starts[a], starts[a + 1] - 1));
  const toPos = Math.max(fromPos, starts[b + 1] - 1);
  try {
    ed.chain().focus().setTextSelection({ from: fromPos, to: toPos }).scrollIntoView().run();
  } catch {
    try { ed.chain().focus().setTextSelection(fromPos).scrollIntoView().run(); } catch { /* 选不动就只滚过去 */ }
  }
  return true;
}
