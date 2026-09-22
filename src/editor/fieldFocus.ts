// 填表区（论文信息、题注输入框这些普通 input / textarea）里的焦点：功能区上几颗只认富文本的钮，落在这些框里时也能用
import { useEffect, useState } from 'react';

export type Field = HTMLInputElement | HTMLTextAreaElement;
const TEXTUAL = new Set(['text', 'search', 'url', 'tel', 'email', '']);
const asField = (el: Element | null): Field | null => {
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement && TEXTUAL.has(el.type) && !el.readOnly && !el.disabled) return el;
  return null;
};

/** 眼下有焦点的普通文本框；焦点在富文本或别处时是 null */
export function useFocusedField(): Field | null {
  const [field, setField] = useState<Field | null>(() => asField(document.activeElement));
  useEffect(() => {
    const on = () => setField(asField(document.activeElement));
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', on);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', on); };
  }, []);
  return field;
}

/** 在光标处插一段字：走原生 setter 再派 input 事件，React 受控的框才会跟着改 */
export function insertIntoField(el: Field, text: string) {
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.setSelectionRange(start + text.length, start + text.length);
  el.focus();
}
