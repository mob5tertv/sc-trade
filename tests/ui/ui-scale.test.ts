import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { createLogger, memorySink } from '../../src/data/logger';
import { loadSettings, saveSetting } from '../../src/data/repo/settings';
import { logicalSize, parseMonitor } from '../../src/preview/monitor';
import { affectsLookup } from '../../src/ui/vm/lookup';
import { validateSetting } from '../../src/ui/vm/settings-validation';
import {
  autoScalePct, effectiveScalePct, scaleFactor, UI_SCALE_AUTO, UI_SCALES, uiScaleHint, uiScaleLabel,
} from '../../src/ui/vm/ui-scale';
import { migratedDb } from '../helpers/test-db';

const monitor = (height: number, width = 2560) => ({ width, height });
/** The monitor the way the window layer knows it: physical pixels divided by the scale of Windows. */
const logicalOf = (spec: string) => logicalSize(parseMonitor(spec));

describe('the values of the scale', () => {
  it('are «Авто» (stored as 0) and 100, 110, 125, 150 percent; «Авто» is the default', () => {
    expect(UI_SCALE_AUTO).toBe(0);
    expect(UI_SCALES).toEqual([0, 100, 110, 125, 150]);
    expect(DEFAULT_SETTINGS.uiScale).toBe(UI_SCALE_AUTO);
  });
});

describe('autoScalePct: «Авто» goes by the LOGICAL height of the primary monitor', () => {
  it('is 100 % below 1440', () => {
    expect(autoScalePct(monitor(1080, 1920))).toBe(100);
    expect(autoScalePct(monitor(1200, 1920))).toBe(100);
    expect(autoScalePct(monitor(1439))).toBe(100);
    expect(autoScalePct(monitor(768, 1366))).toBe(100);
  });

  it('is 125 % from 1440 up to 2159', () => {
    expect(autoScalePct(monitor(1440))).toBe(125);
    expect(autoScalePct(monitor(1600))).toBe(125);
    expect(autoScalePct(monitor(2159))).toBe(125);
  });

  it('is 150 % from 2160', () => {
    expect(autoScalePct(monitor(2160, 3840))).toBe(150);
    expect(autoScalePct(monitor(2880, 5120))).toBe(150);
  });

  it('takes a monitor of 2160 physical pixels at the Windows scale 150 % for logical 1440: 125 %', () => {
    expect(logicalOf('3840x2160@1.5').height).toBe(1440);
    expect(autoScalePct(logicalOf('3840x2160@1.5'))).toBe(125);
    expect(autoScalePct(logicalOf('3840x2160@1'))).toBe(150);
    expect(autoScalePct(logicalOf('2560x1440@1'))).toBe(125);
    expect(autoScalePct(logicalOf('2560x1440@1.5'))).toBe(100); // logical 960
    expect(autoScalePct(logicalOf('1920x1080@1'))).toBe(100);
  });

  it('does not mind the noise of a division: 1439.9999999 is 1440', () => {
    expect(autoScalePct(monitor(1439.9999999))).toBe(125);
    expect(autoScalePct(monitor(2159.9999999))).toBe(150);
    expect(autoScalePct(monitor(1439.4))).toBe(100);
  });

  it('is 100 % while the geometry of the monitor is not known', () => {
    expect(autoScalePct(null)).toBe(100);
  });

  it('is 100 % for a monitor without a usable height', () => {
    expect(autoScalePct(monitor(0))).toBe(100);
    expect(autoScalePct(monitor(NaN))).toBe(100);
  });
});

describe('effectiveScalePct: what the window is really zoomed to', () => {
  it('is what the player chose when he chose a percent, whatever the monitor', () => {
    for (const pct of [100, 110, 125, 150]) {
      expect(effectiveScalePct(pct, monitor(1080, 1920))).toBe(pct);
      expect(effectiveScalePct(pct, monitor(2160, 3840))).toBe(pct);
      expect(effectiveScalePct(pct, null)).toBe(pct);
    }
  });

  it('follows the monitor for «Авто»', () => {
    expect(effectiveScalePct(UI_SCALE_AUTO, monitor(1080, 1920))).toBe(100);
    expect(effectiveScalePct(UI_SCALE_AUTO, monitor(1440))).toBe(125);
    expect(effectiveScalePct(UI_SCALE_AUTO, monitor(2160, 3840))).toBe(150);
    expect(effectiveScalePct(UI_SCALE_AUTO, null)).toBe(100);
  });

  it('reads a value that is not one of the five as «Авто» (a database edited by hand)', () => {
    expect(effectiveScalePct(133, monitor(1440))).toBe(125);
    expect(effectiveScalePct(-10, monitor(1080, 1920))).toBe(100);
    expect(effectiveScalePct(NaN, monitor(2160, 3840))).toBe(150);
  });
});

