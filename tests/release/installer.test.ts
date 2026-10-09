import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeBmp24, encodePng } from '../../scripts/installer/encode.mjs';

const tauriDir = resolve(__dirname, '..', '..', 'src-tauri');

interface Nsis {
  installMode?: string;
  installerIcon?: string;
  uninstallerIcon?: string;
  headerImage?: string;
  sidebarImage?: string;
  installerHooks?: string;
}

interface Bundle {
  active: boolean;
  targets: string | string[];
  icon: string[];
  publisher?: string;
  shortDescription?: string;
  windows?: { nsis?: Nsis };
}

const bundle = (JSON.parse(readFileSync(resolve(tauriDir, 'tauri.conf.json'), 'utf8')) as { bundle: Bundle }).bundle;
const nsis = bundle.windows?.nsis;

/** The header of a Windows bitmap and its pixels, read the way NSIS (`LoadImage`) reads them. */
function readBmp(file: string) {
  const bytes = readFileSync(file);
  const width = bytes.readInt32LE(18);
  const height = bytes.readInt32LE(22);
  const bitsPerPixel = bytes.readUInt16LE(28);
  const dataOffset = bytes.readUInt32LE(10);
  const rowBytes = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  return {
    length: bytes.length,
    signature: bytes.toString('latin1', 0, 2),
    fileSize: bytes.readUInt32LE(2),
    dataOffset,
    headerSize: bytes.readUInt32LE(14),
    width,
    height,
    planes: bytes.readUInt16LE(26),
    bitsPerPixel,
    compression: bytes.readUInt32LE(30),
    rowBytes,
    /** `rrggbb` of the pixel `x` from the left, `y` from the TOP (a bitmap is stored bottom-up). */
    pixel(x: number, y: number): string {
      const at = dataOffset + (height - 1 - y) * rowBytes + x * 3;
      return [bytes[at + 2], bytes[at + 1], bytes[at]].map((value) => value.toString(16).padStart(2, '0')).join('');
    },
    /** How many pixels of the picture are exactly this colour (`rrggbb`). */
    count(colour: string): number {
      let n = 0;
      for (let y = 0; y < Math.abs(height); y++) for (let x = 0; x < width; x++) if (this.pixel(x, y) === colour) n++;
      return n;
    },
  };
}

/** The pictures of the installer: the field of the configuration and the size NSIS draws it at (Modern UI 2). */
const pictures = [
  { field: 'headerImage', width: 150, height: 57, what: 'the header of the pages' },
  { field: 'sidebarImage', width: 164, height: 314, what: 'the side of the welcome and finish pages' },
] as const;

/** The theme of the application (src/ui/theme.css): the glass, the frame of the window, the accent. */
const theme = { glass: '07121b', frame: '2b8fa8', accent: '3fd0f0' };

