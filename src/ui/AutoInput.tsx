// 宽度随内容走的输入框：题注、英文名这种"看着像正文的一行字"用它，
// 不用整行的框把版面撑成表单。宽度用 canvas 量字（原来靠隐藏镜像 span，长题注会把编辑区撑出横向滚动）
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { minWidth?: number; maxWidth?: number | string };

let ctx: CanvasRenderingContext2D | null = null;
function measure(el: HTMLInputElement, text: string) {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * 8;
  const cs = getComputedStyle(el);
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return ctx.measureText(text).width;
}

export function AutoInput({ minWidth = 40, maxWidth = '100%', value, placeholder, className, style, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<number>(minWidth);
  const text = String(value ?? '') || String(placeholder ?? '');
  useLayoutEffect(() => {
    if (ref.current) setWidth(Math.max(minWidth, Math.ceil(measure(ref.current, text)) + 12));
  }, [text, minWidth]);
  return (
    <span className={`auto-input ${className ?? ''}`} style={{ maxWidth }}>
      <input {...rest} ref={ref} value={value} placeholder={placeholder} style={{ ...style, width }} />
    </span>
  );
}
