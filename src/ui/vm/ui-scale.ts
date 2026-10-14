import type { Size } from '../../core/layout';
import { tr } from '../../i18n';

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

/** What the select of the field shows as chosen: the stored value when it is one of the five, «Авто» for any other (the window follows «Авто» for it). */
export function uiScaleChoice(value: number): number {
  return UI_SCALES.includes(value) ? value : UI_SCALE_AUTO;
}

/**
 * 'Авто · 125 %' for «Авто» (with what it picked), '110 %' for a percent. A stored value that is none of the five is worded as «Авто»,
 * for the window follows «Авто» for it. The field and the summary of the group «Окно» say it the same way.
 */
export function uiScaleLabel(value: number, monitor: Size | null): string {
  return uiScaleChoice(value) === UI_SCALE_AUTO ? tr('Авто · {v1} %', { v1: autoScalePct(monitor) }) : `${value} %`;
}

/** The source of a screen reading that is the primary monitor, as `boot.ts` names it. */
export const PRIMARY_MONITOR = 'primary monitor';

/**
 * What the start tells the scale about the monitor before the window is shown (`app.knowMonitor`): the size of the primary monitor in logical
 * pixels, from the reading `boot.ts` makes for the first line of the log. Only that reading is taken. The other one, the screen of the webview
 * (`screen.width` / `screen.height`), is the screen the window happens to be on, which is not the primary monitor the window layer places the
 * window on (it asks `currentMonitor` before it falls back to the screen), so it could pick a scale the first fit then undoes. `null`: nothing to
 * tell, the first placement tells it. A reading with no usable size is nothing either.
 */
export function monitorToKnow(reading: { width: number; height: number; source: string }): Size | null {
  if (reading.source !== PRIMARY_MONITOR) return null;
  if (!Number.isFinite(reading.width) || !Number.isFinite(reading.height) || !(reading.width > 0) || !(reading.height > 0)) return null;
  return { width: reading.width, height: reading.height };
}

/** What the expansion of the window (and the choice of «Авто» in the settings) does about the one-time word on the larger window: say it, only write the flag, or nothing. */
export type ScaleNoticeStep = 'show' | 'remember' | 'none';

/**
 * Once, when «Авто» has made the window larger than 100 % (version 1.1.1: at 1440p it is a quarter larger than it was, and a player who picked a narrow
 * window so that it would not be in the way should be told where to change that). `pct` is the percent the window is zoomed to now.
 *  - the flag is set already: nothing, ever;
 *  - the player chose a scale himself: he knows it, so the flag is written quietly and nothing is said (later «Авто» will not speak of a scale he used);
 *  - «Авто» keeps 100 %: nothing got larger, nothing is said and nothing is remembered (another monitor may make it larger later);
 *  - «Авто» picked more: the word.
 */
export function scaleNoticeStep(s: { uiScale: number; scaleNoticeShown: boolean }, pct: number): ScaleNoticeStep {
  if (s.scaleNoticeShown) return 'none';
  if (uiScaleChoice(s.uiScale) !== UI_SCALE_AUTO) return 'remember';
  return pct > AUTO_DEFAULT_PCT ? 'show' : 'none';
}

/** The word on the larger window, for the notice line. */
export function scaleNoticeText(pct: number): string {
  return tr('Окно стало крупнее: масштаб «Авто» выбрал {pct} %. Изменить — Настройки → Окно → Масштаб', { pct });
}

/** The tooltip of the field; for «Авто» it says what was picked and by what. */
export function uiScaleHint(value: number, monitor: Size | null): string {
  const what = tr('Размер всего окна и мини-строки.');
  if (uiScaleChoice(value) !== UI_SCALE_AUTO) return what;
  const rule = AUTO_STEPS.map((step) => tr('от {fromHeight} — {pct} %', { fromHeight: step.fromHeight, pct: step.pct })).join(', ');
  return tr('{what} «{v1}»: выбрано по высоте основного монитора с учётом масштаба Windows ({rule}, иначе {AUTO_DEFAULT_PCT} %).', { what, v1: uiScaleLabel(value, monitor), rule, AUTO_DEFAULT_PCT });
}
