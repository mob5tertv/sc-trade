import type { Size } from '../../core/layout';

// The scale of the whole window (the setting `uiScale`): the values the player can pick, what «Авто» picks, and the words
// of the field. The scale is a zoom of the root of the interface (`App.svelte`); nothing here touches the DOM.

/** The stored value of «Авто»: the scale is picked by the height of the primary monitor. */
export const UI_SCALE_AUTO = 0;

/** What the field offers, in this order: «Авто», then the percents. */
export const UI_SCALES: readonly number[] = [UI_SCALE_AUTO, 100, 110, 125, 150];

const PERCENTS = UI_SCALES.filter((value) => value !== UI_SCALE_AUTO);

/** «Авто» picks 150 % from this logical height of the monitor, 125 % from the next one, 100 % below it. */
const AUTO_STEPS: ReadonlyArray<{ fromHeight: number; pct: number }> = [
  { fromHeight: 2160, pct: 150 },
  { fromHeight: 1440, pct: 125 },
];
const AUTO_DEFAULT_PCT = 100;

/**
 * What «Авто» picks for a monitor, from its LOGICAL height (the physical height divided by the scale of Windows, which is
 * what the window layer knows of the monitor): 150 % from 2160, 125 % from 1440, 100 % below. A monitor of 2160 physical
 * pixels at the Windows scale 150 % is 1440 logical: 125 %. 100 % while the geometry of the monitor is not known (`null`) or
 * has no usable height. The height is rounded first: a division like 2160 / 1.5 may come out a hair under the whole number.
 */
export function autoScalePct(monitor: Size | null): number {
  if (monitor === null || !Number.isFinite(monitor.height)) return AUTO_DEFAULT_PCT;
  const height = Math.round(monitor.height);
  return AUTO_STEPS.find((step) => height >= step.fromHeight)?.pct ?? AUTO_DEFAULT_PCT;
}

/** The percent the window is really zoomed to: the chosen one, or for «Авто» (and for a value that is none of the five) the picked one. */
export function effectiveScalePct(setting: number, monitor: Size | null): number {
  return PERCENTS.includes(setting) ? setting : autoScalePct(monitor);
}

/** The percent as the factor of the CSS zoom. */
export const scaleFactor = (pct: number): number => pct / 100;

/** 'Авто · 125 %' for «Авто» (with what it picked), '110 %' for a percent. The field and the summary of the group «Окно» say it the same way. */
export function uiScaleLabel(value: number, monitor: Size | null): string {
  return value === UI_SCALE_AUTO ? `Авто · ${autoScalePct(monitor)} %` : `${value} %`;
}

/** The tooltip of the field; for «Авто» it says what was picked and by what. */
export function uiScaleHint(value: number, monitor: Size | null): string {
  const what = 'Размер всего окна и мини-строки.';
  if (value !== UI_SCALE_AUTO) return what;
  const rule = AUTO_STEPS.map((step) => `от ${step.fromHeight} — ${step.pct} %`).join(', ');
  return `${what} «${uiScaleLabel(value, monitor)}»: выбрано по высоте основного монитора с учётом масштаба Windows (${rule}, иначе ${AUTO_DEFAULT_PCT} %).`;
}
