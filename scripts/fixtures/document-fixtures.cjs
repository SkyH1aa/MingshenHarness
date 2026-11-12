const { createCanvas, PDFDocument } = require('@napi-rs/canvas');

function scannedPdf({ pages = 1, mixed = false, handwriting = false } = {}) {
  const document = new PDFDocument();
  for (let index = 0; index < pages; index++) {
    const canvas = createCanvas(1000, 700);
    const image = canvas.getContext('2d');
    image.fillStyle = '#fff'; image.fillRect(0, 0, 1000, 700);
    image.fillStyle = '#111'; image.font = '40px Arial';
    image.fillText('Offline PDF scan evidence 127', 60, 100);
    image.font = '32px "Microsoft YaHei"';
    image.fillText('\u4e2d\u6587\u626b\u63cf\u6587\u6863\u6d4b\u8bd5', 60, 180);
    if (handwriting) {
      image.lineWidth = 3; image.beginPath();
      image.moveTo(80, 280); image.bezierCurveTo(110, 220, 160, 370, 220, 270);
      image.bezierCurveTo(280, 200, 310, 350, 380, 260); image.stroke();
    }
    const page = document.beginPage(500, 350);
    page.drawImage(canvas, 0, 0, 500, 350);
    if (mixed) { page.font = '12px Arial'; page.fillText('Mixed page digital title', 20, 320); }
    document.endPage();
  }
  return document.close();
}
module.exports = { scannedPdf };
