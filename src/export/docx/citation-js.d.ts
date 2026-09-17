declare module '@citation-js/core' { export class Cite { constructor(data: unknown, opts?: Record<string, unknown>); format(kind: string, opts?: Record<string, unknown>): string } export const plugins: { config: { get(name: string): unknown } }; }
declare module '@citation-js/plugin-bibtex';
declare module '@citation-js/plugin-csl';
