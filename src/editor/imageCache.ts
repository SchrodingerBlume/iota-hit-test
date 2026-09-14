// 图片：IndexedDB 里的 Blob → object URL，编辑器里预览用。
import { loadImage, saveImage, deleteImage } from '../model/persist';

const urls = new Map<string, string>();
const bytes = new Map<string, ArrayBuffer>();

export async function imageUrl(name: string): Promise<string | null> {
  const hit = urls.get(name);
  if (hit) return hit;
  const blob = await loadImage(name);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(name, url);
  return url;
}

export async function imageBytes(name: string): Promise<ArrayBuffer | null> {
  const hit = bytes.get(name);
  if (hit) return hit;
  const blob = await loadImage(name);
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  bytes.set(name, buf);
  return buf;
}

export async function putImage(name: string, blob: Blob) {
  await saveImage(name, blob);
  const old = urls.get(name);
  if (old) URL.revokeObjectURL(old);
  urls.delete(name);
  bytes.delete(name);
}

export async function removeImage(name: string) {
  await deleteImage(name);
  const old = urls.get(name);
  if (old) URL.revokeObjectURL(old);
  urls.delete(name);
  bytes.delete(name);
}

/** 文件名规整：Typst 路径里别出现空格与奇怪字符 */
export function safeImageName(original: string, taken: Set<string>): string {
  const ext = (original.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.png').toLowerCase();
  const stem = original.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  let name = stem + ext;
  let i = 2;
  while (taken.has(name)) name = `${stem}-${i++}${ext}`;
  return name;
}

export function imageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
