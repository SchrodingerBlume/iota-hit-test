// 界面词条集中在 zh.ts；{{name}} 表示插值变量。
import i18next from 'i18next';
import zh from './zh';

i18next.init({ lng: 'zh', fallbackLng: 'zh', resources: { zh: { translation: zh } }, keySeparator: false, nsSeparator: false, initAsync: false, interpolation: { escapeValue: false } });

export const t = (key: string, vars?: Record<string, unknown>): string => String(i18next.t(key, vars as never));
