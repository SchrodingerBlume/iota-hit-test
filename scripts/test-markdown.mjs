import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});

try {
  const { toMarkdown, fromMarkdown } = await server.ssrLoadModule('/src/editor/markdown.ts');
  const original = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, en: 'Introduction', uid: 'intro' }, content: [{ type: 'text', text: '绪论' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '加粗', marks: [{ type: 'bold' }] }, { type: 'text', text: '与公式' }, { type: 'mathInline', attrs: { src: 'x^2', mode: 'typst' } }] },
      { type: 'equation', attrs: { src: 'a+b', mode: 'typst', uid: 'eq1', label: 'eq:eq1', numbered: true } },
    ],
  };
  const markdown = toMarkdown(original);
  const parsed = fromMarkdown(markdown, true);
  assert.equal(parsed.content[0].type, 'heading');
  assert.equal(parsed.content[0].content[0].text, '绪论');
  assert.ok(parsed.content[1].content.some((node) => node.type === 'mathInline'));
  assert.equal(parsed.content[2].type, 'equation');
  console.log('PASS: GFM round trip preserves headings, inline math and thesis-specific blocks');
} finally {
  await server.close();
}
