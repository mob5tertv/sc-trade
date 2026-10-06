import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings';
import { parseNumberText, validateSetting } from '../../src/ui/vm/settings-validation';

const S = DEFAULT_SETTINGS;
const withKeys = (keys: Partial<Settings>): Settings => ({ ...S, ...keys });

describe('validateSetting: numbers', () => {
  it('accepts the defaults', () => {
    for (const key of Object.keys(S) as (keyof Settings)[]) {
      expect(validateSetting(key, S[key], S), key).toBeNull();
    }
  });

  it('rejects a value that is not a finite number', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(validateSetting('quantumSpeedKkms', bad, S)).not.toBeNull();
      expect(validateSetting('overheadMin', bad, S)).not.toBeNull();
      expect(validateSetting('opacity', bad, S)).not.toBeNull();
      expect(validateSetting('hotMin', bad, S)).not.toBeNull();
    }
  });

  it('keeps the number of suggestions a whole number from 1', () => {
    expect(validateSetting('topN', 0, S)).not.toBeNull();
    expect(validateSetting('topN', 2.5, S)).not.toBeNull();
    expect(validateSetting('topN', -3, S)).not.toBeNull();
    expect(validateSetting('topN', 1, S)).toBeNull();
    expect(validateSetting('topN', 12, S)).toBeNull();
  });

  it('wants a quantum speed above zero', () => {
    expect(validateSetting('quantumSpeedKkms', 0, S)).not.toBeNull();
    expect(validateSetting('quantumSpeedKkms', -5, S)).not.toBeNull();
    expect(validateSetting('quantumSpeedKkms', 0.5, S)).toBeNull();
  });

  it('allows overheads from zero', () => {
    expect(validateSetting('overheadMin', -1, S)).not.toBeNull();
    expect(validateSetting('overheadMin', 0, S)).toBeNull();
    expect(validateSetting('overheadEmptyMin', -0.5, S)).not.toBeNull();
    expect(validateSetting('overheadEmptyMin', 0, S)).toBeNull();
  });

  it('wants a refill time above zero', () => {
    expect(validateSetting('refillFullMin', 0, S)).not.toBeNull();
    expect(validateSetting('refillFullMin', -75, S)).not.toBeNull();
    expect(validateSetting('refillFullMin', 75, S)).toBeNull();
  });

  it('keeps the opacity between 0.3 and 1', () => {
    expect(validateSetting('opacity', 0.29, S)).not.toBeNull();
    expect(validateSetting('opacity', 0.3, S)).toBeNull();
    expect(validateSetting('opacity', 1, S)).toBeNull();
    expect(validateSetting('opacity', 1.01, S)).not.toBeNull();
  });

  it('keeps the panel width between 360 and 900', () => {
    expect(validateSetting('panelWidth', 359, S)).not.toBeNull();
    expect(validateSetting('panelWidth', 360, S)).toBeNull();
    expect(validateSetting('panelWidth', 900, S)).toBeNull();
    expect(validateSetting('panelWidth', 901, S)).not.toBeNull();
  });

  it('wants a whole non-negative SCU capacity', () => {
    expect(validateSetting('scuCapacity', -1, S)).not.toBeNull();
    expect(validateSetting('scuCapacity', 1.5, S)).not.toBeNull();
    expect(validateSetting('scuCapacity', 0, S)).toBeNull();
    expect(validateSetting('scuCapacity', 696, S)).toBeNull();
  });

  it('lets the budget be empty but not zero or negative', () => {
    expect(validateSetting('budget', null, S)).toBeNull();
    expect(validateSetting('budget', 1_000_000, S)).toBeNull();
    expect(validateSetting('budget', 0, S)).not.toBeNull();
    expect(validateSetting('budget', -5, S)).not.toBeNull();
    expect(validateSetting('budget', NaN, S)).not.toBeNull();
  });
});

