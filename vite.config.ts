import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯静态站：build 出来的 dist/ 直接扔到 GitHub Pages / 任意静态托管。
// base 用相对路径，放到子目录也能跑。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 4000,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // typst.ts 内部用动态 import 取 wasm 胶水，预打包会把路径搅乱
    exclude: ['@myriaddreamin/typst.ts', '@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer'],
  },
  server: {
    fs: { allow: ['.'] },
  },
});
