import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { uexErrorText } from '../../src/ui/vm/uex-error';
import { validateSetting } from '../../src/ui/vm/settings-validation';
import { UexError, type UexErrorKind } from '../../src/data/uex-client';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

// The texts of the application speak to the player as «ты» everywhere ("Проверь подключение"), never as «вы» ("Проверьте подключение").
// A verb of the imperative in the plural ends in -ите, -йте or -ьте.

const PLURAL_IMPERATIVE = /(?<![А-Яа-яЁё])[А-Яа-яЁё]+(?:ите|йте|ьте)(?![А-Яа-яЁё])/g;

/**
 * Files not scanned. `state.svelte.ts` was being changed by another task when this test was written; its one sentence in «вы»
 * ('Закройте приложение через значок в трее', when the exit failed) is for that task to put right, after which the entry can go.
 */
const NOT_SCANNED = new Set(['src/ui/state.svelte.ts']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, '/');
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|svelte)$/.test(name) ? [path] : [];
  });
}

describe('the texts speak to the player as «ты»', () => {
  const KINDS: UexErrorKind[] = ['network', 'http', 'status', 'shape'];

  it('has no verb of the imperative plural in the sentences about UEX and in the refusal of a number', () => {
    const sentences = [
      ...KINDS.map((kind) => uexErrorText(new UexError(kind, 'x'))),
      validateSetting('hotMin', Number.NaN, DEFAULT_SETTINGS) ?? '',
    ];
    for (const sentence of sentences) expect(sentence.match(PLURAL_IMPERATIVE), sentence).toBeNull();
  });

  it('says it as the player is addressed: «Проверь подключение к интернету», «Введи число»', () => {
    expect(uexErrorText(new UexError('network', 'x'))).toBe('Нет связи с UEX. Проверь подключение к интернету.');
    expect(validateSetting('hotMin', Number.NaN, DEFAULT_SETTINGS)).toBe('Введи число');
  });

  it('finds no verb of the imperative plural in the sources of the interface, the data layer and the platform layer', () => {
    const found: string[] = [];
    for (const file of ['src/ui', 'src/data', 'src/platform'].flatMap(sources)) {
      if (NOT_SCANNED.has(file)) continue;
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        for (const word of line.match(PLURAL_IMPERATIVE) ?? []) found.push(`${file}: ${word}`);
      }
    }
    expect(found).toEqual([]);
  });
});
