import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll } from 'vitest';
import { buildSite, type BuildOptions } from '../../scripts/site/build.mjs';

export const projectRoot = resolve(__dirname, '..', '..');
export const version = (JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string }).version;

/** The day every test build is made on. */
export const BUILD_DAY = new Date('2026-10-09T12:00:00Z');

const made: string[] = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder of its own for a test; removed when the tests of the file are over. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-trade-site-'));
  made.push(dir);
  return dir;
}

/** A file that stands in for the installer: the name Tauri gives it, bytes that are known. */
export function fakeInstaller(dir: string, name = `SC Trade_${version}_x64-setup.exe`): string {
  const file = join(dir, name);
  writeFileSync(file, Buffer.from('this is not an installer, it only stands in for one\n'.repeat(4000)));
  return file;
}

/** Every file under a folder, as paths with forward slashes, sorted. */
export function listFiles(dir: string): string[] {
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? walk(path) : [relative(dir, path).replaceAll('\\', '/')];
    });
  return walk(dir).sort();
}

export interface Built {
  out: string;
  deploy: string;
  result: ReturnType<typeof buildSite>;
  /** The text of a file of dist. */
  read: (file: string) => string;
  files: string[];
  caddyfile: string;
}

/** Builds the site into a folder of its own. Without `installer` in the options a stand-in installer is made. */
export function build(options: Partial<BuildOptions> = {}): Built {
  const dir = tempDir();
  const out = join(dir, 'dist');
  const deploy = join(dir, 'dist-deploy');
  const installer = options.installer === undefined ? fakeInstaller(dir) : options.installer;
  const result = buildSite({ version, now: BUILD_DAY, ...options, outDir: out, deployDir: deploy, installer });
  return {
    out,
    deploy,
    result,
    read: (file) => readFileSync(join(out, file), 'utf8'),
    files: listFiles(out),
    caddyfile: readFileSync(join(deploy, 'Caddyfile'), 'utf8'),
  };
}

/** The files of a build a person or a browser reads as text. */
export const isText = (file: string): boolean => /\.(html|css|js|json|txt|xml|svg)$/.test(file) || file === 'Caddyfile';

/** The value of every attribute of the HTML that names another file or address. */
export function references(html: string): Array<{ attribute: string; value: string }> {
  const found: Array<{ attribute: string; value: string }> = [];
  for (const match of html.matchAll(/\s(href|src|poster|action|srcset|data-full)="([^"]*)"/g)) {
    const values = match[1] === 'srcset' ? match[2].split(',').map((part) => part.trim().split(/\s+/)[0]) : [match[2]];
    for (const value of values) found.push({ attribute: match[1], value: value.replaceAll('&amp;', '&') });
  }
  return found;
}

/** The addresses with a scheme (or `//host`) in a text. */
export function addresses(text: string): string[] {
  return [...text.matchAll(/(?:https?:)?\/\/[A-Za-z0-9%{][^\s"'<>)\\]*/g)]
    .filter((match) => {
      // `//` after a letter, a digit or a slash is a path or a comment, not an address without a scheme
      const before = text[match.index - 1] ?? ' ';
      return match[0].startsWith('http') || /["'(=\s]/.test(before);
    })
    .map((match) => match[0]);
}
