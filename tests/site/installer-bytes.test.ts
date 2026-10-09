import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { build, fakeInstaller, tempDir, version } from './helpers';

// The installer on the disk may change between the moment the build reads it for the sum and a later moment (the
// application being built again, a copy still running). The file the site hands out must be the very bytes the sum
// on the page was made of. Here every read of the installer after the first one, and every copy of it, sees a file
// that has changed.
const state = vi.hoisted(() => ({ installer: '', reads: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const changed = (bytes: Buffer) => Buffer.concat([bytes, Buffer.from(' — changed since it was read')]);
  const readFileSync = (file: unknown, ...rest: unknown[]) => {
    const content = (real.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
    if (file === state.installer && Buffer.isBuffer(content) && ++state.reads > 1) return changed(content);
    return content;
  };
  const copyFileSync = (from: unknown, to: unknown, ...rest: unknown[]) => {
    if (from === state.installer) return real.writeFileSync(String(to), changed(real.readFileSync(String(from))));
    return (real.copyFileSync as (...args: unknown[]) => void)(from, to, ...rest);
  };
  return { ...real, default: { ...real, readFileSync, copyFileSync }, readFileSync, copyFileSync };
});

describe('the installer the site hands out', () => {
  it('is the very bytes its sum was made of, even when the file on the disk changes while the site is built', async () => {
    const installer = fakeInstaller(tempDir());
    state.installer = installer;
    state.reads = 0;

    const site = build({ installer });
    const name = `SC-Trade-${version}-setup.exe`;
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
    const handedOut = readFileSync(join(site.out, 'download', name));
    const sum = createHash('sha256').update(handedOut).digest('hex');

    expect(site.read('download/SHA256SUMS.txt')).toBe(`${sum}  ${name}\n`);
    expect(site.read('index.html')).toContain(sum);
    expect(site.result.installer?.sha256).toBe(sum);
    expect(site.result.installer?.size).toBe(handedOut.length);
    expect(state.reads).toBe(1);
  });
});
