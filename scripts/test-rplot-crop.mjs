// 实际 R/Wasm + CeTZ + Typst/Wasm，检查图的裁切与物理尺寸。
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
const entry = '\0rplot-crop-check';
const server = await createServer({ cacheDir: 'node_modules/.vite-rplot-crop-test', server: { host: '127.0.0.1', port: 5319, strictPort: true, hmr: false, ws: false, watch: null }, plugins: [{
  name: 'rplot-crop-check', resolveId(id) { if (id === '/__rplot_crop.js') return entry; },
  load(id) { if (id === entry) return `import {createRPlot} from '/src/rplot/render.ts'; import {collectRPlotFiles,rPlotHeight} from '/src/rplot/files.ts'; import {compileDrawing,queryTypst} from '/src/compiler/client.ts'; import {renderSnippetSvg} from '/src/compiler/renderer.ts'; import {verticalInkBounds} from '/src/rplot/crop.ts';
import React from 'react'; import {createRoot} from 'react-dom/client'; import {FluentProvider,webLightTheme} from '@fluentui/react-components'; import {RPlotDialog} from '/src/ui/RPlotDialog.tsx'; import '/src/styles/app.css';
window.cropTest={createRPlot,collectRPlotFiles,rPlotHeight,compileDrawing,queryTypst,renderSnippetSvg,verticalInkBounds}; const root=createRoot(document.getElementById('root')); window.cropTest.show=()=>root.render(React.createElement(FluentProvider,{theme:webLightTheme},React.createElement(RPlotDialog,{onClose:()=>{},onApply:()=>{}})));`; },
  configureServer(s) { s.middlewares.use('/__rplot_crop__', async (_req, res) => { res.setHeader('Content-Type','text/html'); res.end(await s.transformIndexHtml('/__rplot_crop__','<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__rplot_crop.js"></script></body></html>')); }); },
}] });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }) });
  const page = await browser.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5319/__rplot_crop__'); await page.waitForFunction(()=>!!window.cropTest);
  const result=await page.evaluate(async()=>{
    const a=window.cropTest;
    const plot=await a.createRPlot('plot(1:4, type="b", xlab="x", ylab="y")',{width:5.5,height:4,pointsize:10.8});
    const svg=new DOMParser().parseFromString(plot.svg,'image/svg+xml').documentElement;
    const bitmap=await createImageBitmap(plot.png),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const bounds=a.verticalInkBounds(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,0);
    const ink=(pixels)=>{let total=0;for(let p=0;p<pixels.length;p+=4)total+=Math.max(255-pixels[p],255-pixels[p+1],255-pixels[p+2])*pixels[p+3];return total;};
    const croppedInk=ink(ctx.getImageData(0,0,canvas.width,canvas.height).data);
    const fullFiles=a.collectRPlotFiles({type:'figure',attrs:{rPlot:JSON.stringify({...plot.plot,crop:undefined})}});
    const full=await a.compileDrawing('#set page(width:auto,height:auto,margin:0pt,fill:none)\n'+fullFiles[plot.plot.path]+'\n#r-figure()');if(!full.artifact)throw Error(full.error);
    const fullSvg=(await a.renderSnippetSvg(new Uint8Array(full.artifact))).replace(/<script[\s\S]*?<\/script>/g,'').replace(/<foreignObject[\s\S]*?<\/foreignObject>/g,'').replace(/<svg([^>]*)>/,(_all,attrs)=>'<svg'+attrs.replace(/\swidth="[^"]*"/,'').replace(/\sheight="[^"]*"/,'')+' width="1056" height="768">');
    const fullUrl=URL.createObjectURL(new Blob([fullSvg],{type:'image/svg+xml'}));
    const image=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(Error('Uncropped reference SVG cannot be decoded'));i.src=fullUrl;});
    const fullCanvas=document.createElement('canvas');fullCanvas.width=1056;fullCanvas.height=768;
    const fullCtx=fullCanvas.getContext('2d');fullCtx.drawImage(image,0,0,1056,768);URL.revokeObjectURL(fullUrl);
    const fullInk=ink(fullCtx.getImageData(0,0,1056,768).data);
    const files=a.collectRPlotFiles({type:'figure',attrs:{rPlot:JSON.stringify(plot.plot)}});
    const measure=await a.queryTypst(files[plot.plot.path]+'\n#context { let s = measure(r-figure()); [#metadata((w: s.width / 1pt, h: s.height / 1pt)) <crop-size>] }','<crop-size>');
    if(measure.error)throw Error(measure.error);
    const value=measure.result[0].value??measure.result[0];
    const transparent=await a.createRPlot('par(bg=NA); plot.new(); text(.5,.5,"White text",col="white")',{width:3,height:3,pointsize:11});
    const colored=await a.createRPlot('par(bg="lightblue"); plot.new(); text(.5,.5,"Content")',{width:3,height:3,pointsize:11});
    const blank=await a.createRPlot('plot.new()',{width:3,height:3,pointsize:11});
    const pt=await a.createRPlot('library(ggplot2)\nggplot(data.frame(x=1,y=1,label="Default pt"),aes(x,y,label=label))+geom_text(size.unit="pt")+theme_void()',{width:5.5,height:3.5,pointsize:10.8});
    const explicit=await a.createRPlot('library(ggplot2)\nggplot(data.frame(x=1,y=1,label="Explicit pt"),aes(x,y,label=label))+geom_text(size=12.3,size.unit="pt")+theme_void()',{width:5.5,height:3.5,pointsize:10.8});
    const theme=await a.createRPlot('library(ggplot2)\nggplot(data.frame(x=1,y=1,label="Theme pt"),aes(x,y,label=label))+geom_text(size.unit="pt")+theme_void(base_size=15)',{width:5.5,height:3.5,pointsize:10.8});
    return {width:plot.pixelWidth,height:plot.pixelHeight,canvasHeight:plot.plot.height,crop:plot.plot.crop,viewBox:svg.getAttribute('viewBox'),bounds,fullInk,croppedInk,vector:value,outputHeight:a.rPlotHeight(plot.plot),source:plot.plot.source,
      transparent:{height:transparent.pixelHeight,crop:transparent.plot.crop},colored:{height:colored.pixelHeight,crop:colored.plot.crop},blank:{height:blank.pixelHeight,crop:blank.plot.crop},pt:pt.plot.source,explicit:explicit.plot.source,theme:theme.plot.source};
  });
  assert.equal(result.width,1056);assert.equal(result.canvasHeight,4);assert.ok(result.height<768);
  assert.ok(result.crop.top>0&&result.crop.bottom>0);assert.ok(result.bounds.top<=5&&result.bounds.bottom<=5,JSON.stringify(result.bounds));
  assert.ok(Math.abs(result.fullInk-result.croppedInk)/result.fullInk<.01,'Cropping must retain the complete drawn content without resizing glyphs');
  assert.ok(Math.abs(result.vector.w-396)<.0001);assert.ok(Math.abs(result.vector.h-result.outputHeight*72)<.001);
  const viewBox=result.viewBox.split(/\s+/).map(Number);assert.ok(Math.abs(viewBox[3]-result.vector.h)<.001);
  assert.match(result.source,/size: 10\.8pt/);
  assert.ok(result.transparent.height<576);assert.ok(result.transparent.crop);
  assert.equal(result.colored.height,576);assert.equal(result.blank.height,576);
  assert.match(result.pt,/size: 10\.8pt/);assert.doesNotMatch(result.pt,/size: 3\.7\d*pt/);
  assert.doesNotMatch(result.pt,/"0\.950"|"0\.975"/,'theme_void must not acquire visible axes');
  assert.match(result.explicit,/size: 12\.3pt/);
  assert.match(result.theme,/size: 15pt/);assert.doesNotMatch(result.theme,/size: 10\.8pt/,'Explicit theme font must not be replaced by geom defaults');
  await page.evaluate(()=>window.cropTest.show());
  await page.getByLabel('R 字号模式',{exact:true}).selectOption('manual');
  await page.getByRole('spinbutton',{name:'R 手动字号（pt）',exact:true}).fill('10.8');
  await page.getByRole('textbox',{name:'R 绘图代码',exact:true}).fill('library(ggplot2)\nggplot(data.frame(x=1,y=1,label="Theme pt"),aes(x,y,label=label))+geom_text(size.unit="pt")+theme_void(base_size=15)');
  await page.getByRole('button',{name:'运行预览',exact:true}).click();await page.locator('.rplot-preview img').waitFor({timeout:120000});
  await page.locator('.field-hint').filter({hasText:'默认字号：10.8pt；代码中的单独字号优先；R 文字字号：15pt'}).waitFor();
  await page.locator('.field-hint').filter({hasText:'已自动去掉上下空白'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS vertical trim preserves width/font pt, exact vector bounds, transparent white ink, colored/blank canvases and geom_text pt units');
} finally { await browser?.close(); await server.close(); }
