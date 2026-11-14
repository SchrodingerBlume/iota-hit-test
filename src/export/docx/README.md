# Word 导出

`build.ts` 从工程数据生成可编辑的 docx；`template.ts` 向站内 Typst worker 查询样式、分区和章级局部版面。

## 格式与分节

- 行内字体、字号、文字颜色、高亮与已有字符样式写入 run 属性。
- 章级样式生成独立样式 ID，版面变化写入分节属性；离开该章后恢复。
- 页眉文字支持自定义奇偶页，字体、字号、边框和距边界按所在分区设置。

## 引用与书目

`bib.ts` 使用模板当前生效的 omni-gb7714 配置查询正文标注、书目排序和条目文本，支持界面提供的顺序编码制、著者—出版年制、脚注制及 2015／2025 国标版本。脚注写为 Word 原生脚注；引用跳转、书目网址和反向跳转写为超链接。

## 报告表单

`reports.ts` 提供报告说明页、深圳研究生首页、博士中期正文表格及评议签字表。说明文字和变体参数来自 `report-data.json`，由 `scripts/bundle-word-reports.mjs` 从已打包的 iota-hit 提取；`npm run packages` 会同步生成。

`report-data.json` 是 iota-hit 的派生数据，沿用模板的 LPPL-1.3c 许可；来源版本记录在文件的 `template` 字段。

评议签字表仅在工程启用对应页面时导出，人员和决议使用工程中的数据，空白意见及签字单元格可在 Word 中继续填写。

## 索引与清单

索引使用 XE／INDEX 域，插图、表格和公式清单使用 TC／TOC 域。清单与索引带有初始条目和 PAGEREF 页码域；Word 打开后可全选并按 F9 更新页码及域结果。

## 验证

```sh
npm run test:template
npm run test:word
```

`test:template` 验证真实 wasm 查询及导出 XML，浏览器相关部分使用测试宿主；`test:word` 在 Chromium 中使用真实 worker、DOMParser、canvas 和 IndexedDB 验证导出。可通过 `CHROME_PATH` 指定浏览器可执行文件。浏览器检查不等于 Microsoft Word／WPS 中的逐页视觉验收。
