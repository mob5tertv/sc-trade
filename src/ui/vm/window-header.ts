import { formatAge } from '../../core/format';
import type { Settings } from '../../core/settings';
import type { Reference } from '../../core/types';
import { headerModel } from './header';
import { locationModel } from './location';
import { terminalFullName, terminalName } from './terminal-name';
import { terminalFullPlace } from './terminal-place';
import { tr } from '../../i18n';

/** What the one-line header of the expanded window shows. */
export interface WindowHeader {
  /** The short name of the viewed terminal for the field of the location; `null` when none is viewed. */
  location: string | null;
  /** The tooltip of the field: the full name, where the terminal is, and where the ship stands when that is another place. */
  locationTitle: string;
  /** The terminal "Я здесь" would make the current location; `null` when the button is not wanted at all. */
  hereTerminalId: number | null;
  /**
   * The indicator of UEX, which is also the button that refreshes the prices: the quiet text (the age of the prices, or
   * how far a refresh that is going is), the tooltip, whether to warn, and whether a refresh is going (`busy`).
   */
  uex: { text: string; title: string; stale: boolean; busy: boolean };
}

/** How the price sync stands: it is going (`running`) with `done` of `total` batches finished, or it is not. */
export interface PriceSync {
  running: boolean;
  /** Batches finished; meaningful only while `running`. */
  done: number;
  /** All the batches of the run; 0 while the sync has not started yet (it waits for its turn in the queue of UEX). */
  total: number;
  /** Terminals the last finished run could not fetch (0 when it fetched everything). */
  unfetched: number;
}

export const PRICE_SYNC_IDLE: PriceSync = { running: false, done: 0, total: 0, unfetched: 0 };

const EMPTY_FIELD_TITLE = (): string => tr('Выбери локацию: три буквы и Enter');
const REFRESH_HINT = (): string => tr('Нажми, чтобы обновить цены сейчас');
/** The click also repeats the reference sync that failed (`refreshPlan` in `sync-plan.ts`): the tooltip says so. */
const REFERENCE_FAILED = (): string => tr('Справочник UEX не обновился');
const REFRESH_REFERENCE_HINT = (): string => tr('Нажми, чтобы обновить справочник и цены сейчас');

/**
 * 'UEX 12 мин': the age alone; the long form with 'назад' or the date of the cached data is the tooltip. When UEX does not
 * answer, the same age says which data these are: 'UEX офлайн 3 ч' (spec 10: "UEX недоступен, данные от …"; the full phrase with
 * the date is the tooltip). Without any data there is no age to say: 'UEX недоступен'.
 */
function uexShort(pricesSyncedAt: number | null, uexOk: boolean, now: number): string {
  if (!uexOk) {
    if (pricesSyncedAt === null) return tr('UEX недоступен');
    const age = Math.max(0, now - pricesSyncedAt);
    return tr('UEX офлайн {age}', { age: age < 60 ? tr('0 мин') : formatAge(age) });
  }
  if (pricesSyncedAt === null) return tr('UEX не загружен');
  const age = Math.max(0, now - pricesSyncedAt);
  return age < 60 ? tr('UEX сейчас') : `UEX ${formatAge(age)}`;
}

/** The indicator while a refresh is going: 'UEX 23/57', or 'UEX …' until the sync has counted its batches. */
function uexProgress(sync: PriceSync): WindowHeader['uex'] {
  const counted = sync.total > 0;
  return {
    text: counted ? `UEX ${sync.done}/${sync.total}` : 'UEX …',
    title: counted ? tr('Цены UEX обновляются: {done} из {total}', { done: sync.done, total: sync.total }) : tr('Цены UEX обновляются: ждут своей очереди'),
    stale: false,
    busy: true,
  };
}

/**
 * The header of the expanded window: the viewed terminal as the location, the button "Я здесь" when the ship stands
 * elsewhere, and the indicator of UEX (the age of the prices, or the progress of a refresh). The ship and the system
 * are not here (they are in the settings). `referenceOk` is false after a reference sync that failed: the click on the
 * indicator repeats it with the prices, and the tooltip says so.
 */
export function windowHeader(
  ref: Reference, s: Settings, viewTerminalId: number | null, pricesSyncedAt: number | null, uexOk: boolean, now: number,
  sync: PriceSync = PRICE_SYNC_IDLE, referenceOk = true,
): WindowHeader {
  const view = locationModel(ref, s, viewTerminalId, pricesSyncedAt, uexOk, now);
  const terminal = viewTerminalId === null ? undefined : ref.terminals.get(viewTerminalId);
  const title = terminal === undefined
    ? EMPTY_FIELD_TITLE()
    : [terminalFullName(terminal), terminalFullPlace(terminal, ref.starSystems), view.currentLocation === null ? '' : tr('Сейчас: {currentLocation}', { currentLocation: view.currentLocation })]
      .filter((line) => line !== '')
      .join('\n');
  const referenceFailed = referenceOk ? [] : [REFERENCE_FAILED()];
  const unfetched = sync.unfetched > 0 ? [tr('Не обновилось терминалов: {unfetched}', { unfetched: sync.unfetched })] : [];
  return {
    location: terminal === undefined ? null : terminalName(terminal),
    locationTitle: title,
    hereTerminalId: view.canSetCurrent ? viewTerminalId : null,
    uex: sync.running
      ? uexProgress(sync)
      : {
        text: uexShort(pricesSyncedAt, uexOk, now),
        title: [
          headerModel(ref, s, pricesSyncedAt, uexOk, now).uex, ...referenceFailed, ...unfetched, referenceOk ? REFRESH_HINT() : REFRESH_REFERENCE_HINT(),
        ].join('\n'),
        stale: !uexOk,
        busy: false,
      },
  };
}
