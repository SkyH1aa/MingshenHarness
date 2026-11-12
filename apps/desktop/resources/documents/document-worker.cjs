const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const { copyFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const requireApp = createRequire(workerData.moduleBase);
const physical = value => value.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const MAX_PAGES = 200, MAX_IMAGE_PAGES = 20, MAX_TEXT = 120000;
let recognizer;

async function pdf(bytes, mode) {
  const canvas = requireApp('@napi-rs/canvas');
  // PDF.js reads these globals at module evaluation time.
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, Path2D: canvas.Path2D, ImageData: canvas.ImageData });
  const { getDocumentProxy, getResolvedPDFJS, renderPageAsImage } = await import(pathToFileURL(requireApp.resolve('unpdf')).href);
  const { OPS } = await getResolvedPDFJS();
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject]);
  const doc = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, maxImageSize: 16000000 });
  const warnings = [], pages = [], text = [];
  let imageBytes = 0, ocrCount = 0, textLength = 0, inspected = 0;
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
        const render = mode === 'vision' ? pages.length < MAX_IMAGE_PAGES : mode === 'ocr' && needsOcr && ocrCount < MAX_IMAGE_PAGES;
        if (render) {
          const viewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, 2000 / Math.max(viewport.width, viewport.height));
          if (!Number.isFinite(scale) || scale <= 0 || viewport.width <= 0 || viewport.height <= 0) throw Error('Invalid PDF page dimensions.');
          const image = await renderPageAsImage(doc, number, { canvasImport: async () => canvas, scale, format: 'png' });
          if (mode === 'vision') {
            if (imageBytes + image.length <= 20 * 1024 * 1024) {
              pages.push({ page: number, dataUrl: 'data:' + 'image/png;base64,' + Buffer.from(image).toString('base64') });
              imageBytes += image.length;
            } else warnings.push(`PDF page ${number} image omitted: 20 MiB rendered-image budget reached.`);
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
    if (workerData.extension === '.doc') {
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
