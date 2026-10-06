import { describe, expect, it } from 'vitest';
import { UexError, type UexErrorKind } from '../../src/data/uex-client';
import { uexErrorText } from '../../src/ui/vm/uex-error';

const KINDS: UexErrorKind[] = ['network', 'http', 'status', 'shape'];

describe('uexErrorText', () => {
  it('gives every kind of UEX error its own Russian sentence', () => {
    const texts = KINDS.map((kind) => uexErrorText(new UexError(kind, 'x')));
    for (const text of texts) expect(text).toMatch(/[А-Яа-я]/);
    expect(new Set(texts).size).toBe(KINDS.length);
  });

  it('names the connection for a network failure', () => {
    expect(uexErrorText(new UexError('network', 'x'))).toMatch(/связи/);
  });

  it('never shows the raw error message', () => {
    const secret = 'request failed: TypeError at https://api.uexcorp.uk/2.0/star_systems';
    for (const kind of KINDS) {
      expect(uexErrorText(new UexError(kind, secret))).not.toContain('uexcorp');
      expect(uexErrorText(new UexError(kind, secret))).not.toContain('TypeError');
    }
    expect(uexErrorText(new Error(secret))).not.toContain('uexcorp');
    expect(uexErrorText(secret)).not.toContain('uexcorp');
  });

  it('has a Russian sentence for an error that is not a UEX error', () => {
    expect(uexErrorText(new Error('SQLITE_BUSY'))).toMatch(/[А-Яа-я]/);
    expect(uexErrorText(undefined)).toMatch(/[А-Яа-я]/);
  });
});
