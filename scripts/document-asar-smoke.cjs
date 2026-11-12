const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { builtinModules } = require('node:module');
const { existsSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join, dirname, resolve, relative, isAbsolute } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const { finished } = require('node:stream/promises');
const desktop = resolve(__dirname, '../apps/desktop');
const requireApp = createRequire(join(desktop, 'package.json'));
const builder = requireApp.resolve('app-builder-lib');
const asar = createRequire(builder)('@electron/asar');
const { scannedPdf } = require('./fixtures/document-fixtures.cjs');
const builtinNames = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));

function isRuntimeDependency(name) {
  return !name.startsWith('@types/') && !builtinNames.has(name);
}

async function main() {
  const temporary = await fs.mkdtemp(join(tmpdir(), 'mingshen-doc-asar-'));
  try {
    const source = join(temporary, 'source');
    const modules = join(source, 'node_modules');
    await fs.mkdir(modules, {recursive:true});
    const copied = new Set();
    async function copyPackage(name, base, parent = source) {
      const resolver = createRequire(join(base, 'package.json'));
      let entry; try { entry = resolver.resolve(`${name}/package.json`); } catch { entry = resolver.resolve(name); }
      let directory = dirname(entry);
      while (!existsSync(join(directory, 'package.json'))) directory = dirname(directory);
      const pkg = JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
      const rootTarget = join(modules, name);
      const destination = copied.has(rootTarget) && JSON.parse(readFileSync(join(rootTarget,'package.json'),'utf8')).version !== pkg.version ? join(parent,'node_modules',name) : rootTarget;
      if (copied.has(destination)) return;
      copied.add(destination);
      await fs.cp(directory,destination,{recursive:true,filter:path=>!relative(directory,path).split(/[\\/]/).includes('node_modules')});
      for(const dependency of Object.keys(pkg.dependencies??{}))
        if (isRuntimeDependency(dependency)) await copyPackage(dependency,directory,destination);
      for(const dependency of Object.keys(pkg.optionalDependencies??{})){
        if (!isRuntimeDependency(dependency)) continue;
        try { const optionalEntry = resolver.resolve(`${dependency}/package.json`); const optional = JSON.parse(readFileSync(optionalEntry,'utf8')); if(optional.os&&!optional.os.includes(process.platform))continue; if(optional.cpu&&!optional.cpu.includes(process.arch))continue; await copyPackage(dependency,directory,destination); }catch(error){if(!['MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code))throw error;}
      }
    }
    for (const name of ['mammoth','unpdf','word-extractor','@napi-rs/canvas','tesseract.js','@tesseract.js-data/eng','@tesseract.js-data/chi_sim','docx','pptxgenjs','@xmldom/xmldom','marked','katex']) await copyPackage(name, desktop);
    const archive=join(temporary,'app.asar');
    const archiveOutput = await asar.createPackageWithOptions(source,archive,{unpackDir:'node_modules/{@napi-rs,@tesseract.js-data,tesseract.js,tesseract.js-core,regenerator-runtime,is-url,bmp-js,wasm-feature-detect}{,/**}'});
    await finished(archiveOutput);
    const scan=join(temporary,'scan.pdf'),result=join(temporary,'result.json');
    await fs.writeFile(scan,scannedPdf({mixed:true}));
    const probe = join(temporary,'probe.cjs');
    await fs.writeFile(probe, `
const { app, session } = require('electron');
const { Worker } = require('node:worker_threads');
const { createRequire, isBuiltin, Module } = require('node:module');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const archive = ${JSON.stringify(archive)};
const isolatedProfile = ${JSON.stringify(join(temporary, 'profile'))};
fs.mkdirSync(isolatedProfile, { recursive: true });
app.setPath('userData', isolatedProfile);
app.setPath('sessionData', isolatedProfile);
globalThis.fetch = async () => { throw new Error('Network access is disabled in the ASAR fixture.'); };
const requireAuthoring = createRequire(path.join(archive, 'node_modules/docx/package.json'));
const runtimeExports = ['docx', 'docx/math', 'docx/html', 'docx/charts', 'pptxgenjs', '@xmldom/xmldom', 'marked', 'katex'];
const resolvedExports = {};
const insideArchive = (filename) => [archive, archive + '.unpacked'].some(base => {
  const local = path.relative(base, filename);
  return local && !local.startsWith('..') && !path.isAbsolute(local);
});
for (const name of runtimeExports) {
  resolvedExports[name] = requireAuthoring.resolve(name);
  assert.ok(insideArchive(resolvedExports[name]), name + ' resolved outside the fixture ASAR.');
}
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function documentAuthoring() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, ...rest) {
    const result = originalResolve.call(this, request, parent, ...rest);
    if (!isBuiltin(request) && request !== 'electron') {
      assert.ok(insideArchive(result), 'Authoring dependency escaped the ASAR: ' + request + ' -> ' + result);
    }
    return result;
  };
  try {
  const docx = requireAuthoring('docx');
  const { latexToMath } = requireAuthoring('docx/math');
  const { htmlToContent } = requireAuthoring('docx/html');
  const { ChartRun } = requireAuthoring('docx/charts');
  const { DOMParser } = requireAuthoring('@xmldom/xmldom');
  const { Marked } = requireAuthoring('marked');
  const katex = requireAuthoring('katex');
  const PptxGenJS = requireAuthoring('pptxgenjs');
  const JSZip = requireAuthoring('jszip');
  const fraction = ${JSON.stringify(String.raw`\frac{1}{2}+\sqrt{x^2+1}`)};
  const matrix = ${JSON.stringify(String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`)};
  const markdown = new Marked({ gfm: true }).parse('# MARKDOWN_ASAR_131\\n\\n**Bold** and *italic*.\\n\\n1. First\\n2. Second\\n', { async: false });
  const mathHtml = katex.renderToString(fraction, { output: 'mathml', displayMode: true, throwOnError: true, trust: false, strict: 'error' });
  assert.ok(mathHtml.includes('<math') && mathHtml.includes('<mfrac>'), 'Packaged KaTeX did not render MathML.');
  const markdownContent = htmlToContent(markdown + '<p>Inline <span data-latex="x^2">x^2</span></p>');
  const word = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ children: [new docx.TextRun({ text: '中文文档验收', bold: true })] }),
        new docx.Table({
          rows: [new docx.TableRow({
            children: [
              new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: '指标' })] })] }),
              new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: '状态' })] })] }),
            ],
          })],
        }),
        new docx.Paragraph({
          children: [new docx.ImageRun({
            type: 'png',
            data: tinyPng,
            transformation: { width: 1, height: 1 },
          })],
        }),
        new docx.Paragraph({ children: [new docx.Math({ children: latexToMath(fraction) })] }),
        new docx.Paragraph({ children: [new docx.Math({ children: latexToMath(matrix) })] }),
        ...markdownContent,
        new docx.Paragraph({
          children: [new ChartRun({
            type: 'column',
            categories: ['Alpha', 'Beta'],
            series: [{ name: 'Values', values: [2, 5], color: '167D8D' }],
            transformation: { width: 480, height: 280 },
            legend: false,
            valueAxis: { minimum: 0 },
          })],
        }),
      ],
    }],
  });
  const docxBytes = await docx.Packer.toBuffer(word);
  const wordZip = await JSZip.loadAsync(docxBytes);
  const wordXml = await wordZip.file('word/document.xml').async('string');
  assert.ok(wordXml.includes('中文文档验收'), 'DOCX Chinese text missing');
  assert.ok(wordXml.includes('<w:tbl>'), 'DOCX table missing');
  assert.ok(Object.keys(wordZip.files).some(name => name.startsWith('word/media/')), 'DOCX image missing');
  const xmlErrors = [];
  const xmlParser = new DOMParser({ errorHandler: { warning: text => xmlErrors.push(text), error: text => xmlErrors.push(text), fatalError: text => xmlErrors.push(text) } });
  const parsed = xmlParser.parseFromString(wordXml, 'application/xml');
  assert.deepEqual(xmlErrors, [], 'Generated DOCX XML is malformed.');
  const mathNs = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const equations = parsed.getElementsByTagNameNS(mathNs, 'oMath').length;
  assert.equal(equations, 3, 'DOCX must contain fraction/root, matrix and inline Markdown OMML.');
  for (const localName of ['f', 'rad', 'm', 'sSup']) {
    assert.ok(parsed.getElementsByTagNameNS(mathNs, localName).length > 0, 'Native OMML structure missing: ' + localName);
  }
  assert.ok(wordXml.includes('MARKDOWN_ASAR_131') && wordXml.includes('<w:numPr>'), 'Native Markdown heading or numbered list missing.');
  const chartPaths = Object.keys(wordZip.files).filter(name => /charts\\/chart[^/]*\\.xml$/.test(name));
  const workbookPaths = Object.keys(wordZip.files).filter(name => /embeddings\\/[^/]*\\.xlsx$/.test(name));
  assert.equal(chartPaths.length, 1, 'Native chart missing.');
  assert.equal(workbookPaths.length, 1, 'Editable chart workbook missing.');
  const chartXml = await wordZip.file(chartPaths[0]).async('string');
  assert.ok(chartXml.includes('<c:barChart>') && chartXml.includes('<c:externalData'), 'Native chart data relationship missing.');
  const workbook = await JSZip.loadAsync(await wordZip.file(workbookPaths[0]).async('nodebuffer'));
  const worksheet = await workbook.file('xl/worksheets/sheet1.xml').async('string');
  const strings = workbook.file('xl/sharedStrings.xml') ? await workbook.file('xl/sharedStrings.xml').async('string') : worksheet;
  assert.ok(strings.includes('Alpha') && strings.includes('Beta'), 'Chart workbook categories missing.');
  assert.ok(worksheet.includes('<v>2</v>') && worksheet.includes('<v>5</v>'), 'Chart workbook values missing.');
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  const slide = presentation.addSlide();
  slide.addText('中文演示验收', { x: 1, y: 0.5, w: 5, h: 0.5 });
  slide.addTable([['指标', '状态'], ['文档', '通过']], { x: 1, y: 1.2, w: 5, h: 1 });
  slide.addImage({ data: 'data:' + 'image/png;base64,' + tinyPng.toString('base64'), x: 7, y: 1, w: 1, h: 1 });
  slide.addNotes('演讲者备注验收');
  const pptxBytes = await presentation.write({ outputType: 'nodebuffer' });
  const pptxZip = await JSZip.loadAsync(pptxBytes);
  const slideXml = await pptxZip.file('ppt/slides/slide1.xml').async('string');
  const notesXml = await pptxZip.file('ppt/notesSlides/notesSlide1.xml').async('string');
  assert.ok(slideXml.includes('中文演示验收'), 'PPTX Chinese text missing');
  assert.ok(slideXml.includes('<a:tbl>'), 'PPTX table missing');
  assert.ok(notesXml.includes('演讲者备注验收'), 'PPTX notes missing');
  assert.ok(Object.keys(pptxZip.files).some(name => name.startsWith('ppt/media/')), 'PPTX image missing');
  return {
    docx: { bytes: docxBytes.length, table: true, image: true, equations, markdown: true, chart: true, workbook: true },
    pptx: { bytes: pptxBytes.length, table: true, image: true, notes: true },
    mathml: true,
    runtimeExports: resolvedExports,
  };
  } finally {
    Module._resolveFilename = originalResolve;
  }
}
async function workerRead(extension, mode, file) {
  return await new Promise((done, reject) => {
    const worker = new Worker(${JSON.stringify(join(desktop, 'resources/documents/document-worker.cjs'))}, {
      workerData: {
        bytes: fs.readFileSync(file),
        extension,
        mode,
        moduleBase: ${JSON.stringify(join(archive, 'node_modules/mammoth/package.json'))},
        languageDirectory: ${JSON.stringify(temporary)},
      },
    });
    worker.once('message', async value => {
      await worker.terminate();
      value.error ? reject(new Error(value.error)) : done(value.result);
    });
    worker.once('error', reject);
  });
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const results = [
    await workerRead('.pdf', 'ocr', ${JSON.stringify(scan)}),
    await workerRead('.pdf', 'vision', ${JSON.stringify(scan)}),
    await workerRead('.doc', 'ocr', ${JSON.stringify(resolve(__dirname, 'fixtures/legacy-word-test01.doc'))}),
  ];
  const authoring = await documentAuthoring();
  fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ results, authoring }));
  app.quit();
}).catch(error => {
  fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ error: String(error), stack: error.stack }));
  app.exit(1);
});
`);
    const env={...process.env,NODE_PATH:''};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(join(dirname(requireApp.resolve('electron/package.json')),'dist/electron.exe'),[probe],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
    const timer=setTimeout(()=>child.kill(),60000);
    const code=await new Promise((done,reject)=>{child.once('exit',done);child.once('error',reject);});clearTimeout(timer);
    const outputs=JSON.parse(await fs.readFile(result,'utf8').catch(()=>`{"error":${JSON.stringify(stderr)}}`));
    assert.equal(code,0,JSON.stringify(outputs));
    assert.ok(outputs.results[0].text.includes('Offline PDF scan evidence 127'));
    assert.ok(outputs.results[0].text.replace(/\s/g,'').includes('中文扫描文档测试'));
    assert.equal(outputs.results[1].pageImages.length,1);
    assert.ok(outputs.results[2].text.includes('Unicode characters'));
    assert.ok(outputs.authoring.docx.bytes > 0 && outputs.authoring.docx.table && outputs.authoring.docx.image);
    assert.equal(outputs.authoring.docx.equations, 3);
    assert.ok(outputs.authoring.docx.markdown && outputs.authoring.docx.chart && outputs.authoring.docx.workbook && outputs.authoring.mathml);
    assert.deepEqual(Object.keys(outputs.authoring.runtimeExports).sort(), ['docx', 'docx/math', 'docx/html', 'docx/charts', 'pptxgenjs', '@xmldom/xmldom', 'marked', 'katex'].sort());
    assert.ok(outputs.authoring.pptx.bytes > 0 && outputs.authoring.pptx.table && outputs.authoring.pptx.image && outputs.authoring.pptx.notes);
    console.log('Electron ASAR document runtime passed: offline Chinese/English OCR, page rendering, legacy DOC, native OMML/Markdown/chart/workbook, KaTeX MathML, DOCX/PPTX authoring and isolated packaged dependency closure.');
  } finally {
    const local=relative(tmpdir(),temporary);assert.ok(local&&!local.startsWith('..')&&!isAbsolute(local));await fs.rm(temporary,{recursive:true,force:true,maxRetries:3});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