/** WCAG contrast ratio of two `rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (rrggbb: string) => {
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const channel = parseInt(rrggbb.slice(i, i + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('the installer', () => {
  it('builds NSIS only: "all" would also pull in WiX for an MSI', () => {
    expect(bundle.active).toBe(true);
    expect(bundle.targets).toEqual(['nsis']);
  });

  it('installs for the current user, so it needs no administrator rights', () => {
    expect(bundle.windows?.nsis?.installMode).toBe('currentUser');
  });

  it('says who publishes it and what it is', () => {
    expect(bundle.publisher).toBe('mob5terdisk');
    expect(bundle.shortDescription).toBeTruthy();
  });

  it('lists the icons Windows needs, and every one of them is in the repository', () => {
    expect(bundle.icon).toContain('icons/icon.ico');
    for (const icon of bundle.icon) expect(existsSync(resolve(tauriDir, icon)), icon).toBe(true);
  });

  it('gives the installer and the uninstaller the application icon, not the stock one of NSIS', () => {
    const nsis = bundle.windows?.nsis;
    expect(nsis?.installerIcon).toBe('icons/icon.ico');
    expect(nsis?.uninstallerIcon).toBe('icons/icon.ico');
    expect(existsSync(resolve(tauriDir, nsis?.installerIcon ?? 'missing'))).toBe(true);
  });

  it('keeps the source of the icon next to the generated set', () => {
    expect(existsSync(resolve(tauriDir, 'icons', 'source.svg'))).toBe(true);
  });
});

describe('the pictures of the installer', () => {
  it.each(pictures)('puts a picture of its own on $what ($field)', ({ field }) => {
    const path = nsis?.[field];
    expect(path, `bundle.windows.nsis.${field}`).toBeTruthy();
    expect(path?.endsWith('.bmp'), 'NSIS draws bitmaps only').toBe(true);
    expect(existsSync(resolve(tauriDir, path ?? 'missing')), String(path)).toBe(true);
  });

  it.each(pictures)('is a plain 24-bit bitmap of exactly $width x $height pixels for $field', ({ field, width, height }) => {
    const bmp = readBmp(resolve(tauriDir, nsis?.[field] ?? 'missing'));
    expect(bmp.signature).toBe('BM');
    expect(bmp.headerSize, 'BITMAPINFOHEADER').toBe(40);
    expect(bmp.planes).toBe(1);
    expect(bmp.bitsPerPixel).toBe(24);
    expect(bmp.compression, 'BI_RGB: not compressed').toBe(0);
    expect(bmp.width).toBe(width);
    // a positive height is a bitmap stored bottom-up, the form every loader takes
    expect(bmp.height).toBe(height);
    // rows are padded to four bytes, the pixels start right after the two headers, and nothing follows them
    expect(bmp.dataOffset).toBe(54);
    expect(bmp.length).toBe(54 + bmp.rowBytes * height);
    expect(bmp.fileSize, 'the size written in the header').toBe(bmp.length);
  });

  it.each(pictures)('is drawn in the colours of the theme: glass all around, the frame and the accent in it ($field)', ({ field }) => {
    const bmp = readBmp(resolve(tauriDir, nsis?.[field] ?? 'missing'));
    expect(bmp.pixel(0, 0), 'the corner').toBe(theme.glass);
    expect(bmp.pixel(bmp.width - 1, bmp.height - 1), 'the opposite corner').toBe(theme.glass);
    // exact pixels of the colour, not blended ones: the frame is a line, the accent the triangle of the mark and the letters
    expect(bmp.count(theme.frame), 'the frame').toBeGreaterThan(100);
    expect(bmp.count(theme.accent), 'the accent').toBeGreaterThan(40);
  });

  it.each(pictures)('keeps the SVG source of $field next to it, and the one script that makes the bitmaps from them', ({ field }) => {
    const bitmap = nsis?.[field] ?? 'missing.bmp';
    const source = resolve(tauriDir, bitmap.replace(/\.bmp$/, '.svg'));
    expect(existsSync(source), source).toBe(true);
    expect(readFileSync(source, 'utf8')).toContain('<svg');
    const scripts = (JSON.parse(readFileSync(resolve(tauriDir, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['installer:images']).toBeTruthy();
    expect(existsSync(resolve(tauriDir, '..', 'scripts', 'installer', 'build-images.mjs'))).toBe(true);
  });
});

describe('the bitmap writer of scripts/installer', () => {
  /** 3 x 2 pixels, the top row first, as a canvas gives them: red green blue / white black (10,20,30). */
  const rgba = Uint8ClampedArray.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 255, 10, 20, 30, 255,
  ]);

  it('writes the two headers, then the rows from the bottom up, blue-green-red, each padded to four bytes', () => {
    const bmp = encodeBmp24(rgba, 3, 2);
    const header = Buffer.alloc(54);
    header.write('BM', 0, 'latin1');
    header.writeUInt32LE(54 + 2 * 12, 2); // the whole file: a row of 3 pixels is 9 bytes, padded to 12
    header.writeUInt32LE(54, 10);
    header.writeUInt32LE(40, 14);
    header.writeInt32LE(3, 18);
    header.writeInt32LE(2, 22); // positive: bottom-up
    header.writeUInt16LE(1, 26);
    header.writeUInt16LE(24, 28);
    header.writeUInt32LE(0, 30); // BI_RGB
    header.writeUInt32LE(2 * 12, 34);
    const rows = Buffer.from([
      0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x1e, 0x14, 0x0a, 0, 0, 0, // the bottom row
      0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0x00, 0, 0, 0, // the top row
    ]);
    expect(Buffer.from(bmp).toString('hex')).toBe(Buffer.concat([header, rows]).toString('hex'));
  });

  it('pads a row only as far as the next multiple of four bytes', () => {
    for (const [width, stride] of [[1, 4], [2, 8], [3, 12], [4, 12], [5, 16], [8, 24]] as const) {
      const bmp = encodeBmp24(new Uint8ClampedArray(width * 2 * 4).fill(255), width, 2);
      expect(bmp.length, `${width} pixels wide`).toBe(54 + 2 * stride);
    }
  });

  it('refuses a picture with a see-through pixel: a bitmap has none, the picture must be painted opaque first', () => {
    expect(() => encodeBmp24(Uint8ClampedArray.from([1, 2, 3, 254]), 1, 1)).toThrow(/opaque/);
  });

  it('refuses pixels that do not fit the size', () => {
    expect(() => encodeBmp24(rgba, 2, 2)).toThrow(/2 x 2/);
  });

  it('writes a PNG for looking at a picture: the same pixels, top row first', () => {
    const png = Buffer.from(encodePng(rgba, 3, 2));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.toString('latin1', 12, 16)).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([3, 2, 8, 6]); // 8 bits, RGBA
    // IDAT: 4-byte length, 'IDAT', data, crc; the data holds a filter byte (0: none) before each row
    const length = png.readUInt32BE(33);
    expect(png.toString('latin1', 37, 41)).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + length));
    expect([...raw]).toEqual([0, ...rgba.subarray(0, 12), 0, ...rgba.subarray(12)]);
    expect(png.toString('latin1', png.length - 8, png.length - 4)).toBe('IEND');
  });
});

