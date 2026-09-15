// 宽度随内容走的输入框：题注、英文名这种"看着像正文的一行字"用它，
// 不用整行的框把版面撑成表单。靠一个隐藏的镜像 span 量宽。
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { minWidth?: number; maxWidth?: number | string };

export function AutoInput({ minWidth = 40, maxWidth = '100%', value, placeholder, className, style, ...rest }: Props) {
  const mirror = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>(minWidth);
  useLayoutEffect(() => {
    if (!mirror.current) return;
    const w = mirror.current.getBoundingClientRect().width;
    setWidth(Math.max(minWidth, Math.ceil(w) + 8));
  }, [value, placeholder, minWidth]);
  const text = String(value ?? '') || String(placeholder ?? '');
  return (
    <span className={`auto-input ${className ?? ''}`} style={{ maxWidth }}>
      <input {...rest} value={value} placeholder={placeholder} style={{ ...style, width }} />
      <span className="auto-input-mirror" ref={mirror} aria-hidden>{text}</span>
    </span>
  );
}
