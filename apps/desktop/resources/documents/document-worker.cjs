const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { copyFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const requireApp = createRequire(workerData.moduleBase);
const physical = value => value.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const MAX_PAGES = 200, MAX_IMAGE_PAGES = 20, MAX_TEXT = 120000;
const MAX_ARCHIVE_ENTRIES = 4000, MAX_ARCHIVE_BYTES = 100 * 1024 * 1024, MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_SPREADSHEET_SHEETS = 200, MAX_SPREADSHEET_ROWS = 5000, MAX_SPREADSHEET_COLUMNS = 256, MAX_SPREADSHEET_CELLS = 50000;
let recognizer;

function decodeXmlEntities(value) {
  return value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");
}

function extractXmlText(xml, elementName) {
  const expression = new RegExp(`<${elementName}(?:\\s[^>]*)?>([\\s\\S]*?)</${elementName}>`, 'g');
  return [...xml.matchAll(expression)]
    .map(match => decodeXmlEntities((match[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean)
    .join('\n');
}

function safeArchive(bytes) {
  const { unzipSync } = requireApp('fflate');
  const archive = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(archive);
  if (names.length > MAX_ARCHIVE_ENTRIES) throw Error('Document archive contains too many entries.');
  let total = 0;
  for (const name of names) {
    const size = archive[name]?.length || 0;
    total += size;
    if (size > MAX_ENTRY_BYTES || total > MAX_ARCHIVE_BYTES) throw Error('Document archive exceeds safe extraction limits.');
  }
  return archive;
}

function rejectActiveXml(xml, label) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error(`${label} XML declarations are not supported.`);
}

async function docx(bytes) {
  const mammoth = requireApp('mammoth');
  const { DOMParser } = requireApp('@xmldom/xmldom');
  const archive = safeArchive(bytes);
  const documentBytes = archive['word/document.xml'];
  if (!documentBytes) throw Error('Invalid DOCX: word/document.xml is missing.');
  const xml = Buffer.from(documentBytes).toString('utf8');
  rejectActiveXml(xml, 'Document');
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const equations = Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath'));
  const mathSummary = equations.slice(0, 128).map((equation, index) => `Equation ${index + 1} (OMML, linear text only): ${equation.textContent || ''}`).join('\n');
  return {
    format: 'DOCX',
    text: (result.value + (mathSummary ? `\n\n${mathSummary}` : '')).slice(0, MAX_TEXT),
    warnings: [
      ...result.messages.map(message => message.message),
      ...(equations.length ? [`${equations.length} native editable equations; linear extraction does not preserve fraction/script layout. Inspect the DOCX visually.`] : []),
      ...(equations.length > 128 ? ['Equation text limited to the first 128 equations.'] : []),
      ...(result.value.length + mathSummary.length > MAX_TEXT ? [`DOCX text truncated at ${MAX_TEXT} characters.`] : []),
    ],
  };
}

function spreadsheet(bytes, extension) {
  const XLSX = requireApp('xlsx');
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  const sheetNames = workbook.SheetNames.slice(0, MAX_SPREADSHEET_SHEETS);
  const warnings = [];
  if (sheetNames.length < workbook.SheetNames.length) warnings.push(`Spreadsheet extraction covers the first ${MAX_SPREADSHEET_SHEETS} sheets.`);
  let text = '';
  let inspectedCells = 0;
  for (const name of sheetNames) {
    if (text.length >= MAX_TEXT) break;
    const sheet = workbook.Sheets[name];
    const rows = [];
    const reference = sheet?.['!ref'];
    if (reference) {
      const range = XLSX.utils.decode_range(reference);
      const endRow = Math.min(range.e.r, range.s.r + MAX_SPREADSHEET_ROWS - 1);
      const endColumn = Math.min(range.e.c, range.s.c + MAX_SPREADSHEET_COLUMNS - 1);
      if (endRow < range.e.r || endColumn < range.e.c) warnings.push(`Sheet "${name}" is truncated to ${MAX_SPREADSHEET_ROWS} rows and ${MAX_SPREADSHEET_COLUMNS} columns.`);
      for (let row = range.s.r; row <= endRow && inspectedCells < MAX_SPREADSHEET_CELLS; row++) {
        const values = [];
        for (let column = range.s.c; column <= endColumn && inspectedCells < MAX_SPREADSHEET_CELLS; column++) {
          inspectedCells++;
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (!cell) continue;
          const value = cell.w ?? cell.v;
          if (value !== undefined && value !== null) values.push(String(value));
        }
        if (values.length) rows.push(values.join('\t'));
      }
    }
    const block = `# ${name}\n${rows.join('\n')}`;
    text += `${text ? '\n\n' : ''}${block.slice(0, MAX_TEXT - text.length)}`;
  }
  if (inspectedCells >= MAX_SPREADSHEET_CELLS) warnings.push(`Spreadsheet extraction inspected at most ${MAX_SPREADSHEET_CELLS} cells.`);
  if (text.length >= MAX_TEXT) warnings.push(`Spreadsheet text truncated at ${MAX_TEXT} characters.`);
  return { format: extension.slice(1).toUpperCase(), text, warnings };
}

function pptx(bytes) {
  const archive = safeArchive(bytes);
  if (!archive['ppt/presentation.xml']) throw Error('Invalid PPTX: ppt/presentation.xml is missing.');
  const slideNames = Object.keys(archive)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)\.xml$/i)?.[1] || 0) - Number(right.match(/slide(\d+)\.xml$/i)?.[1] || 0));
  if (!slideNames.length) throw Error('Invalid PPTX: no slides were found.');
  const warnings = [];
  const selected = slideNames.slice(0, MAX_PAGES);
  if (selected.length < slideNames.length) warnings.push(`PPTX extraction covers the first ${MAX_PAGES} of ${slideNames.length} slides.`);
  let text = '';
  for (const [index, name] of selected.entries()) {
    const xml = Buffer.from(archive[name]).toString('utf8');
    rejectActiveXml(xml, 'Presentation');
    const block = `# 幻灯片 ${index + 1}\n${extractXmlText(xml, 'a:t')}`;
    text += `${text ? '\n\n' : ''}${block.slice(0, MAX_TEXT - text.length)}`;
    if (text.length >= MAX_TEXT) {
      warnings.push(`PPTX text truncated at ${MAX_TEXT} characters.`);
      break;
    }
  }
  return { format: 'PPTX', text, warnings };
}

