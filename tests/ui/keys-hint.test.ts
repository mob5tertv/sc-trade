import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { assignsMarkKey, KEYS_HINT, keysHint, withKeysHint } from '../../src/ui/vm/keys-hint';

const closedRun = { closesRun: true };
const income = { closesRun: false };
const fresh = { keysHintShown: false, hotkeyDepart: '', hotkeyArrive: '' };

describe('keysHint: the one-time hint after the first run is closed', () => {
  it('has the words of the brief', () => {
    expect(KEYS_HINT).toBe('В полёте курсора нет: назначь клавиши «Взлетел» и «Прилетел»');
  });

  it('is given when a run closes, the hint was never shown and neither mark has a key', () => {
    expect(keysHint(closedRun, fresh)).toBe(KEYS_HINT);
  });

  it('is given once: never again after it was shown', () => {
    expect(keysHint(closedRun, { ...fresh, keysHintShown: true })).toBeNull();
  });

  it('is not given when a key of either mark is assigned already', () => {
    expect(keysHint(closedRun, { ...fresh, hotkeyDepart: 'F9' })).toBeNull();
    expect(keysHint(closedRun, { ...fresh, hotkeyArrive: 'Ctrl+Alt+T' })).toBeNull();
    expect(keysHint(closedRun, { ...fresh, hotkeyDepart: 'F9', hotkeyArrive: 'F10' })).toBeNull();
  });

  it('counts a key of blanks only as no key: that is what an emptied field leaves', () => {
    expect(keysHint(closedRun, { ...fresh, hotkeyDepart: '  ', hotkeyArrive: '' })).toBe(KEYS_HINT);
  });

  it('does not care for the key of the panel: it opens the window, it marks nothing', () => {
    expect(keysHint(closedRun, { ...fresh, hotkeyPanel: 'F8' } as typeof fresh)).toBe(KEYS_HINT);
  });

  it('is not given for what is no closed run (a sale without a purchase)', () => {
    expect(keysHint(income, fresh)).toBeNull();
  });

  it('starts as "not shown" in the settings of a new installation', () => {
    expect(DEFAULT_SETTINGS.keysHintShown).toBe(false);
    expect(keysHint(closedRun, DEFAULT_SETTINGS)).toBe(KEYS_HINT);
  });
});

describe('withKeysHint: the notice line says the result first and the hint after it', () => {
  it('follows the closed run as a sentence of its own', () => {
    expect(withKeysHint('Рейс закрыт: +73 400 · 369k/ч · ROI 15%')).toBe(`Рейс закрыт: +73 400 · 369k/ч · ROI 15%. ${KEYS_HINT}`);
  });

  it('does not double a full stop that is there already', () => {
    expect(withKeysHint('Рейс закрыт: груз потерян.')).toBe(`Рейс закрыт: груз потерян. ${KEYS_HINT}`);
  });
});

describe('assignsMarkKey: a key of "Взлетел" or "Прилетел" that the player gives', () => {
  it('is true for a key written into either field: the hint is never needed then', () => {
    expect(assignsMarkKey('hotkeyDepart', 'F9')).toBe(true);
    expect(assignsMarkKey('hotkeyArrive', 'Ctrl+Alt+T')).toBe(true);
  });

  it('is false for a key that is taken off, and for blanks', () => {
    expect(assignsMarkKey('hotkeyDepart', '')).toBe(false);
    expect(assignsMarkKey('hotkeyArrive', '   ')).toBe(false);
  });

  it('is false for any other setting, the key of the panel included', () => {
    expect(assignsMarkKey('hotkeyPanel', 'F8')).toBe(false);
    expect(assignsMarkKey('opacity', 0.9)).toBe(false);
    expect(assignsMarkKey('hotkeyDepart', 9)).toBe(false);
  });
});
