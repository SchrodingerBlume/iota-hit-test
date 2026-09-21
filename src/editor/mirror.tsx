// 节点视图里绑在 attrs 上的输入框都要走这里：TipTap 把节点视图的重渲染排在微任务里，输入事件一结束 React 先把受控值
// 复原成旧的 attrs，正在拼的音就被打断（拼音一个个字母上屏）。本地留一份镜像当场生效，attrs 回来再对齐
import { useState, type ComponentProps } from 'react';

export function useMirror<T>(value: T): [T, (v: T) => void] {
  const [s, set] = useState({ value, mirror: value });
  const setMirror = (mirror: T) => set((p) => ({ ...p, mirror }));
  if (s.value !== value) { set({ value, mirror: value }); return [value, setMirror]; }
  return [s.mirror, setMirror];
}

export function MirrorInput({ value, onChange, ...rest }: ComponentProps<'input'>) {
  const [v, setV] = useMirror(value);
  return <input {...rest} value={v} onChange={(e) => { setV(e.target.value); onChange?.(e); }} />;
}

export function MirrorTextarea({ value, onChange, ...rest }: ComponentProps<'textarea'>) {
  const [v, setV] = useMirror(value);
  return <textarea {...rest} value={v} onChange={(e) => { setV(e.target.value); onChange?.(e); }} />;
}