function odt(bytes) {
  const archive = safeArchive(bytes);
  if (!archive['content.xml']) throw Error('ODT 文件缺少 content.xml。');
  const xml = Buffer.from(archive['content.xml']).toString('utf8');
  rejectActiveXml(xml, 'OpenDocument');
  const text = decodeXmlEntities(xml.replace(/<text:line-break\/>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim());
  return {
    format: 'ODT',
    text: text.slice(0, MAX_TEXT),
    warnings: text.length > MAX_TEXT ? [`ODT text truncated at ${MAX_TEXT} characters.`] : [],
  };
}

async function pdf(bytes, mode) {
  const canvas = requireApp('@napi-rs/canvas');
  // PDF.js reads these globals at module evaluation time.
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, Path2D: canvas.Path2D, ImageData: canvas.ImageData });
  const { getDocumentProxy, getResolvedPDFJS, renderPageAsImage } = await import(pathToFileURL(requireApp.resolve('unpdf')).href);
  const { OPS } = await getResolvedPDFJS();
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject]);
  const doc = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, maxImageSize: 16000000 });
  const warnings = [], pages = [], text = [];
  let imageBytes = 0, ocrCount = 0, textLength = 0, inspected = 0, visionImageBudgetReached = false;
  try {
    const count = Math.min(doc.numPages, MAX_PAGES);
    if (count < doc.numPages) warnings.push(`PDF text extraction covers the first ${count} of ${doc.numPages} pages.`);
    for (let number = 1; number <= count; number++) {
      const page = await doc.getPage(number);
      try {
        const content = await page.getTextContent();
        let value = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        const operators = mode === 'ocr' ? await page.getOperatorList() : null;
        const hasImages = operators?.fnArray.some(operation => imageOps.has(operation));
        const needsOcr = !value.trim() || Boolean(hasImages);
        const render = mode === 'vision' ? !visionImageBudgetReached && pages.length < MAX_IMAGE_PAGES : mode === 'ocr' && needsOcr && ocrCount < MAX_IMAGE_PAGES;
        if (render) {
          const viewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 2000 / Math.max(viewport.width, viewport.height));
          if (!Number.isFinite(scale) || scale <= 0 || viewport.width <= 0 || viewport.height <= 0) throw Error('Invalid PDF page dimensions.');
          const image = await renderPageAsImage(doc, number, { canvasImport: async () => canvas, scale, format: 'png' });
          if (mode === 'vision') {
            if (imageBytes + image.length <= 20 * 1024 * 1024) {
              pages.push({ page: number, dataUrl: 'data:' + 'image/png;base64,' + Buffer.from(image).toString('base64') });
              imageBytes += image.length;
            } else {
              visionImageBudgetReached = true;
              warnings.push(`PDF page ${number} image omitted: 20 MiB rendered-image budget reached; later page rendering was stopped.`);
            }
          } else {
            if (!recognizer) {
              const { createWorker } = requireApp('tesseract.js');
              for (const code of ['eng', 'chi_sim']) copyFileSync(physical(requireApp.resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`)), join(workerData.languageDirectory, `${code}.traineddata.gz`));
              recognizer = await createWorker('eng+chi_sim', 1, { workerPath: physical(requireApp.resolve('tesseract.js/src/worker-script/node/index.js')), langPath: workerData.languageDirectory, cacheMethod: 'none', gzip: true, errorHandler: () => {} });
            }
            ocrCount++;
            const result = await recognizer.recognize(Buffer.from(image));
            if (!result.data.text.trim()) warnings.push(`PDF page ${number} OCR returned no recognizable text. Do not assume the page is empty; use a visual model or a clearer scan.`);
            value = [value, `[Offline OCR, page ${number}, confidence ${Math.round(result.data.confidence)}%; may contain recognition errors]\n${result.data.text.trim()}`].filter(Boolean).join('\n');
          }
        } else if (mode === 'ocr' && needsOcr) warnings.push(`PDF page ${number} OCR omitted: ${MAX_IMAGE_PAGES}-page OCR limit reached.`);
        if (value) { const block = `[Page ${number}]\n${value}`; text.push(block.slice(0, MAX_TEXT - textLength)); textLength += block.length; }
        inspected = number;
        if (textLength >= MAX_TEXT) { warnings.push(`PDF text truncated at ${MAX_TEXT} characters after page ${number}.`); break; }
      } finally { page.cleanup(); }
    }
    if (mode === 'vision' && pages.length < doc.numPages) warnings.push(`PDF visual input includes ${pages.length} of ${doc.numPages} pages (maximum ${MAX_IMAGE_PAGES} pages / 20 MiB). Do not claim the omitted pages were viewed.`);
    if (mode === 'ocr') warnings.push('Offline OCR supports printed Simplified Chinese and English. Handwriting, equations and complex layouts may be inaccurate; use a PDF/image-capable model for visual interpretation.');
    return { format: 'PDF', text: text.join('\n\n'), warnings, pdf: { totalPages: doc.numPages, inspectedPages: inspected, ocrPages: ocrCount }, pageImages: pages };
  } finally { await doc.loadingTask.destroy(); }
}
async function main() {
  try {
    const bytes = Buffer.from(workerData.bytes);
    let result;
    if (workerData.extension === '.docx') result = await docx(bytes);
    else if (workerData.extension === '.xlsx' || workerData.extension === '.xls') result = spreadsheet(bytes, workerData.extension);
    else if (workerData.extension === '.pptx') result = pptx(bytes);
    else if (workerData.extension === '.odt') result = odt(bytes);
    else if (workerData.extension === '.doc') {
      if (!bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw Error('Invalid or unsupported legacy DOC file. Expected a Word 97-2003 OLE document; encrypted documents must be decrypted first.');
      const WordExtractor = requireApp('word-extractor');
      const doc = await new WordExtractor().extract(bytes);
      const text = [doc.getBody(), doc.getHeaders(), doc.getFootnotes(), doc.getEndnotes(), doc.getTextboxes()].filter(Boolean).join('\n\n');
      result = { format: 'DOC', text: text.slice(0, MAX_TEXT), warnings: ['Legacy DOC text extraction does not execute macros or preserve image/layout content.', ...(text.length > MAX_TEXT ? [`DOC text truncated at ${MAX_TEXT} characters.`] : [])] };
    } else result = await pdf(bytes, workerData.mode);
    parentPort.postMessage({ result });
  } catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { if (recognizer) await recognizer.terminate(); parentPort.close(); }
}
void main();
