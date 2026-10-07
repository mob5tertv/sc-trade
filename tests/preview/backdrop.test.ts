import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findBackdrop } from '../../scripts/preview/backdrop';

const made: string[] = [];

function folderWith(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-backdrop-'));
  made.push(dir);
  for (const name of names) writeFileSync(join(dir, name), '');
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('findBackdrop', () => {
  it('takes the first PNG of Screenshot/ in the project root', () => {
    const root = folderWith();
    const shots = join(root, 'Screenshot');
    mkdirSync(shots);
    for (const name of ['b.png', 'a.PNG', 'notes.txt', 'c.jpg']) writeFileSync(join(shots, name), '');
    expect(findBackdrop(root, {})).toBe(join(shots, 'a.PNG'));
  });

  it('takes the folder of PREVIEW_BACKDROP_DIR instead when it is set', () => {
    const root = folderWith();
    mkdirSync(join(root, 'Screenshot'));
    writeFileSync(join(root, 'Screenshot', 'mine.png'), '');
    const other = folderWith('other.png');
    expect(findBackdrop(root, { PREVIEW_BACKDROP_DIR: other })).toBe(join(other, 'other.png'));
  });

  it('is null when there is no folder, or no PNG in it', () => {
    expect(findBackdrop(folderWith(), {})).toBeNull();
    expect(findBackdrop(folderWith(), { PREVIEW_BACKDROP_DIR: folderWith('readme.txt') })).toBeNull();
    expect(findBackdrop(folderWith(), { PREVIEW_BACKDROP_DIR: join(tmpdir(), 'sc-no-such-folder-xyz') })).toBeNull();
  });
});
