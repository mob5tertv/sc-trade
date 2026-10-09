// Reading a PNG with nothing but Node, and cutting the window of the application out of a picture of the preview.
// (Writing a PNG is scripts/installer/encode.mjs.) Enough for what a browser writes: 8 bits a channel, RGB or RGBA,
// not interlaced.
import { inflateSync } from 'node:zlib';

/** @typedef {{ width: number, height: number, rgba: Uint8Array }} Image RGBA, 4 bytes a pixel, the top row first */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The frame of the window (`--sc-frame` of src/ui/theme.css): what the window is found by in a picture. */
const FRAME = [0x2b, 0x8f, 0xa8];

/** @param {number} a left @param {number} b above @param {number} c above left */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * @param {Uint8Array} png the bytes of the file
 * @returns {Image}
 */
export function decodePng(png) {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let width = 0;
  let height = 0;
  let channels = 0;
  /** @type {Buffer[]} */
  const data = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error(`a PNG of ${body[8]} bits a channel cannot be read here, only 8`);
      if (body[9] !== 2 && body[9] !== 6) throw new Error(`a PNG of colour type ${body[9]} cannot be read here, only RGB (2) and RGBA (6)`);
      if (body[12] !== 0) throw new Error('an interlaced PNG cannot be read here');
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (channels === 0) throw new Error('not a PNG file: it has no header');

  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== (stride + 1) * height) throw new Error('the PNG is damaged: its data is not the size its header says');
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : -1;
      if (predicted < 0) throw new Error(`the PNG is damaged: the row ${y} has the unknown filter ${filter}`);
      row[i] = (row[i] + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;
      rgba[to] = row[x * channels];
      rgba[to + 1] = row[x * channels + 1];
      rgba[to + 2] = row[x * channels + 2];
      rgba[to + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

/**
 * Where the window is in a picture of the preview: the rectangle its frame runs along, and how big its two cut
 * corners are (the top edge of the frame begins that many pixels from the left side).
 * @param {Image} image
 * @returns {{ left: number, top: number, width: number, height: number, cut: number }}
 */
export function findFrame(image) {
  const { width, height, rgba } = image;
  const isFrame = (/** @type {number} */ x, /** @type {number} */ y) => {
    const at = (y * width + x) * 4;
    return rgba[at] === FRAME[0] && rgba[at + 1] === FRAME[1] && rgba[at + 2] === FRAME[2];
  };
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFrame(x, y)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error('the picture has no frame of the window (its colour is not there)');
  let cut = 0;
  while (left + cut <= right && !isFrame(left + cut, top)) cut++;
  return { left, top, width: right - left + 1, height: bottom - top + 1, cut };
}

/**
 * The window alone: the picture cropped to the frame, and the two cut corners (top left, bottom right) made
 * transparent, with one half-transparent pixel along each cut so that the edge is not a staircase.
 * @param {Image} image a picture of the preview: the window with something around it
 * @returns {Image}
 */
export function cutWindow(image) {
  const frame = findFrame(image);
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let y = 0; y < frame.height; y++) {
    const from = ((frame.top + y) * image.width + frame.left) * 4;
    rgba.set(image.rgba.subarray(from, from + frame.width * 4), y * frame.width * 4);
    for (let x = 0; x < frame.width; x++) {
      // how far the pixel is inside the cut line of its nearer corner, in pixels along x + y
      const inside = Math.min(x + y, frame.width - 1 - x + (frame.height - 1 - y)) - frame.cut;
      if (inside < 0) rgba[(y * frame.width + x) * 4 + 3] = inside === -1 ? 128 : 0;
    }
  }
  return { width: frame.width, height: frame.height, rgba };
}