describe('scaleFactor', () => {
  it('is the percent as a factor of the zoom', () => {
    expect(scaleFactor(100)).toBe(1);
    expect(scaleFactor(110)).toBe(1.1);
    expect(scaleFactor(125)).toBe(1.25);
    expect(scaleFactor(150)).toBe(1.5);
  });
});

describe('the words of the field', () => {
  it('names a percent as it is, and «Авто» together with what it chose', () => {
    expect(uiScaleLabel(100, monitor(1440))).toBe('100 %');
    expect(uiScaleLabel(110, null)).toBe('110 %');
    expect(uiScaleLabel(125, monitor(1080, 1920))).toBe('125 %');
    expect(uiScaleLabel(150, monitor(1080, 1920))).toBe('150 %');
    expect(uiScaleLabel(UI_SCALE_AUTO, monitor(1440))).toBe('Авто · 125 %');
    expect(uiScaleLabel(UI_SCALE_AUTO, monitor(1080, 1920))).toBe('Авто · 100 %');
    expect(uiScaleLabel(UI_SCALE_AUTO, logicalOf('3840x2160@1'))).toBe('Авто · 150 %');
    expect(uiScaleLabel(UI_SCALE_AUTO, null)).toBe('Авто · 100 %');
  });

  it('says «Авто · 125 %» for a monitor of 2160 physical pixels at the Windows scale 150 % (logical 1440)', () => {
    expect(uiScaleLabel(UI_SCALE_AUTO, logicalOf('3840x2160@1.5'))).toBe('Авто · 125 %');
    expect(uiScaleLabel(110, logicalOf('3840x2160@1.5'))).toBe('110 %');
  });

  it('the hint says what the field is, and for «Авто» what it chose and by what rule', () => {
    expect(uiScaleHint(125, monitor(1440))).toBe('Размер всего окна и мини-строки.');
    const hint = uiScaleHint(UI_SCALE_AUTO, monitor(1440));
    expect(hint.startsWith('Размер всего окна и мини-строки.')).toBe(true);
    expect(hint).toContain('Авто · 125 %');
    expect(hint).toContain('от 2160 — 150 %');
    expect(hint).toContain('от 1440 — 125 %');
    expect(hint).toContain('иначе 100 %');
  });
});

describe('the setting uiScale', () => {
  const S = DEFAULT_SETTINGS;

  it('accepts «Авто» and the four percents', () => {
    for (const value of [0, 100, 110, 125, 150]) expect(validateSetting('uiScale', value, S), String(value)).toBeNull();
  });

  it('refuses any other number, and what is not a number', () => {
    for (const value of [-100, 1, 50, 90, 105, 120, 175, 200, 125.5, NaN, Infinity]) {
      expect(validateSetting('uiScale', value, S), String(value)).not.toBeNull();
    }
    expect(validateSetting('uiScale', '125' as unknown as number, S)).not.toBeNull();
    expect(validateSetting('uiScale', null as unknown as number, S)).not.toBeNull();
  });

  it('says in the sentence for the field which values there are', () => {
    expect(validateSetting('uiScale', 90, S)).toBe('Авто, 100, 110, 125 или 150 %');
  });

  it('does not restart the lookup on screen: it only looks', () => {
    expect(affectsLookup('uiScale', 'from')).toBe(false);
    expect(affectsLookup('uiScale', 'to')).toBe(false);
  });

  it('is saved like any other setting: a fresh database holds «Авто», a chosen percent is read back', async () => {
    const db = await migratedDb();
    const log = createLogger(memorySink());
    expect((await loadSettings(db, log)).uiScale).toBe(0);
    await saveSetting(db, log, 'uiScale', 125);
    expect((await loadSettings(db, log)).uiScale).toBe(125);
    await saveSetting(db, log, 'uiScale', 0);
    expect((await loadSettings(db, log)).uiScale).toBe(0);
  });
});
