// 宽度随内容走的输入框：题注、英文名这种"看着像正文的一行字"用它，
// 不用整行的框把版面撑成表单。宽度用隐藏 span 量字（见 textWidth）
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { textWidth, useFontsTick } from './textWidth';

type Props = InputHTMLAttributes<HTMLInputElement> & { minWidth?: number; maxWidth?: number | string };

export function AutoInput({ minWidth = 40, maxWidth = '100%', value, placeholder, className, style, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<number>(minWidth);
  const text = String(value ?? '') || String(placeholder ?? '');
  const fonts = useFontsTick();
  useLayoutEffect(() => {
    if (ref.current) setWidth(Math.max(minWidth, Math.ceil(textWidth(ref.current, text)) + 18));
  }, [text, minWidth, fonts]);
  return (
    <span className={`auto-input ${className ?? ''}`} style={{ maxWidth }}>
      <input {...rest} ref={ref} value={value} placeholder={placeholder} style={{ ...style, width }} />
    </span>
  );
}
