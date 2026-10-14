import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  template?: string;
  startMenuFolder?: string;
  allowDowngrades?: boolean;
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

const themeCss = readFileSync(resolve(tauriDir, '..', 'src', 'ui', 'theme.css'), 'utf8');
/** `rrggbb` of a colour custom property of the theme of the application (`--sc-<name>: #rrggbb;`), read from src/ui/theme.css itself. */
function cssColour(name: string): string {
  const match = new RegExp(`--sc-${name}:\\s*#([0-9a-fA-F]{6})\\s*;`).exec(themeCss);
  if (!match) throw new Error(`src/ui/theme.css has no "--sc-${name}: #rrggbb;"`);
  return match[1].toLowerCase();
}

/**
 * The theme of the application, as src/ui/theme.css has it now: the installer has to wear these very colours, so the
 * tests do not keep a copy of them. `field` and `trough` are the two that the installer takes for the field of the
 * path and the list (`--sc-surface`) and for the empty part of the progress bar (`--sc-border`).
 */
const theme = {
  glass: cssColour('bg-solid'),
  text: cssColour('text'),
  muted: cssColour('muted'),
  field: cssColour('surface'),
  trough: cssColour('border'),
  accent: cssColour('accent'),
  frame: cssColour('frame'),
};

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

const installerDir = resolve(tauriDir, 'installer');
const packageVersion = (JSON.parse(readFileSync(resolve(tauriDir, '..', 'package.json'), 'utf8')) as { version: string }).version;
/** A file of src-tauri/installer with plain line ends, whatever the checkout did to them. */
const readInstaller = (name: string) => readFileSync(resolve(installerDir, name), 'utf8').replace(/\r\n/g, '\n');
/** The colours, macros and functions of the theme: the one file that the hooks include (and so does the preview script). */
const themeSource = existsSync(resolve(installerDir, 'theme.nsh')) ? readInstaller('theme.nsh') : '';

/** The code of an NSIS script, one entry per line: comments (`;`) and blank lines left out. */
function codeLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.replace(/\s*;.*$/, '').trim())
    .filter((line) => line !== '');
}

/** The first word of a line of code, after an optional label (`name:`): the NSIS command, a `${Macro}` or `plug-in::function`. */
function commandOf(line: string): string {
  return /^(?:[\w.]+:\s+)?(\S+)/.exec(line)?.[1] ?? '';
}

/**
 * What the installer scripts must never do: the commands that write, delete, register, start or restart anything, and
 * the directives that run something while the script is built. A second net behind the allow-lists of the tests below.
 */
const FORBIDDEN_COMMANDS =
  /^(File|FileOpen|FileWrite\w*|FileSeek|FileRead\w*|WriteReg\w+|DeleteReg\w+|EnumReg\w+|CreateShortCut|CreateDirectory|Delete|RMDir|Rename|CopyFiles|SetOutPath|Exec|ExecWait|ExecShell|ExecShellWait|WriteUninstaller|WriteINIStr|DeleteINI\w+|SetShellVarContext|RegDLL|UnRegDLL|nsExec::\w+|ExecDos::\w+|InstallDirRegKey|SectionSetFlags|SetRegView|Reboot|SetRebootFlag|SetFileAttributes|CallInstDLL|GetTempFileName|BringToFront|Abort|Quit)$/i;
const FORBIDDEN_DIRECTIVES = /^!(system|execute|packhdr|finalize|uninstfinalize|appendfile|delfile|tempfile|addplugindir|cd|makensis)$/i;

/** What a failing allow-list says. The template is the one file of the installer that runs with real effects on the machine of the user. */
const MAY_ONLY_PAINT =
  'the blocks of the template may only paint: colour a control, hide a line, set the title bar, name a macro of theme.nsh. ' +
  'A command that writes, deletes, registers, starts or calls anything else does not belong in them';
const MAY_ONLY_CALL =
  'the scripts of the installer may call into Windows only to paint (SetWindowTheme, DwmSetWindowAttribute; the preview also makes the ' +
  'check box of the removal page and asks the DPI of its window); a call that touches a file, the registry, a process or the system does not belong in them';

/** Every `!define NAME value` of a script, the quotes of the value stripped. */
function defines(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of codeLines(source)) {
    const match = /^!define\s+(?:\/\w+\s+)?(\w+)(?:\s+(.*))?$/.exec(line);
    if (match) found.set(match[1], (match[2] ?? '').trim().replace(/^"(.*)"$/, '$1'));
  }
  return found;
}

/** A value with its `${NAME}` references replaced by the defines of the script. */
function resolveDefines(source: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const known = defines(source);
  let result = value;
  for (let round = 0; round < 8 && /\$\{\w+\}/.test(result); round++) {
    result = result.replace(/\$\{(\w+)\}/g, (whole, name: string) => known.get(name) ?? whole);
  }
  return result;
}

/** The code lines of every `!macro NAME ... !macroend` of a script. */
function macros(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of codeLines(source)) {
    const start = /^!macro\s+(\w+)/.exec(line);
    if (start) {
      current = start[1];
      found.set(current, []);
    } else if (/^!macroend\b/.test(line)) {
      current = undefined;
    } else if (current !== undefined) {
      found.get(current)?.push(line);
    }
  }
  return found;
}

