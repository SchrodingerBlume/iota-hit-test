// 初次进站问过「读不读本机字体」之后记下的答案：新建文档默认用它。不带别的依赖，model 层也能用
import type { Fontset } from '../model/types';

const KEY = 'iota4web-fontset-default';
export const rememberedFontset = (): Fontset | null => { try { const v = localStorage.getItem(KEY); return v === 'webapp' || v === 'windows' || v === 'macos' ? v : null; } catch { return null; } };
export const rememberFontset = (v: Fontset) => { try { localStorage.setItem(KEY, v); } catch { /* */ } };
/** 这台机器该用哪一档本机字体 */
export const platformPreset = (): 'macos' | 'windows' => (/Mac/i.test(navigator.platform) ? 'macos' : 'windows');
