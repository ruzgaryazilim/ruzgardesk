// Generates build/icon.png (256x256 RGBA) and build/icon.ico with no external deps.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// ---- CRC32 for PNG chunks --------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Pixel art -------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function roundedAlpha(x, y, w, h, r) {
  // signed-distance style coverage for a rounded rectangle
  const dx = Math.max(Math.abs(x - w / 2) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - h / 2) - (h / 2 - r), 0);
  const dist = Math.sqrt(dx * dx + dy * dy) - r;
  if (dist <= -1) return 1;
  if (dist >= 1) return 0;
  return (1 - (dist + 1) / 2);
}
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function buildRGBA() {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  // Remote-cursor motif (scaled from a 24x24 path), white on gradient.
  const s = 7, ox = 44, oy = 40;
  const cursor = [[3, 3], [10.07, 19.97], [12.58, 13.35], [19.2, 10.84]].map(([x, y]) => [x * s + ox, y * s + oy]);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const bgA = roundedAlpha(x, y, SIZE, SIZE, 56);
      // diagonal violet -> indigo gradient
      const t = (x + y) / (2 * SIZE);
      let r = Math.round(lerp(124, 79, t));
      let g = Math.round(lerp(58, 70, t));
      let b = Math.round(lerp(237, 229, t));

      // soft top-left glow
      const gx = x - 70, gy = y - 60;
      const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy) / 180);
      r = Math.min(255, r + glow * 60);
      g = Math.min(255, g + glow * 40);
      b = Math.min(255, b + glow * 20);

      if (pointInPoly(x, y, cursor)) { r = 255; g = 255; b = 255; }

      data[i] = r; data[i + 1] = g; data[i + 2] = b;
      data[i + 3] = Math.round(bgA * 255);
    }
  }
  return data;
}

function encodePNG(rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function wrapICO(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // 0 == 256 px
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, png]);
}

const rgba = buildRGBA();
const png = encodePNG(rgba);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), wrapICO(png));
fs.writeFileSync(path.join(__dirname, '..', 'public', 'logo.png'), png);
console.log('icon.png + icon.ico generated');
