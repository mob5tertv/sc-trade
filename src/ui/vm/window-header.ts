import { formatAge } from '../../core/format';
import type { Settings } from '../../core/settings';
import type { Reference } from '../../core/types';
import { headerModel } from './header';
import { locationModel } from './location';

/** What the one-line header of the expanded window shows. */
export interface WindowHeader {
  /** The short name of the viewed terminal for the field of the location; `null` when none is viewed. */
  location: string | null;
  /** The tooltip of the field: the full name, and where the ship stands when that is another place. */
  locationTitle: string;
  /** The terminal "Я здесь" would make the current location; `null` when the button is not wanted at all. */
  hereTerminalId: number | null;
  /** The freshness of the UEX data: the quiet text, the long form for the tooltip, and whether to warn. */
  uex: { text: string; title: string; stale: boolean };
}

const EMPTY_FIELD_TITLE = 'Выбери локацию: три буквы и Enter';

/** 'UEX 12 мин': the age alone; the long form with 'назад' or the date of the cached data is the tooltip. */
function uexShort(pricesSyncedAt: number | null, uexOk: boolean, now: number): string {
  if (!uexOk) return 'UEX недоступен';
  if (pricesSyncedAt === null) return 'UEX не загружен';
  const age = Math.max(0, now - pricesSyncedAt);
  return age < 60 ? 'UEX сейчас' : `UEX ${formatAge(age)}`;
}

/**
 * The header of the expanded window: the viewed terminal as the location, the button "Я здесь" when the ship stands
 * elsewhere, and the freshness of UEX. The ship and the system are not here (they are in the settings).
 */
export function windowHeader(
  ref: Reference, s: Settings, viewTerminalId: number | null, pricesSyncedAt: number | null, uexOk: boolean, now: number,
): WindowHeader {
  const view = locationModel(ref, s, viewTerminalId, pricesSyncedAt, uexOk, now);
  const terminal = viewTerminalId === null ? undefined : ref.terminals.get(viewTerminalId);
  const title = terminal === undefined
    ? EMPTY_FIELD_TITLE
    : view.currentLocation === null ? view.header.location : `${view.header.location}\nСейчас: ${view.currentLocation}`;
  return {
    // the nickname is what players know a terminal by; UEX leaves it empty on rare rows
    location: terminal === undefined ? null : terminal.nickname || terminal.displayname || terminal.name,
    locationTitle: title,
    hereTerminalId: view.canSetCurrent ? viewTerminalId : null,
    uex: {
      text: uexShort(pricesSyncedAt, uexOk, now),
      title: headerModel(ref, s, pricesSyncedAt, uexOk, now).uex,
      stale: !uexOk,
    },
  };
}