describe('validateSetting: temperature thresholds', () => {
  it('wants positive thresholds that strictly increase', () => {
    expect(validateSetting('hotMin', 0, S)).not.toBeNull();
    expect(validateSetting('hotMin', -10, S)).not.toBeNull();
    expect(validateSetting('hotMin', 179, S)).toBeNull();
    expect(validateSetting('hotMin', 180, S)).not.toBeNull();
    expect(validateSetting('warmMin', 60, S)).not.toBeNull();
    expect(validateSetting('warmMin', 61, S)).toBeNull();
    expect(validateSetting('warmMin', 240, S)).not.toBeNull();
    expect(validateSetting('coolingMin', 180, S)).not.toBeNull();
    expect(validateSetting('coolingMin', 181, S)).toBeNull();
  });

  it('judges a threshold against the other two as they are now', () => {
    const s = withKeys({ hotMin: 10, warmMin: 20, coolingMin: 30 });
    expect(validateSetting('warmMin', 25, s)).toBeNull();
    expect(validateSetting('warmMin', 30, s)).not.toBeNull();
    expect(validateSetting('hotMin', 20, s)).not.toBeNull();
  });

  it('names the order in the message', () => {
    expect(validateSetting('warmMin', 60, S)).toMatch(/гор[яе]ч/i);
  });
});

describe('validateSetting: trigger keys', () => {
  it('refuses a key that another trigger already has', () => {
    const s = withKeys({ hotkeyPanel: 'F8' });
    expect(validateSetting('hotkeyDepart', 'F8', s)).not.toBeNull();
    expect(validateSetting('hotkeyArrive', 'F8', s)).not.toBeNull();
  });

  it('ignores case, spaces and the order of modifiers when it compares', () => {
    const s = withKeys({ hotkeyPanel: 'Ctrl+Alt+T' });
    expect(validateSetting('hotkeyDepart', 'alt + ctrl + t', s)).not.toBeNull();
    expect(validateSetting('hotkeyDepart', 'Control+Alt+T', s)).not.toBeNull();
    expect(validateSetting('hotkeyDepart', 'Ctrl+Alt+Y', s)).toBeNull();
    expect(validateSetting('hotkeyDepart', 'Ctrl+T', s)).toBeNull();
  });

  it('lets a trigger keep its own key and lets any number of them be empty', () => {
    const s = withKeys({ hotkeyPanel: 'F8' });
    expect(validateSetting('hotkeyPanel', 'F8', s)).toBeNull();
    expect(validateSetting('hotkeyDepart', '', s)).toBeNull();
    expect(validateSetting('hotkeyArrive', '   ', s)).toBeNull();
    expect(validateSetting('hotkeyPanel', '', S)).toBeNull();
  });

  it('leaves the key syntax to the keyboard layer', () => {
    expect(validateSetting('hotkeyPanel', 'Banana', S)).toBeNull();
  });
});

describe('validateSetting: choices', () => {
  it('knows the strip corners and the log levels', () => {
    expect(validateSetting('stripCorner', 'bottom-left', S)).toBeNull();
    expect(validateSetting('stripCorner', 'middle' as Settings['stripCorner'], S)).not.toBeNull();
    expect(validateSetting('logLevel', 'warn', S)).toBeNull();
    expect(validateSetting('logLevel', 'trace' as Settings['logLevel'], S)).not.toBeNull();
  });
});

describe('parseNumberText', () => {
  it('reads plain, spaced and comma numbers', () => {
    expect(parseNumberText('42')).toBe(42);
    expect(parseNumberText(' 1 500 000 ')).toBe(1_500_000);
    expect(parseNumberText('1 500')).toBe(1500);
    expect(parseNumberText('0,92')).toBe(0.92);
    expect(parseNumberText('0.5')).toBe(0.5);
    expect(parseNumberText('-3')).toBe(-3);
  });

  it('is NaN for anything else', () => {
    for (const bad of ['', '   ', 'abc', '12abc', '1,2,3', '--1', 'Infinity', '1e3']) {
      expect(parseNumberText(bad), bad).toBeNaN();
    }
  });
});
