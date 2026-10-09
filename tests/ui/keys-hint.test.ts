import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { assignsMarkKey, carryOutKeysHint, KEYS_HINT, keysHintStep, withKeysHint } from '../../src/ui/vm/keys-hint';

// A run is closed: the result says `kind` (an error is a loss or a lost cargo), `closesRun` is false for a sale without a purchase.
const closedRun = { closesRun: true, kind: 'info' as const };
const closedAtLoss = { closesRun: true, kind: 'error' as const };
const income = { closesRun: false, kind: 'info' as const };
const fresh = { keysHintShown: false, hotkeyDepart: '', hotkeyArrive: '' };

describe('keysHintStep: what the closing of a run does about the one-time hint', () => {
  it('has the words of the brief', () => {
    expect(KEYS_HINT).toBe('В полёте курсора нет: назначь клавиши «Взлетел» и «Прилетел»');
  });

  it('shows the hint when a run closes in the expanded window, it was never shown and neither mark has a key', () => {
    expect(keysHintStep(closedRun, fresh, true)).toBe('show');
  });

  it('is given once: nothing happens after it was shown', () => {
    expect(keysHintStep(closedRun, { ...fresh, keysHintShown: true }, true)).toBe('none');
    expect(keysHintStep(closedRun, { ...fresh, keysHintShown: true, hotkeyDepart: 'F9' }, true)).toBe('none');
  });

  it('only remembers (quietly, no hint, ever) when a key of either mark is assigned already: the player knows the keys', () => {
    expect(keysHintStep(closedRun, { ...fresh, hotkeyDepart: 'F9' }, true)).toBe('remember');
    expect(keysHintStep(closedRun, { ...fresh, hotkeyArrive: 'Ctrl+Alt+T' }, true)).toBe('remember');
    expect(keysHintStep(closedRun, { ...fresh, hotkeyDepart: 'F9', hotkeyArrive: 'F10' }, true)).toBe('remember');
  });

  it('remembers the keys that are there whatever the window or the tone of the result: no hint will ever be needed', () => {
    expect(keysHintStep(closedRun, { ...fresh, hotkeyDepart: 'F9' }, false)).toBe('remember');
    expect(keysHintStep(closedAtLoss, { ...fresh, hotkeyArrive: 'F10' }, true)).toBe('remember');
  });

  it('counts a key of blanks only as no key: that is what an emptied field leaves', () => {
    expect(keysHintStep(closedRun, { ...fresh, hotkeyDepart: '  ', hotkeyArrive: '' }, true)).toBe('show');
  });

  it('does not care for the key of the panel: it opens the window, it marks nothing', () => {
    expect(keysHintStep(closedRun, { ...fresh, hotkeyPanel: 'F8' } as typeof fresh, true)).toBe('show');
  });

  it('is not attached to a result that is an error (a lost cargo, a run at a loss): no hint and nothing remembered, the next closed run may carry it', () => {
    expect(keysHintStep(closedAtLoss, fresh, true)).toBe('none');
  });

  it('is not shown where it cannot be read and pressed: with the window folded nothing is shown and nothing is remembered', () => {
    expect(keysHintStep(closedRun, fresh, false)).toBe('none');
  });

  it('does nothing for what is no closed run (a sale without a purchase), with keys or without', () => {
    expect(keysHintStep(income, fresh, true)).toBe('none');
    expect(keysHintStep(income, { ...fresh, hotkeyDepart: 'F9' }, true)).toBe('none');
  });

  it('starts as "not shown" in the settings of a new installation', () => {
    expect(DEFAULT_SETTINGS.keysHintShown).toBe(false);
    expect(keysHintStep(closedRun, DEFAULT_SETTINGS, true)).toBe('show');
  });
});

describe('carryOutKeysHint: the hint is on the screen BEFORE it is remembered', () => {
  /** The two effects of the state, writing what they do into one list, in the order they happen. */
  function effects(shows: boolean) {
    const calls: string[] = [];
    return {
      calls,
      show: () => {
        calls.push('show');
        return shows;
      },
      remember: async () => {
        calls.push('remember:start');
        await Promise.resolve();
        calls.push('remember:done');
      },
    };
  }

  it('puts the hint on the screen first and only then writes the flag', async () => {
    const e = effects(true);
    await carryOutKeysHint('show', e);
    expect(e.calls).toEqual(['show', 'remember:start', 'remember:done']);
  });

  it('writes nothing when the hint did not get on the screen (the notice was replaced, the window folded): the player keeps his one hint', async () => {
    const e = effects(false);
    await carryOutKeysHint('show', e);
    expect(e.calls).toEqual(['show']);
  });

  it('only remembers when the keys are there: nothing is shown', async () => {
    const e = effects(true);
    await carryOutKeysHint('remember', e);
    expect(e.calls).toEqual(['remember:start', 'remember:done']);
  });

  it('does nothing for "none"', async () => {
    const e = effects(true);
    await carryOutKeysHint('none', e);
    expect(e.calls).toEqual([]);
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
