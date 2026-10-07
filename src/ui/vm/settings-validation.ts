import type { Settings } from '../../core/settings';

// Checks a setting before it is saved. The answer is a short Russian sentence for the field, or null
// when the value is fine. Numbers typed by the player arrive through `parseNumberText`.

const CORNERS: ReadonlyArray<Settings['stripCorner']> = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const LOG_LEVELS: ReadonlyArray<Settings['logLevel']> = ['debug', 'info', 'warn', 'error'];
const SORTS: ReadonlyArray<Settings['sort']> = ['uecPerHour', 'roi'];

// Below 0.5 the text cannot be read over a bright scene. A value saved earlier below it is read as it is and is
// replaced by the first change the player makes.
const OPACITY_RANGE = { min: 0.5, max: 1 };
const PANEL_WIDTH_RANGE = { min: 380, max: 640 };
// Whole percent of ROI; 0 marks every row that pays at all
const ROI_HIGHLIGHT_RANGE = { min: 0, max: 500 };

const NOT_A_NUMBER = 'Введите число';
const THRESHOLD_ORDER = 'Пороги должны быть больше нуля и расти: горячая < тёплая < остывает';

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Reads a number the player typed: spaces and non-breaking spaces are grouping noise, a comma is
 * the decimal separator. `NaN` for anything that is not a plain number (an empty text included).
 */
export function parseNumberText(text: string): number {
  const compact = text.replace(/[\s ]/g, '').replace(',', '.');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(compact) ? Number(compact) : NaN;
}

/** 'Ctrl+Alt+T' written in any case, spacing and order of modifiers → one comparable text; '' for no key. */
function normalizeKey(text: string): string {
  const parts = text.split('+').map((p) => p.trim().toLowerCase()).filter((p) => p !== '');
  if (parts.length === 0) return '';
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map((m) => (m === 'control' ? 'ctrl' : m)).sort();
  return [...modifiers, key].join('+');
}

const TRIGGER_KEYS = ['hotkeyPanel', 'hotkeyDepart', 'hotkeyArrive'] as const;

function validateThresholds(next: Settings): string | null {
  const { hotMin, warmMin, coolingMin } = next;
  return hotMin > 0 && warmMin > hotMin && coolingMin > warmMin ? null : THRESHOLD_ORDER;
}

/** `value` is what the field would hold; `current` the settings as they are now (the other fields of a rule come from it). */
export function validateSetting<K extends keyof Settings>(key: K, value: Settings[K], current: Settings): string | null {
  const v: unknown = value;
  switch (key) {
    case 'hotMin':
    case 'warmMin':
    case 'coolingMin':
      if (!isNumber(v)) return NOT_A_NUMBER;
      return validateThresholds({ ...current, [key]: v });

    case 'topN':
      return isNumber(v) && Number.isInteger(v) && v >= 1 ? null : 'Целое число не меньше 1';
    case 'roiHighlightPct':
      return isNumber(v) && Number.isInteger(v) && v >= ROI_HIGHLIGHT_RANGE.min && v <= ROI_HIGHLIGHT_RANGE.max
        ? null
        : `Целое число от ${ROI_HIGHLIGHT_RANGE.min} до ${ROI_HIGHLIGHT_RANGE.max}`;
    case 'quantumSpeedKkms':
      return isNumber(v) && v > 0 ? null : 'Число больше нуля';
    case 'overheadMin':
    case 'overheadEmptyMin':
      return isNumber(v) && v >= 0 ? null : 'Число не меньше нуля';
    case 'refillFullMin':
      return isNumber(v) && v > 0 ? null : 'Число минут больше нуля';
    case 'opacity':
      return isNumber(v) && v >= OPACITY_RANGE.min && v <= OPACITY_RANGE.max ? null : 'От 0,5 до 1';
    case 'panelWidth':
      return isNumber(v) && v >= PANEL_WIDTH_RANGE.min && v <= PANEL_WIDTH_RANGE.max
        ? null
        : `От ${PANEL_WIDTH_RANGE.min} до ${PANEL_WIDTH_RANGE.max} пикселей`;
    // an offset that would push the window off the monitor is not refused: the window layer cuts it when it places the window
    case 'windowDx':
    case 'windowDy':
      return isNumber(v) && Number.isInteger(v) && v >= 0 ? null : 'Целое число пикселей, от нуля';
    case 'idleCollapseSec':
      return isNumber(v) && Number.isInteger(v) && v >= 0 ? null : 'Целое число секунд, 0 — не сворачивать';
    case 'openSections':
      return typeof v === 'string' ? null : 'Нужен текст';
    case 'scuCapacity':
      return isNumber(v) && Number.isInteger(v) && v >= 0 ? null : 'Целое число SCU, от нуля';
    case 'budget':
      return v === null || (isNumber(v) && v > 0) ? null : 'Число больше нуля или пустое поле';

    case 'hotkeyPanel':
    case 'hotkeyDepart':
    case 'hotkeyArrive': {
      if (typeof v !== 'string') return 'Клавиша — это текст';
      const wanted = normalizeKey(v);
      if (wanted === '') return null;
      const taken = TRIGGER_KEYS.some((other) => other !== key && normalizeKey(current[other]) === wanted);
      return taken ? 'Эта клавиша уже назначена другому действию' : null;
    }

    case 'stripCorner':
      return CORNERS.includes(v as Settings['stripCorner']) ? null : 'Неизвестный угол';
    case 'logLevel':
      return LOG_LEVELS.includes(v as Settings['logLevel']) ? null : 'Неизвестный уровень';
    case 'sort':
      return SORTS.includes(v as Settings['sort']) ? null : 'Неизвестная сортировка';
    case 'nearby':
    case 'showStrip':
    case 'windowLocked':
      return typeof v === 'boolean' ? null : 'Нужно да или нет';

    case 'vehicleId':
    case 'starSystemId':
    case 'serverChangedAt':
    case 'currentTerminalId':
    case 'targetTerminalId':
      return v === null || isNumber(v) ? null : NOT_A_NUMBER;
  }
  return null;
}
