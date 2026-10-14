import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The policy of the window (CSP, plan item 12): the page of the program may load nothing from an address that is not its own.
// The README says so; this test keeps it true. The policy is written in tauri.conf.json as a map of directives. What a directive
// may name is listed here, source by source: a new source fails this test until somebody decides that the promise still holds.

const root = resolve(__dirname, '..', '..');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')) as {
  app: { security: { csp: Record<string, string> | string | null; devCsp?: Record<string, string> | string | null } };
};
const { csp, devCsp } = conf.app.security;

/** The sources of every directive of a policy written as a map. */
function sources(policy: Record<string, string>): Array<{ directive: string; source: string }> {
  return Object.entries(policy).flatMap(([directive, value]) => value.split(/\s+/).filter((source) => source !== '').map((source) => ({ directive, source })));
}

/** The files of a folder and of the folders in it. */
function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesOf(path) : [path];
  });
}

/** What the page talks to the program through: the channel of Tauri, which never leaves the computer. */
const IPC = ['ipc:', 'http://ipc.localhost'];

describe('the policy of the window (CSP)', () => {
  it('is set, as a map of directives, for the program and for the development run', () => {
    expect(csp, 'app.security.csp: null would let the page load anything').not.toBeNull();
    expect(typeof csp, 'written as a map, so that this test can read every source').toBe('object');
    expect(devCsp, 'app.security.devCsp').not.toBeNull();
    expect(typeof devCsp).toBe('object');
  });

  const policy = (csp ?? {}) as Record<string, string>;

  it('lets everything come from the program itself by default, and nothing else', () => {
    expect(policy['default-src']).toBe("'self'");
  });

  it('names no address outside the computer: every source is the program, the channel to it, or a kind of data that is inside the page', () => {
    const allowed: Record<string, string[]> = {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'", ...IPC],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'none'"],
    };
    expect(Object.keys(policy).sort()).toEqual(Object.keys(allowed).sort());
    for (const { directive, source } of sources(policy)) {
      expect(allowed[directive], `${directive} ${source}`).toContain(source);
    }
  });

  it('has no star, no scheme that means "anywhere" and no host of the internet in any directive', () => {
    for (const { directive, source } of sources(policy)) {
      expect(source, directive).not.toMatch(/\*/);
      expect(source, directive).not.toMatch(/^(https?|wss?|blob|filesystem):$/);
      if (/^[a-z]+:\/\//.test(source)) expect(source, `${directive}: the one address is the channel of Tauri`).toBe('http://ipc.localhost');
    }
  });

  it('lets no script run that is not a file of the program: no inline script, no eval', () => {
    expect(policy['script-src']).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval/);
    expect(policy['default-src']).not.toMatch(/unsafe/);
  });

  it('is no weaker in the development run, except for what the development server needs on this computer', () => {
    const dev = (devCsp ?? {}) as Record<string, string>;
    expect(Object.keys(dev).sort()).toEqual(Object.keys(policy).sort());
    const extra = sources(dev).filter(({ directive, source }) => !policy[directive].split(/\s+/).includes(source));
    expect(extra).toEqual([
      { directive: 'script-src', source: "'unsafe-inline'" },        // the client of the development server
      { directive: 'connect-src', source: 'ws://localhost:1420' },   // its channel for changed files, on this computer
    ]);
  });
});

describe('the page fits its policy', () => {
  const shell = readFileSync(join(root, 'index.html'), 'utf8');
  const code = filesOf(join(root, 'src')).filter((path) => /\.(ts|svelte|css|html)$/.test(path) && !path.includes(`${join('src', 'preview')}`));

  it('has one script, a file of the program, and nothing written into the page itself', () => {
    const scripts = [...shell.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toMatch(/\bsrc="\/src\/main\.ts"/);
    expect(scripts[0][2].trim()).toBe('');
    expect(shell).not.toMatch(/\son[a-z]+\s*=/i);                      // no handler written as an attribute
  });

  it('names no address of the internet in the page, and loads no style, font or picture from one', () => {
    expect(shell).not.toMatch(/https?:\/\//);
    for (const path of code.filter((file) => /\.(css|svelte)$/.test(file))) {
      const text = readFileSync(path, 'utf8');
      expect(text, path).not.toMatch(/@import\s+(?:url\()?['"]?https?:/);
      expect(text, path).not.toMatch(/url\(\s*['"]?https?:/);
      expect(text, path).not.toMatch(/<(?:link|script|img|iframe)\b[^>]*\b(?:href|src)=["']https?:/);
    }
  });

  it('never makes code out of text: the policy has no "unsafe-eval" to allow it', () => {
    for (const path of code.filter((file) => /\.(ts|svelte)$/.test(file))) {
      const text = readFileSync(path, 'utf8');
      expect(text, path).not.toMatch(/\beval\s*\(/);
      expect(text, path).not.toMatch(/\bnew\s+Function\s*\(/);
    }
  });

  it('makes its one sound itself: no sound file is loaded, so the policy needs no source for media', () => {
    const sound = readFileSync(join(root, 'src', 'platform', 'sound.ts'), 'utf8');
    expect(sound).toMatch(/createOscillator\(\)/);
    expect(sound).not.toMatch(/new\s+Audio\s*\(|fetch\s*\(|\.mp3|\.wav|\.ogg|decodeAudioData/);
    expect((csp ?? {}) as Record<string, string>).not.toHaveProperty('media-src');
  });
});
