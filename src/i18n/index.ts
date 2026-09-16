// 界面文字统一从 zh.ts 读：键是代码里的原文，值改了界面就变；{{name}} 代入变量
import i18next from 'i18next';
import zh from './zh';

i18next.init({ lng: 'zh', fallbackLng: 'zh', resources: { zh: { translation: zh } }, keySeparator: false, nsSeparator: false, initAsync: false, interpolation: { escapeValue: false } });

export const t = (key: string, vars?: Record<string, unknown>): string => String(i18next.t(key, vars as never));