/** `rrggbb` of a colour that NSIS gets as a COLORREF number (0xBBGGRR), the form the messages of a progress bar take. */
function bgrToRgb(bgr: string): string {
  const n = parseInt(bgr, 16);
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** The lines that the marked blocks of the template add (the lines of the original that a block replaces are not among them). */
function ownLines(template: string): string[] {
  const own: string[] = [];
  let inBlock = false;
  for (const line of template.split('\n')) {
    if (inBlock) {
      if (line === '; SC TRADE THEME: end') inBlock = false;
      else if (!line.startsWith(';upstream|')) own.push(line);
    } else if (line.startsWith('; SC TRADE THEME:')) {
      inBlock = true;
    }
  }
  return own;
}

/**
 * The blocks "; SC TRADE PUBLISHER: ..." of the template, apart from the blocks of the theme: the lines they add (`own`), and
 * the template without them (`rest`). They are the ONE place where our own lines of the template do more than paint: version 1.2
 * changed the name of the publisher, the installer keeps the installed folder under a registry key named after the publisher,
 * and a version installed by the old name has to be found. What they may hold is pinned line by line (see the tests below).
 */
function publisherBlocks(template: string): { own: string[]; rest: string } {
  const own: string[] = [];
  const rest: string[] = [];
  let inBlock = false;
  for (const line of template.split('\n')) {
    if (inBlock) {
      if (line === '; SC TRADE PUBLISHER: end') inBlock = false;
      else own.push(line);
    } else if (line.startsWith('; SC TRADE PUBLISHER:')) {
      inBlock = true;
    } else {
      rest.push(line);
    }
  }
  if (inBlock) throw new Error('the last "; SC TRADE PUBLISHER:" block of the template is not closed');
  return { own, rest: rest.join('\n') };
}

/** Every `SetCtlColors hwnd text background` of the code, the colours resolved through the defines of `source`. */
function ctlColors(file: string, code: string[], source: string) {
  const found: { file: string; line: string; hwnd: string; text: string; background: string }[] = [];
  for (const line of code) {
    const match = /^SetCtlColors\s+(\S+)\s+("[^"]*"|\S+)(?:\s+("[^"]*"|\S+))?$/i.exec(line);
    if (!match) continue;
    const colour = (raw: string | undefined) => (resolveDefines(source, (raw ?? '').replace(/^"(.*)"$/, '$1')) ?? '').toLowerCase();
    found.push({ file, line, hwnd: match[1], text: colour(match[2]), background: colour(match[3]) });
  }
  return found;
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
    expect(bundle.publisher).toBe('mob5tertv');
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
  /** The value of a `!define NAME value` of the theme (the hooks include it): `#` and quotes stripped, references resolved. */
  const defined = (name: string) => resolveDefines(themeSource, defines(themeSource).get(name))?.replace(/^#/, '').toLowerCase();

  it('are optional, but when the hooks file is wired it is there', () => {
    if (hooksFile === undefined) return;
    expect(hooksFile.endsWith('.nsh')).toBe(true);
    expect(existsSync(resolve(tauriDir, hooksFile)), hooksFile).toBe(true);
  });

  it('come from the one theme file that the hooks include, so that the real installer and the preview cannot differ', () => {
    expect(hooks).toMatch(/^\s*!include\s+"\$\{__FILEDIR__\}\\theme\.nsh"\s*(?:;.*)?$/m);
    expect(themeSource, 'src-tauri/installer/theme.nsh').not.toBe('');
  });

  it('come as a pair: a background without a text colour, or the other way round, could give dark text on dark', () => {
    expect(defined('MUI_BGCOLOR'), 'MUI_BGCOLOR').toMatch(/^[0-9a-f]{6}$/);
    expect(defined('MUI_TEXTCOLOR'), 'MUI_TEXTCOLOR').toMatch(/^[0-9a-f]{6}$/);
  });

  it('read well: the text is light on the dark glass of the theme, as strong as the body text of the application', () => {
    expect(defined('MUI_BGCOLOR')).toBe(theme.glass);
    expect(defined('MUI_TEXTCOLOR')).toBe(theme.text);
    expect(contrast(defined('MUI_TEXTCOLOR') ?? '000000', defined('MUI_BGCOLOR') ?? 'ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('turn the check boxes of the finish page to classic ones, the only kind that takes the text colour', () => {
    expect(themeSource).toMatch(/^\s*!define\s+MUI_FORCECLASSICCONTROLS\s*(?:;.*)?$/m);
  });

  it('match the header picture: its edge is the same glass as the header around it', () => {
    const header = readBmp(resolve(tauriDir, nsis?.headerImage ?? 'missing'));
    expect(header.pixel(0, 0)).toBe(defined('MUI_BGCOLOR'));
  });
});

describe('the template of the installer', () => {
  const templateFile = nsis?.template;
  const whole = templateFile && existsSync(resolve(tauriDir, templateFile)) ? readFileSync(resolve(tauriDir, templateFile), 'utf8').replace(/\r\n/g, '\n') : '';
  // the blocks of the publisher (1.2) are judged by their own tests, below; everything else here is the template without them
  const { own: publisherLines, rest: template } = publisherBlocks(whole);
  const upstream = existsSync(resolve(installerDir, 'installer.upstream.nsi')) ? readInstaller('installer.upstream.nsi') : '';
  const lock = (JSON.parse(readFileSync(resolve(tauriDir, '..', 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string }> }).packages;
  /** What the template says it was made from: `; SC TRADE THEME: pin cli=<version> bundler=<version> upstream-sha256=<hash>`. */
  const pin = /^; SC TRADE THEME: pin cli=(\S+) bundler=(\S+) upstream-sha256=([0-9a-f]{64})$/m.exec(template);

  it('is set in the configuration, and it and the untouched original it was made from are in the repository', () => {
    expect(templateFile, 'bundle.windows.nsis.template').toBe('installer/installer.nsi');
    expect(template, 'src-tauri/installer/installer.nsi').not.toBe('');
    expect(upstream, 'src-tauri/installer/installer.upstream.nsi').not.toBe('');
  });

  it('is pinned to the Tauri CLI of the project: when the CLI is updated the template has to be made again', () => {
    const cli = lock['node_modules/@tauri-apps/cli']?.version;
    expect(pin, 'the "; SC TRADE THEME: pin ..." line of the template').not.toBeNull();
    expect(
      pin?.[1],
      `обновился Tauri CLI — пересобери шаблон установщика (the Tauri CLI was updated: the template was made for @tauri-apps/cli ${pin?.[1]}, package-lock.json has ${cli}; ` +
        'take installer.nsi of the tauri-bundler that the new CLI uses, put it in installer.upstream.nsi, repeat the marked edits in installer.nsi and change the pin line)',
    ).toBe(cli);
  });

  it('keeps the untouched original: the hash of installer.upstream.nsi is the one the pin line names', () => {
    expect(createHash('sha256').update(upstream).digest('hex')).toBe(pin?.[3]);
  });

  it('differs from the original only in blocks that start with "; SC TRADE THEME:" and end with "; SC TRADE THEME: end" (and in the four blocks of the publisher)', () => {
    // inside a block the lines of the original that the block replaces stay as ";upstream| <line>"; put back, they give the original
    const rebuilt: string[] = [];
    let inBlock = false;
    for (const line of template.split('\n')) {
      if (inBlock) {
        if (line === '; SC TRADE THEME: end') inBlock = false;
        else if (line.startsWith(';upstream| ')) rebuilt.push(line.slice(';upstream| '.length));
        else if (line.startsWith(';upstream|')) rebuilt.push(line.slice(';upstream|'.length));
      } else if (line.startsWith('; SC TRADE THEME:')) {
        expect(line, 'a block is closed before the next one starts').not.toBe('; SC TRADE THEME: end');
        inBlock = true;
      } else {
        rebuilt.push(line);
      }
    }
    expect(inBlock, 'the last block of the template is closed').toBe(false);
    expect(rebuilt.join('\n')).toBe(upstream);
  });

  describe('the publisher changed in 1.2: a version installed by the old name is still found', () => {
    const code = codeLines(publisherLines.join('\n'));
    const lines = whole.split('\n');
    /** The line of code that follows line `index` of the template, the comments and the markers of our blocks skipped. */
    const nextCode = (index: number): string => codeLines(lines.slice(index + 1).join('\n'))[0] ?? '';

    it('is published as mob5tertv, and names the old publisher once, as the old key of the registry', () => {
      expect(bundle.publisher).toBe('mob5tertv');
      expect(defines(whole).get('OLDMANUKEY')).toBe('Software\\mob5terdisk');
      expect(resolveDefines(whole, defines(whole).get('OLDMANUPRODUCTKEY'))).toBe('Software\\mob5terdisk\\${PRODUCTNAME}'.replace('${PRODUCTNAME}', defines(whole).get('PRODUCTNAME') ?? ''));
      expect(whole.match(/mob5terdisk/g)).toHaveLength(2);      // the comment of the block and the one define
    });

    it('adds exactly these lines and no other: the old key is read where the new one is empty, and removed once the new one is written', () => {
      const read = ['${If} $4 == ""', 'ReadRegStr $4 SHCTX "${OLDMANUPRODUCTKEY}" ""', '${EndIf}'];
      expect(code).toEqual([
        '!define OLDMANUKEY "Software\\mob5terdisk"',
        '!define OLDMANUPRODUCTKEY "${OLDMANUKEY}\\${PRODUCTNAME}"',
        // before the old version is removed: the error flag is cleared first (see the test of the flag below)
        read[0], 'ClearErrors', read[1], read[2],
        'DeleteRegKey SHCTX "${OLDMANUPRODUCTKEY}"',
        'DeleteRegKey /ifempty SHCTX "${OLDMANUKEY}"',
        ...read,
      ]);
    });

    it('reads the old key right after each read of the new one, into the same variable, and nowhere else', () => {
      const reads = lines.map((line, i) => (line.trim() === 'ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""' ? i : -1)).filter((i) => i >= 0);
      expect(reads, 'the two places where the template reads the installed folder').toHaveLength(2);
      for (const index of reads) {
        expect(lines[index + 1], 'a block of the publisher follows the read').toMatch(/^; SC TRADE PUBLISHER:/);
        expect(nextCode(index)).toBe('${If} $4 == ""');
      }
    });

    // Found by the author's own run of the candidate of 14.10.2026 over an installed 1.1.1: the old version was removed, and the
    // installer said "unable to uninstall" and went no further. `ReadRegStr` of a key that is not there sets the error flag; the
    // template clears the flag BEFORE that read and, after `ExecWait`, takes a set flag for a failure of the uninstaller.
    it('does not let the failed read of the new key pass for a failure of the old uninstaller: the error flag is cleared before the old key is read', () => {
      const all = codeLines(whole);
      const newRead = all.findIndex((line, i) => line === 'ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""' && all.slice(i, i + 12).some((next) => next.startsWith('ExecWait')));
      expect(newRead, 'the read of the installed folder before the old version is removed').toBeGreaterThan(0);
      const run = all.findIndex((line, i) => i > newRead && line.startsWith('ExecWait'));
      const between = all.slice(newRead + 1, run);
      expect(between.slice(0, 3)).toEqual(['${If} $4 == ""', 'ClearErrors', 'ReadRegStr $4 SHCTX "${OLDMANUPRODUCTKEY}" ""']);
      // and the template still reads the flag right after the uninstaller has run
      expect(all.slice(run + 1, run + 4).some((line) => line.includes('${Errors}'))).toBe(true);
    });

    it('removes the old key only after the new one is written: the folder is never left without a key', () => {
      const written = lines.findIndex((line) => line.trim() === 'WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR');
      expect(written).toBeGreaterThan(0);
      expect(nextCode(written)).toBe('DeleteRegKey SHCTX "${OLDMANUPRODUCTKEY}"');
      expect(code.filter((line) => line.startsWith('DeleteRegKey'))).toHaveLength(2);
      // nothing of ours deletes the key of the NEW publisher: the template does that itself, in its section of the removal
      expect(code.join('\n')).not.toMatch(/"\$\{MANU(?:PRODUCT)?KEY\}"/);
    });

    it('leaves the jump of RestorePreviousInstallLocation where it was: the comparison is still followed by the one line it skips', () => {
      const at = lines.findIndex((line) => line.trim() === 'StrCmp $4 "" +2 0');
      expect(at).toBeGreaterThan(0);
      expect(lines[at + 1].trim()).toBe('StrCpy $INSTDIR $4');
      expect(lines[at + 2].trim()).toBe('FunctionEnd');
    });

    it('does nothing else that has an effect: no file, no process, no other key', () => {
      const commands = new Set(code.map(commandOf));
      expect([...commands].sort()).toEqual(['!define', '${EndIf}', '${If}', 'ClearErrors', 'DeleteRegKey', 'ReadRegStr'].sort());
    });
  });

  it('puts the name and the version of the application in the corner of the window, where NSIS prints the copyright line', () => {
    expect(codeLines(template)).toContain('BrandingText "${PRODUCTNAME} ${VERSION}"');
  });

  it('never shows the page of the start menu (it has no theme): no folder is set, so the template skips the page', () => {
    expect(nsis?.startMenuFolder).toBeUndefined();
  });

  it('brings in no plug-in and no binary: the folder holds scripts and pictures, and our own code calls only System::Call', () => {
    for (const name of readdirSync(installerDir)) expect(name, 'a binary that is not a picture').not.toMatch(/\.(dll|exe|nlf)$/i);
    expect(readdirSync(installerDir)).toEqual(expect.arrayContaining(['installer.nsi', 'installer.upstream.nsi', 'theme.nsh']));
    const own = codeLines(`${themeSource}\n${ownLines(template).join('\n')}`);
    const plugins = own.map((line) => /^(\w+)::\w+/.exec(line)?.[1]).filter((name) => name !== undefined);
    for (const name of plugins) expect(name, 'a plug-in call of our own code').toBe('System');
    expect(own.join('\n')).not.toMatch(/!addplugindir|\.dll"/i);
  });

  // The template is the one file that runs with real effects on the machine of the user. What our blocks add to it may only
  // paint, so every line of code they add has to be one of the four forms below, and nothing else.
  it('adds only lines that paint: the corner text, the callbacks of the pages, the macros of theme.nsh, the handles of three controls', () => {
    const added = codeLines(ownLines(template).join('\n'));
    expect(added.length, 'lines of code that the blocks add (17 today)').toBeGreaterThan(0);
    const allowed = [
      /^BrandingText "\$\{PRODUCTNAME\} \$\{VERSION\}"$/,
      /^!define MUI_PAGE_CUSTOMFUNCTION_SHOW (?:un\.)?SCT\.\w+$/,
      /^!insertmacro SCT_(?:PAINT|FUNCTIONS)_\w+(?: (?:\$[\w.]+|""|"un\."))*$/,
      /^GetDlgItem \$[2-4] \$1 \d+$/,
    ];
    expect(
      added.filter((line) => !allowed.some((form) => form.test(line))),
      MAY_ONLY_PAINT,
    ).toEqual([]);
  });

  it('names only macros that theme.nsh defines, and the callbacks of the pages that the macros of theme.nsh make', () => {
    const defined = new Set(macros(themeSource).keys());
    const added = codeLines(ownLines(template).join('\n'));
    for (const line of added) {
      const macro = /^!insertmacro (SCT_\w+)/.exec(line)?.[1];
      if (macro !== undefined) expect(defined.has(macro), `${line}: not a macro of theme.nsh`).toBe(true);
    }
    const callbacks = added.map((line) => /^!define MUI_PAGE_CUSTOMFUNCTION_SHOW (?:un\.)?(SCT\.\w+)$/.exec(line)?.[1]).filter((name) => name !== undefined);
    const made = codeLines(themeSource).map((line) => /^Function (?:\$\{UN\})?(SCT\.\w+)$/.exec(line)?.[1]).filter((name) => name !== undefined);
    for (const callback of callbacks) expect(made, `${callback}: not made by theme.nsh`).toContain(callback);
  });

  it('replaces one line of the original only, the corner text (every other edit is an addition)', () => {
    const replaced = template.split('\n').filter((line) => line.startsWith(';upstream|'));
    expect(replaced, 'lines of the original that a block replaces; the blocks may only paint').toEqual([';upstream| BrandingText "${COPYRIGHT}"']);
  });

  it('adds no command that writes, deletes, registers, starts or restarts anything, and no call of its own into Windows (second net)', () => {
    const added = codeLines(ownLines(template).join('\n'));
    expect(added.filter((line) => FORBIDDEN_COMMANDS.test(commandOf(line)) || FORBIDDEN_DIRECTIVES.test(commandOf(line))), MAY_ONLY_PAINT).toEqual([]);
    expect(added.filter((line) => /^InstallDir\b|System::Call/i.test(line)), MAY_ONLY_PAINT).toEqual([]);
  });

  it('would turn the radio button of the question of the second installation grey if downgrades were switched off: they are not', () => {
    // with `allowDowngrades: false` the template disables the radio "do not uninstall" when an older version is installed, and
    // Windows draws the text of a disabled control grey whatever colour it is given (the paint macros cannot help)
    expect(
      nsis?.allowDowngrades,
      'bundle.windows.nsis.allowDowngrades is false: the radio button "Do not uninstall" of the "already installed" page is then disabled ' +
        'when a newer version is installed, and a disabled radio button draws grey text on the dark glass. Give it its own light text ' +
        '(a custom draw, or leave the button enabled) before turning downgrades off',
    ).not.toBe(false);
  });

  it('sets the version of package.json in the side picture of the welcome and finish pages: the one text of the picture that is the version, written by hand in the SVG', () => {
    const svg = readInstaller('sidebar.svg');
    const versions = [...svg.matchAll(/<text\b[^>]*\bid="version"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
    expect(versions, 'the <text id="version"> of src-tauri/installer/sidebar.svg: change it with every new version, then run npm run installer:images').toEqual([`v${packageVersion}`]);
    // no other text of the picture names a version number
    expect([...svg.matchAll(/>(v?\d+\.\d+\.\d+)</g)].map((match) => match[1])).toEqual([`v${packageVersion}`]);
  });

  // Version 1.3: one installer shows its pictures in both of its languages (it asks which at the start), so they hold no word of
  // either; the tagline of 1.2 was Russian and stood on the English pages too.
  it('draws no word of a language on its pictures: they are shown whichever language the installer speaks', () => {
    for (const name of ['sidebar.svg', 'header.svg']) {
      const texts = [...readInstaller(name).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1].replace(/<[^>]+>/g, ''));
      expect(texts.length, name).toBeGreaterThan(0);
      expect(texts.filter((text) => /[А-Яа-яЁё]/.test(text)), name).toEqual([]);
    }
  });

  it('draws that version so that it can be read: tall enough, light on the panel, its six signs apart from one another (the dots must not fuse with the digits)', () => {
    const sidebar = readBmp(resolve(tauriDir, nsis?.sidebarImage ?? 'missing'));
    // the corner under the chart, inside the frame of the panel (x 6..157, y 7..307); the panel is --sc-surface there
    const lit = (x: number, y: number) => parseInt(sidebar.pixel(x, y).slice(2, 4), 16) > 0x70; // the green channel: 0x1c on the panel, 0xee in the text
    const box = { left: 12, right: 112, top: 288, bottom: 305 };
    const columns: boolean[] = [];
    const rows = new Set<number>();
    for (let x = box.left; x <= box.right; x++) {
      let any = false;
      for (let y = box.top; y <= box.bottom; y++) {
        if (lit(x, y)) {
          any = true;
          rows.add(y);
        }
      }
      columns.push(any);
    }
    const first = columns.indexOf(true);
    const last = columns.lastIndexOf(true);
    const signs = columns.filter((on, i) => on && !columns[i - 1]).length; // runs of lit columns: one per sign that does not touch the next
    expect(first, 'any text at all in the corner').toBeGreaterThanOrEqual(0);
    expect(last - first + 1, 'width of the text in pixels (20 before this was fixed)').toBeGreaterThanOrEqual(32);
    expect(rows.size, 'height of the text in pixels').toBeGreaterThanOrEqual(9);
    expect(signs, 'separate signs: v 1 . 1 . 0').toBeGreaterThanOrEqual(6);
    // and the text is light on the panel, strong enough to read
    expect(contrast(theme.text, theme.field), 'the text colour of the version on the panel').toBeGreaterThanOrEqual(7);
    expect(readInstaller('sidebar.svg')).toMatch(new RegExp(`<text\\b[^>]*\\bid="version"[^>]*\\bfill="#${theme.text}"`));
  });
});

describe('the theme of the inner pages', () => {
  const template = readInstaller('installer.nsi');
  const code = { 'theme.nsh': codeLines(themeSource), 'installer.nsi': codeLines(template) };
  const everything = `${themeSource}\n${template}`;
  const colour = (name: string) => (resolveDefines(everything, `\${${name}}`) ?? '').toLowerCase();
  const calls = [...ctlColors('theme.nsh', code['theme.nsh'], everything), ...ctlColors('installer.nsi', code['installer.nsi'], everything)];

  it('takes its colours from the theme of the application, as src/ui/theme.css has them now', () => {
    expect(colour('SCT_GLASS'), '--sc-bg-solid').toBe(theme.glass);
    expect(colour('SCT_TEXT'), '--sc-text').toBe(theme.text);
    expect(colour('SCT_MUTED'), '--sc-muted').toBe(theme.muted);
    expect(colour('SCT_FIELD'), '--sc-surface').toBe(theme.field);
    expect(colour('SCT_TROUGH'), '--sc-border').toBe(theme.trough);
    expect(colour('SCT_ACCENT'), '--sc-accent').toBe(theme.accent);
    expect(colour('SCT_FRAME'), '--sc-frame').toBe(theme.frame);
    expect(colour('MUI_INSTFILESPAGE_COLORS'), 'the list of the details: text, then background').toBe(`${theme.text} ${theme.field}`);
  });

  it('writes the colours that a message takes (BBGGRR numbers) as the same colours as the RRGGBB ones', () => {
    for (const name of ['GLASS', 'TEXT', 'FRAME', 'ACCENT', 'TROUGH']) {
      expect(bgrToRgb(colour(`SCT_${name}_BGR`).replace(/^0x/, '')), `SCT_${name}_BGR`).toBe(colour(`SCT_${name}`));
    }
  });

  it('colours something: the five kinds of control (dialog, label, muted label, field, classic control) each have their call', () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every background a text colour of its own in the same call, and no background is left to the system or "transparent"', () => {
    for (const { line, text, background } of calls) {
      expect(text, line).toMatch(/^[0-9a-f]{6}$/);
      expect(background, line).toMatch(/^[0-9a-f]{6}$/);
    }
  });

  it('reads well everywhere: every text is at least 7:1 on its background, as strong as the body text of the application', () => {
    for (const { line, text, background } of calls) expect(contrast(text, background), line).toBeGreaterThanOrEqual(7);
  });

  it('reads well in the list of the progress page, too: the colours of the list are a light text on a dark background', () => {
    const [text, background] = colour('MUI_INSTFILESPAGE_COLORS').split(/\s+/);
    expect(text, 'MUI_INSTFILESPAGE_COLORS').toMatch(/^[0-9a-f]{6}$/);
    expect(background, 'MUI_INSTFILESPAGE_COLORS').toMatch(/^[0-9a-f]{6}$/);
    expect(contrast(text, background)).toBeGreaterThanOrEqual(7);
  });

  const macroNames = macros(themeSource);
  const body = (name: string) => (macroNames.get(name) ?? []).join('\n');

  it('turns the visual style of a check box, a radio button and a group box off in the macro that colours it, or the text colour does not apply', () => {
    const classic = body('SCT_PAINT_CLASSIC');
    expect(classic).toMatch(/SetWindowTheme\(p\$\{HWND\},w" ",w" "\)/);
    expect(classic).toMatch(/SetCtlColors \$\{HWND\} "\$\{SCT_TEXT\}" "\$\{SCT_GLASS\}"/);
  });

  it('turns the visual style of the progress bar off and colours the bar with the accent and the trough with the border colour', () => {
    const progress = body('SCT_PAINT_PROGRESS');
    expect(progress).toMatch(/SetWindowTheme\(p\$\{HWND\},w" ",w" "\)/);
    expect(progress).toMatch(/SendMessage \$\{HWND\} 0x0409 0 \$\{SCT_ACCENT_BGR\}/); // PBM_SETBARCOLOR
    expect(progress).toMatch(/SendMessage \$\{HWND\} 0x2001 0 \$\{SCT_TROUGH_BGR\}/); // PBM_SETBKCOLOR
  });

  it('calls only the two Windows functions that Modern UI 2 and the title bar need: SetWindowTheme and DwmSetWindowAttribute (in theme.nsh and in the blocks of the template)', () => {
    const own = codeLines(ownLines(template).join('\n'));
    const calls = [...code['theme.nsh'], ...own].filter((line) => /System::Call/i.test(line));
    const targets = calls.map((line) => /^System::Call\s+['"]([\w.]+::\w+)\(/.exec(line)?.[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(['UXTHEME::SetWindowTheme', 'dwmapi::DwmSetWindowAttribute'], MAY_ONLY_CALL).toContain(target);
  });

  /** The commands that theme.nsh uses today. A new first word is a new kind of thing the theme does: add it here on purpose, after reading what it does. */
  const THEME_COMMANDS = new Set(['!define', '!macro', '!macroend', '!insertmacro', 'Function', 'FunctionEnd', 'Push', 'Pop', 'SetCtlColors', 'SendMessage', 'ShowWindow', 'EnableWindow', 'GetDlgItem', 'StrCpy', 'System::Call'].map((word) => word.toLowerCase()));

  it('uses only the commands it uses today: it paints, and what it paints with is not a place for anything that has an effect (allow-list)', () => {
    const refused = code['theme.nsh'].filter((line) => !THEME_COMMANDS.has(commandOf(line).toLowerCase()));
    expect(refused, `a command that theme.nsh does not use yet: ${MAY_ONLY_CALL}`).toEqual([]);
  });

  it('is not given a way to run anything either: no forbidden command and no directive that runs at build time (second net)', () => {
    const words = code['theme.nsh'].map(commandOf);
    expect(words.filter((word) => FORBIDDEN_COMMANDS.test(word) || FORBIDDEN_DIRECTIVES.test(word))).toEqual([]);
  });

  it('includes nothing: no !include in theme.nsh, and the hooks file does nothing but include theme.nsh', () => {
    expect(code['theme.nsh'].filter((line) => /^!include\b/i.test(line))).toEqual([]);
    expect(codeLines(readInstaller('hooks.nsh'))).toEqual(['!include "${__FILEDIR__}\\theme.nsh"']);
  });

  /** What each page paints: the macro, the handle, as the script writes them. */
  const pages: { page: string; where: string; code: string; painted: [macro: string, handle: string][] }[] = [
    {
      page: 'outer window: the window, the corner text and its background',
      where: 'SCT_FUNCTIONS_GUIINIT',
      code: body('SCT_FUNCTIONS_GUIINIT'),
      painted: [
        ['SCT_PAINT_DIALOG', '$HWNDPARENT'],
        ['SCT_PAINT_MUTED', '$mui.Branding.Text'],
        ['SCT_PAINT_MUTED', '$mui.Branding.Background'],
      ],
    },
    {
      page: 'the question of the second installation (the reinstall page)',
      where: 'installer.nsi',
      code: codeLines(template).join('\n'),
      painted: [
        ['SCT_PAINT_DIALOG', '$R4'],
        ['SCT_PAINT_TEXT', '$R1'],
        ['SCT_PAINT_CLASSIC', '$R2'],
        ['SCT_PAINT_CLASSIC', '$R3'],
      ],
    },
    {
      page: 'folder',
      where: 'SCT_FUNCTIONS_DIRECTORY',
      code: body('SCT_FUNCTIONS_DIRECTORY'),
      painted: [
        ['SCT_PAINT_DIALOG', '$mui.DirectoryPage'],
        ['SCT_PAINT_TEXT', '$mui.DirectoryPage.Text'],
        ['SCT_PAINT_CLASSIC', '$mui.DirectoryPage.DirectoryBox'],
        ['SCT_PAINT_FIELD', '$mui.DirectoryPage.Directory'],
        ['SCT_PAINT_MUTED', '$mui.DirectoryPage.SpaceRequired'],
        ['SCT_PAINT_MUTED', '$mui.DirectoryPage.SpaceAvailable'],
      ],
    },
    {
      page: 'progress (the installer and the uninstaller)',
      where: 'SCT_FUNCTIONS_INSTFILES',
      code: body('SCT_FUNCTIONS_INSTFILES'),
      painted: [
        ['SCT_PAINT_DIALOG', '$mui.InstFilesPage'],
        ['SCT_PAINT_TEXT', '$mui.InstFilesPage.Text'],
        ['SCT_PAINT_PROGRESS', '$mui.InstFilesPage.ProgressBar'],
      ],
    },
    {
      page: 'confirm of the removal',
      where: 'SCT_PAINT_UNCONFIRM',
      code: body('SCT_PAINT_UNCONFIRM'),
      painted: [
        ['SCT_PAINT_DIALOG', '${DIALOG}'],
        ['SCT_PAINT_TEXT', '${TEXT}'],
        ['SCT_PAINT_TEXT', '${LOCATION_TEXT}'],
        ['SCT_PAINT_FIELD', '${LOCATION}'],
        ['SCT_PAINT_CLASSIC', '${DELETE_DATA}'],
      ],
    },
  ];

  it('hides the three etched lines of the window for good: two are pointed at no window, so that Modern UI 2 cannot show them again', () => {
    const init = body('SCT_FUNCTIONS_GUIINIT');
    expect(init).toContain('ShowWindow $mui.Line.Standard ${SW_HIDE}');
    expect(init).toContain('ShowWindow $mui.Line.FullWindow ${SW_HIDE}');
    // the pointing comes after the hiding: ShowWindow on 0 is a no-op, and the handle must be still good for the first two lines
    expect(init.indexOf('StrCpy $mui.Line.Standard 0')).toBeGreaterThan(init.indexOf('ShowWindow $mui.Line.Standard ${SW_HIDE}'));
    expect(init.indexOf('StrCpy $mui.Line.FullWindow 0')).toBeGreaterThan(init.indexOf('ShowWindow $mui.Line.FullWindow ${SW_HIDE}'));
    expect(init).toContain('GetDlgItem $0 $HWNDPARENT 1036'); // the line under the header: Modern UI 2 does not touch it
  });

  it('enables the corner text that lies under the other one: a disabled control draws its text grey whatever colour it has', () => {
    expect(body('SCT_FUNCTIONS_GUIINIT')).toContain('EnableWindow $mui.Branding.Background 1');
  });

  it('keeps the registers $R0-$R9 as they are: the installer carries the result of the version check in them to the first section', () => {
    const functions = ['SCT_FUNCTIONS_GUIINIT', 'SCT_FUNCTIONS_DIRECTORY', 'SCT_FUNCTIONS_INSTFILES'].map(body).join('\n');
    const macrosUsed = [...macroNames.keys()].filter((name) => name.startsWith('SCT_PAINT_') || name === 'SCT_DWM_SET').map(body).join('\n');
    expect(`${functions}\n${macrosUsed}`).not.toMatch(/\$R\d/);
  });

  it.each(pages)('paints every control of the $page ($where)', ({ code: text, painted }) => {
    expect(text, 'the code is there').not.toBe('');
    for (const [macro, handle] of painted) {
      expect(text, `!insertmacro ${macro} ${handle}`).toMatch(new RegExp(`!insertmacro ${macro} ${handle.replace(/[$.{}]/g, '\\$&')}(\\s|$)`));
    }
  });

  it('leaves no control that the template creates itself to the defaults of the system: its handle goes to a macro of the theme', () => {
    const lines = codeLines(template);
    const created: string[] = [];
    lines.forEach((line, i) => {
      const pop = /^Pop (\$\w+)$/.exec(line);
      if (!pop) return;
      const before = lines[i - 1] ?? '';
      if (/^nsDialogs::Create\b|^\$\{NSD_Create\w+\}|CreateWindowEx/.test(before)) created.push(pop[1]);
    });
    expect(created.sort(), 'the controls and dialogs of the template').toEqual(['$DeleteAppDataCheckbox', '$R1', '$R2', '$R3', '$R4']);
    const pass = lines.filter((line) => /^!insertmacro SCT_PAINT_\w+/.test(line)).join('\n');
    for (const handle of created) expect(pass, handle).toContain(handle);
  });

  it('hands the controls of the removal page to the one macro that colours them', () => {
    const lines = codeLines(template).join('\n');
    expect(lines).toMatch(/!insertmacro SCT_PAINT_UNCONFIRM \$1 \$2 \$3 \$4 \$DeleteAppDataCheckbox/);
  });

  it('colours the page of the removal while $1 still holds the page: the original puts the font in $1 a few lines below', () => {
    const lines = codeLines(template);
    const found = lines.findIndex((line) => line === 'FindWindow $1 "#32770" "" $HWNDPARENT');
    const painted = lines.findIndex((line) => /^!insertmacro SCT_PAINT_UNCONFIRM \$1 /.test(line));
    expect(found, 'FindWindow $1 in un.ConfirmShow').toBeGreaterThanOrEqual(0);
    expect(painted, 'SCT_PAINT_UNCONFIRM $1').toBeGreaterThan(found);
    // a write to $1 between the two: Pop, StrCpy, GetDlgItem ... $1 and the output (last) argument of SendMessage, or an .r1 of System::Call
    const writes = lines.slice(found + 1, painted).filter((line) => /^(StrCpy|Pop|IntOp|IntFmt|GetDlgItem|FindWindow|ReadRegStr)\s+\$1\b/.test(line) || /^SendMessage\b.*\s\$1$/.test(line) || /\.r1\b/.test(line));
    expect(writes, 'lines that replace the page in $1 before it is coloured').toEqual([]);
  });
});

describe('the pages-only preview of the installer (preview.nsi)', () => {
  const preview = existsSync(resolve(installerDir, 'preview.nsi')) ? readInstaller('preview.nsi') : '';
  const previewCode = codeLines(preview);
  /** The code of the preview and of the theme it includes: whatever runs in the preview comes from one of the two. */
  const runs = [...previewCode, ...codeLines(themeSource)];
  const command = commandOf;

  it('exists, and its first lines say in so many words that it is a mock-up and installs nothing', () => {
    expect(preview, 'src-tauri/installer/preview.nsi').not.toBe('');
    const opening = preview.split('\n').slice(0, 12).join('\n').toLowerCase();
    expect(opening).toContain('mock-up');
    expect(opening).toContain('installs nothing');
  });

  it('says next to that which pages are re-typed copies of the code of the template, and that the real ones may word things differently', () => {
    const opening = preview.split('\n').slice(0, 24).join('\n').toLowerCase().replace(/\s*\n;\s*/g, ' ');
    expect(opening).toContain('re-typed');
    expect(opening).toContain('already installed');
    expect(opening).toContain('removal');
    expect(opening).toContain('may differ');
  });

  /** The commands that preview.nsi uses today (with the functions in it). A new first word is a new thing the mock-up does: add it here on purpose, after reading what it does. */
  const PREVIEW_COMMANDS = new Set(
    [
      '!define', '!else', '!endif', '!ifdef', '!ifndef', '!include', '!insertmacro',
      'BrandingText', 'Caption', 'DetailPrint', 'InstallDir', 'LangString', 'ManifestDPIAware', 'ManifestDPIAwareness', 'Name', 'OutFile',
      'Page', 'PageCallbacks', 'PageEx', 'PageExEnd', 'RequestExecutionLevel', 'Section', 'SectionEnd', 'Sleep', 'Unicode', 'UninstallText', 'Var',
      'VIAddVersionKey', 'VIProductVersion',
      // the functions: the question of the second installation, the check box of the removal, the function that does nothing
      'Function', 'FunctionEnd', 'Nop', 'Pop', 'StrCpy', 'IntOp', 'GetDlgItem', 'FindWindow', 'SendMessage', 'System::Call',
      'nsDialogs::Create', 'nsDialogs::Show', '${NSD_CreateLabel}', '${NSD_CreateRadioButton}', '${NSD_SetFocus}',
    ].map((word) => word.toLowerCase()),
  );

  it('uses only the commands it uses today (allow-list): nothing new can be added to the mock-up without a decision', () => {
    const refused = previewCode.filter((line) => !PREVIEW_COMMANDS.has(commandOf(line).toLowerCase()));
    expect(refused, 'a command that preview.nsi does not use yet').toEqual([]);
  });

  it('includes only theme.nsh and the standard headers of NSIS that it includes today', () => {
    const included = previewCode.filter((line) => /^!include\b/i.test(line)).map((line) => line.replace(/^!include\s+"?([^"]*)"?$/i, '$1'));
    expect(included, 'what preview.nsi includes, in order').toEqual(['MUI2.nsh', 'LogicLib.nsh', 'theme.nsh']);
  });

  it('wears the very same theme as the installer: it includes theme.nsh, and adds no colour of its own', () => {
    expect(previewCode).toContain('!include "theme.nsh"');
    expect(previewCode.filter((line) => /SetCtlColors|SetWindowTheme|InstallColors|MUI_BGCOLOR|MUI_TEXTCOLOR/.test(line))).toEqual([]);
    for (const macro of ['SCT_FUNCTIONS_GUIINIT', 'SCT_FUNCTIONS_DIRECTORY', 'SCT_FUNCTIONS_INSTFILES']) expect(preview, macro).toContain(`!insertmacro ${macro}`);
  });

  it('shows the pages of the installer: welcome, the question of the second installation, folder, progress, finish', () => {
    for (const page of ['MUI_PAGE_WELCOME', 'MUI_PAGE_DIRECTORY', 'MUI_PAGE_INSTFILES', 'MUI_PAGE_FINISH']) expect(preview, page).toContain(`!insertmacro ${page}`);
    expect(previewCode.some((line) => /^Page custom /.test(line)), 'the question of the second installation').toBe(true);
    for (const handle of ['$R1', '$R2', '$R3', '$R4']) expect(previewCode.join('\n'), handle).toContain(handle);
  });

  it('shows the pages of the removal, too, in a build of its own: the real dialog of the confirmation, then the progress', () => {
    expect(previewCode).toContain('!ifdef PREVIEW_UNINSTALL');
    expect(previewCode.some((line) => /^PageEx uninstConfirm\b/.test(line))).toBe(true);
    expect(previewCode.join('\n')).toMatch(/!insertmacro SCT_PAINT_UNCONFIRM \$1 \$2 \$3 \$4 \$\w+/);
  });

  it('has no command that installs, writes, deletes, starts or registers anything', () => {
    expect(runs.filter((line) => FORBIDDEN_COMMANDS.test(command(line))), 'a forbidden command in preview.nsi or theme.nsh').toEqual([]);
    // ... and no macro that expands to one of them
    expect(runs.filter((line) => /^\$\{(?:CreateShortcut|File|Exec|Write\w+|Delete\w*|RMDir)\b/i.test(command(line)))).toEqual([]);
  });

  it('runs nothing at the time it is built: no !system, !execute, !packhdr, !finalize, !uninstfinalize, !appendfile', () => {
    expect(runs.filter((line) => FORBIDDEN_DIRECTIVES.test(command(line)))).toEqual([]);
  });

  it('calls only the Windows functions that make controls and colour them: no call that touches a file or the registry', () => {
    const targets = runs.filter((line) => /System::Call/.test(line)).map((line) => /['"]([\w.]+::\w+)\(/.exec(line)?.[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(['UXTHEME::SetWindowTheme', 'dwmapi::DwmSetWindowAttribute', 'user32::GetDpiForWindow', 'user32::CreateWindowEx'], MAY_ONLY_CALL).toContain(target);
    }
    expect(runs.filter((line) => /^(\w+)::\w+/.test(line) && !/^System::/.test(line) && !/^nsDialogs::/.test(line)), 'plug-ins other than System and nsDialogs').toEqual([]);
  });

  it('runs as the user and writes nowhere: no administrator rights, no folder to install to', () => {
    expect(previewCode).toContain('RequestExecutionLevel user');
    expect(runs.filter((line) => /^(InstallDirRegKey|WriteUninstaller|SetOutPath)\b/i.test(line))).toEqual([]);
  });

  it('has sections that only report and wait, so that the bar of the progress page moves for a few seconds', () => {
    const body: string[] = [];
    let inSection = false;
    for (const line of previewCode) {
      if (/^Section\b/.test(line)) inSection = true;
      else if (/^SectionEnd\b/.test(line)) inSection = false;
      else if (inSection) body.push(line);
    }
    expect(body.length, 'lines in sections').toBeGreaterThan(5);
    for (const line of body) expect(command(line), line).toMatch(/^(DetailPrint|Sleep)$/);
    expect(body.filter((line) => /^Sleep\b/.test(line)).length).toBeGreaterThan(3);
    const milliseconds = body.filter((line) => /^Sleep\b/.test(line)).reduce((sum, line) => sum + Number(line.split(/\s+/)[1]), 0);
    expect(milliseconds, 'the bar runs for a few seconds, not for a minute').toBeGreaterThanOrEqual(1500);
    expect(milliseconds).toBeLessThanOrEqual(6000);
  });

  it('does not start the program from the finish page: the check boxes are shown, and they call a function that does nothing', () => {
    const joined = previewCode.join('\n');
    expect(joined).toMatch(/!define MUI_FINISHPAGE_RUN_FUNCTION PreviewNothing/);
    expect(joined).toMatch(/!define MUI_FINISHPAGE_SHOWREADME_FUNCTION PreviewNothing/);
    const start = previewCode.indexOf('Function PreviewNothing');
    expect(start, 'Function PreviewNothing').toBeGreaterThanOrEqual(0);
    expect(previewCode.slice(start + 1, previewCode.indexOf('FunctionEnd', start))).toEqual(['Nop']);
  });

  it('shows the version of the application in its corner, the one of package.json', () => {
    expect(defines(preview).get('VERSION')).toBe(packageVersion);
    expect(previewCode).toContain('BrandingText "${PRODUCTNAME} ${VERSION}"');
  });

  it('uses the same pictures and the same icon as the installer', () => {
    const joined = previewCode.join('\n');
    expect(joined).toContain('!define MUI_HEADERIMAGE_BITMAP "header.bmp"');
    expect(joined).toContain('!define MUI_WELCOMEFINISHPAGE_BITMAP "sidebar.bmp"');
    expect(joined).toContain('!define MUI_ICON "..\\icons\\icon.ico"');
    // the files are the ones of tauri.conf.json
    expect(nsis?.headerImage).toBe('installer/header.bmp');
    expect(nsis?.sidebarImage).toBe('installer/sidebar.bmp');
    expect(nsis?.installerIcon).toBe('icons/icon.ico');
  });

  // Version 1.3: the installer asks for its language at the start. The list marks the language of Windows when it is one of the two,
  // and the first one, English, when it is neither: a player whose Windows is German reads English rather than Russian.
  it('offers the same two languages as the installer, English first, and the installer asks which one at the start', () => {
    const languages = previewCode.filter((line) => /^!insertmacro MUI_LANGUAGE /.test(line)).map((line) => line.replace(/^.*MUI_LANGUAGE\s+"?(\w+)"?.*$/, '$1'));
    expect(languages).toEqual(['English', 'Russian']);
    const config = nsis as unknown as { languages?: string[]; displayLanguageSelector?: boolean };
    expect(config.languages).toEqual(['English', 'Russian']);
    expect(config.displayLanguageSelector).toBe(true);
  });
});
