// 明暗主题：跟系统，也能手动切；记在 localStorage。深色那套照 Typst Studio（VSCode 深色），
// 浅色那套照 hiTouyingBeamer（一个主色 #166183 配黑白灰）。
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'iota4web-theme';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* 隐私模式 */ }
  return systemTheme();
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.colorScheme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => { try { if (!localStorage.getItem(KEY)) setThemeState(systemTheme()); } catch { /* */ } };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const setTheme = (t: Theme) => {
    try { localStorage.setItem(KEY, t); } catch { /* */ }
    setThemeState(t);
  };
  return [theme, setTheme];
}
