/// <reference types="vite/client" />
declare module '@myriaddreamin/typst-ts-web-compiler';
declare module '@myriaddreamin/typst-ts-renderer';

// zhconv 的 wasm 胶水（包里只给主入口的 .d.ts）
declare module 'zhconv/zhconv_bg.js' {
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
  export function zhconv(text: string, target: string, wikitext?: boolean | null, rules?: string | null): string;
}