describe('the colours of the welcome and finish pages', () => {
  const hooksFile = nsis?.installerHooks;
  const hooks = hooksFile ? readFileSync(resolve(tauriDir, hooksFile), 'utf8') : undefined;
  /** The value of a `!define NAME value` of the hooks file, without quotes and `#`. */
  const defined = (name: string) => hooks?.match(new RegExp(`^\\s*!define\\s+${name}\\s+"?#?([0-9A-Fa-f]{6})"?\\s*(?:;.*)?$`, 'm'))?.[1]?.toLowerCase();

  it('are optional, but when the hooks file is wired it is there', () => {
    if (hooksFile === undefined) return;
    expect(hooksFile.endsWith('.nsh')).toBe(true);
    expect(existsSync(resolve(tauriDir, hooksFile)), hooksFile).toBe(true);
  });

  it('come as a pair: a background without a text colour, or the other way round, could give dark text on dark', () => {
    if (hooks === undefined) return;
    expect(defined('MUI_BGCOLOR'), 'MUI_BGCOLOR').toBeTruthy();
    expect(defined('MUI_TEXTCOLOR'), 'MUI_TEXTCOLOR').toBeTruthy();
  });

  it('read well: the text is light on the dark glass of the theme, as strong as the body text of the application', () => {
    if (hooks === undefined) return;
    expect(defined('MUI_BGCOLOR')).toBe(theme.glass);
    expect(contrast(defined('MUI_TEXTCOLOR') ?? '000000', defined('MUI_BGCOLOR') ?? 'ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('turn the check boxes of the finish page to classic ones, the only kind that takes the text colour', () => {
    if (hooks === undefined) return;
    expect(hooks).toMatch(/^\s*!define\s+MUI_FORCECLASSICCONTROLS\s*(?:;.*)?$/m);
  });

  it('match the header picture: its edge is the same glass as the header around it', () => {
    if (hooks === undefined) return;
    const header = readBmp(resolve(tauriDir, nsis?.headerImage ?? 'missing'));
    expect(header.pixel(0, 0)).toBe(defined('MUI_BGCOLOR'));
  });
});
