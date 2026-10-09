// The two picture formats `scripts/installer/build-images.mjs` writes, with nothing but Node: the Windows bitmap that
// NSIS draws on the pages of the installer, and a PNG of the same pixels for looking at it.
import { crc32, deflateSync } from 'node:zlib';

/** @typedef {Uint8Array | Uint8ClampedArray} Pixels RGBA, 4 bytes a pixel, the top row first (what a canvas gives) */

/** @param {Pixels} rgba @param {number} width @param {number} height */
function checkSize(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new Error(`${rgba.length} bytes are not the pixels of a ${width} x ${height} picture`);
  }
}

/**
 * A 24-bit Windows bitmap, not compressed (BI_RGB): 14 bytes of file header, 40 of info header, then the rows from
 * the bottom up, each pixel as blue, green, red, each row padded with zeros to a multiple of four bytes.
 * A bitmap has no transparency, so a pixel that is not fully opaque is an error: paint the background first.
 * @param {Pixels} rgba @param {number} width @param {number} height
 * @returns {Buffer}
 */
export function encodeBmp24(rgba, width, height) {
  checkSize(rgba, width, height);
  const rowBytes = Math.floor((24 * width + 31) / 32) * 4;
  const dataBytes = rowBytes * height;
  const bmp = Buffer.alloc(54 + dataBytes); // zeros: the padding of the rows is already there
  bmp.write('BM', 0, 'latin1');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10); // where the pixels start
  bmp.writeUInt32LE(40, 14); // size of the info header
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22); // positive: the first row in the file is the bottom one
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30); // BI_RGB
  bmp.writeUInt32LE(dataBytes, 34);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      if (rgba[from + 3] !== 255) throw new Error(`the pixel ${x},${y} is not opaque: a bitmap has no transparency`);
      bmp[row + x * 3] = rgba[from + 2];
      bmp[row + x * 3 + 1] = rgba[from + 1];
      bmp[row + x * 3 + 2] = rgba[from];
    }
  }
  return bmp;
}

/** One chunk of a PNG: length, type, data, and the CRC of type and data. */
function chunk(/** @type {string} */ type, /** @type {Buffer} */ data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/**
 * A PNG of 8-bit RGBA, no filtering, one IDAT chunk. For looking at what the installer will draw, not for the installer.
 * @param {Pixels} rgba @param {number} width @param {number} height
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height) {
  checkSize(rgba, width, height);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // colour type: RGBA
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height); // every row starts with its filter byte, 0: none
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * rowBytes, rowBytes).copy(raw, y * (rowBytes + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
