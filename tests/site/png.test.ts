import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../../scripts/installer/encode.mjs';
import { cutWindow, decodePng, findFrame } from '../../scripts/site/png.mjs';

const FRAME = [0x2b, 0x8f, 0xa8] as const;
const GLASS = [0x07, 0x12, 0x1b] as const;
const BACKDROP = [0x30, 0x40, 0x70] as const;

/** A picture of `width` x `height` painted by a function of the place. */
function paint(width: number, height: number, colour: (x: number, y: number) => readonly number[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = colour(x, y);
      rgba.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return rgba;
}

/**
 * What a picture of the preview looks like: a backdrop, and on it a window `w` x `h` at `left`,`top` — glass inside a
 * frame of 2 px, the top-left and the bottom-right corner cut by `cut` px (the backdrop shows in the cut).
 */
function windowPicture(options: { width: number; height: number; left: number; top: number; w: number; h: number; cut: number }) {
  const { left, top, w, h, cut } = options;
  return paint(options.width, options.height, (x, y) => {
    const i = x - left;
    const j = y - top;
    if (i < 0 || j < 0 || i >= w || j >= h) return BACKDROP;
    if (i + j < cut || w - 1 - i + (h - 1 - j) < cut) return BACKDROP;
    const onEdge = i < 2 || j < 2 || i >= w - 2 || j >= h - 2 || i + j < cut + 3 || w - 1 - i + (h - 1 - j) < cut + 3;
    return onEdge ? FRAME : GLASS;
  });
}

const pixel = (image: { width: number; rgba: Uint8Array }, x: number, y: number) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

/** One chunk of a PNG: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** A PNG file from raw scanlines (each with its filter byte in front), the data cut into two chunks as a browser may write it. */
function pngOf(width: number, height: number, colourType: number, scanlines: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colourType;
  const data = deflateSync(scanlines);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', data.subarray(0, 5)),
    chunk('IDAT', data.subarray(5)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('decodePng', () => {
  it('reads back what the encoder of the project wrote', () => {
    const rgba = paint(7, 5, (x, y) => [x * 30, y * 50, (x + y) * 10, 255 - x]);
    const image = decodePng(encodePng(rgba, 7, 5));
    expect(image.width).toBe(7);
    expect(image.height).toBe(5);
    expect([...image.rgba]).toEqual([...rgba]);
  });

  it('undoes every filter of a row: none, sub, up, average, Paeth', () => {
    // 3 x 5, RGBA; the rows are written with the filters 0..4 by hand from these pixels
    const width = 3;
    const rows = [
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255],
      [11, 22, 33, 255, 44, 55, 66, 255, 77, 88, 99, 255],
      [5, 6, 7, 200, 8, 9, 10, 201, 250, 251, 252, 202],
      [100, 0, 255, 255, 0, 100, 255, 128, 255, 255, 0, 0],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    ];
    const bpp = 4;
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    const scanlines: number[] = [];
    rows.forEach((row, y) => {
      const up = y === 0 ? row.map(() => 0) : rows[y - 1];
      scanlines.push(y);
      row.forEach((value, i) => {
        const a = i >= bpp ? row[i - bpp] : 0;
        const c = i >= bpp ? up[i - bpp] : 0;
        const predicted = [0, a, up[i], Math.floor((a + up[i]) / 2), paeth(a, up[i], c)][y];
        scanlines.push((value - predicted) & 0xff);
      });
    });
    const image = decodePng(pngOf(width, rows.length, 6, Uint8Array.from(scanlines)));
    expect([...image.rgba]).toEqual(rows.flat());
  });

  it('reads a picture without transparency as fully opaque', () => {
    const scanlines = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 0, 7, 8, 9, 10, 11, 12]);
    const image = decodePng(pngOf(2, 2, 2, scanlines));
    expect([...image.rgba]).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
  });

  it('refuses what is not a PNG it can read, and says why', () => {
    expect(() => decodePng(Buffer.from('not a picture at all'))).toThrow(/not a PNG/);
    const palette = pngOf(2, 2, 3, Uint8Array.from([0, 1, 2, 0, 3, 4]));
    expect(() => decodePng(palette)).toThrow(/colour type 3/);
  });
});

describe('the window in a picture of the preview', () => {
  const options = { width: 120, height: 80, left: 16, top: 16, w: 88, h: 48, cut: 18 };

  it('is found by its frame: the rectangle and the size of the cut corners', () => {
    const image = { width: options.width, height: options.height, rgba: windowPicture(options) };
    expect(findFrame(image)).toEqual({ left: 16, top: 16, width: 88, height: 48, cut: 18 });
  });

  it('is cut out along the frame: nothing of the backdrop is left, the cut corners are transparent', () => {
    const image = cutWindow({ width: options.width, height: options.height, rgba: windowPicture(options) });
    expect([image.width, image.height]).toEqual([88, 48]);
    // the two cut corners: transparent
    expect(pixel(image, 0, 0)[3]).toBe(0);
    expect(pixel(image, 8, 8)[3]).toBe(0);
    expect(pixel(image, 87, 47)[3]).toBe(0);
    expect(pixel(image, 79, 39)[3]).toBe(0);
    // the two whole corners and the middle: opaque, with their own colours
    expect(pixel(image, 87, 0)).toEqual([...FRAME, 255]);
    expect(pixel(image, 0, 47)).toEqual([...FRAME, 255]);
    expect(pixel(image, 44, 24)).toEqual([...GLASS, 255]);
    // the line of the cut itself stays
    expect(pixel(image, 10, 9)).toEqual([...FRAME, 255]);
    // and not one pixel of the backdrop is left opaque
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const [r, g, b, a] = pixel(image, x, y);
        if (a === 255) expect([r, g, b], `${x},${y}`).not.toEqual([...BACKDROP]);
      }
    }
  });

  it('is refused when the picture has no frame of the window', () => {
    const empty = { width: 20, height: 20, rgba: paint(20, 20, () => BACKDROP) };
    expect(() => findFrame(empty)).toThrow(/frame of the window/);
  });
});
