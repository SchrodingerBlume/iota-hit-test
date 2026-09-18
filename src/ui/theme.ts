// 明暗主题：浅色 / 深色 / 跟随系统（默认），记在 localStorage。深色那套照 Typst Studio（VSCode 深色），
// 浅色那套照 hiTouyingBeamer（一个主色 #166183 配黑白灰）。
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemePref = Theme | 'system';
const KEY = 'iota4web-theme';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function themePref(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* 隐私模式 */ }
  return 'system';
}

export function currentTheme(pref: ThemePref = themePref()): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

let animTimer = 0;
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  const prev = root.getAttribute('data-theme');
  root.setAttribute('data-theme', t);
  root.style.colorScheme = t;
  // 换主题时各面板的底色、字色渐变过去（预览的 SVG 除外，几万个字形不值得）
  if (prev && prev !== t) {
    root.classList.add('theme-anim');
    clearTimeout(animTimer);
    animTimer = window.setTimeout(() => root.classList.remove('theme-anim'), 400);
  }
}

export function useTheme(): [Theme, ThemePref, (p: ThemePref) => void] {
  const [pref, setPrefState] = useState<ThemePref>(() => themePref());
  const [system, setSystem] = useState<Theme>(() => systemTheme());
  const theme = pref === 'system' ? system : pref;
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => setSystem(systemTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const setPref = (p: ThemePref) => {
    try { if (p === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* */ }
    setPrefState(p);
  };
  return [theme, pref, setPref];
}
