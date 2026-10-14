import type { EstimateCtx } from '../../core/estimate';
import { formatAge, formatUec } from '../../core/format';
import { priceWarning } from '../../core/input';
import { priceKey } from '../../core/types';
import type { Market, Observation, Reference, Side } from '../../core/types';
import { formatStamp } from './stats-rows';
import { terminalLabel } from './terminal-name';
import { uexRangeOf } from './terminal-rows';

// «Записи» of «Мои маршруты» (the author, 14.10.2026): every price of the player's own that the program counts with, in one list,
// where a record can be corrected or taken out. What made it necessary: a test price typed in at a station where UEX does not
// know the commodity stays for ever (nothing ever replaces it), and gave a "best" trip with an ROI of 161 %. To find such a
// record one had to remember the station. Pure; the list is `components/RecordsList.svelte`.

/** Why a record is worth a second look; `null`: nothing says so. */
export type RecordDoubt = 'no-uex' | 'far';

const DOUBT_TEXT: Record<RecordDoubt, string> = {
  'no-uex': 'UEX этого товара на этой станции не знает: сверить цену не с чем, и ничто её не заменит',
  far: 'Цена далеко от истории UEX: меньше половины минимума или больше двух максимумов',
};

export interface RecordRow {
  /** The observation of the diary: the row that a correction changes. */
  id: number;
  terminalId: number; commodityId: number; side: Side;
  /** '14.10 03:46' and how long ago that is ('35 мин', '5 ч', '2 д'). */
  when: string; age: string;
  terminal: string;
  /** The code of the commodity, and its name for the tooltip. */
  code: string; name: string;
  /** 'куп.' for a price the station sells at, 'прод.' for one it buys at. */
  sideLabel: string;
  price: number; scu: number | null;
  priceText: string; scuText: string;
  /** Why the record is worth a second look, in words; `null` when nothing says so. */
  doubt: string | null;
}

function doubtOf(m: Market, o: Observation, ctx: EstimateCtx): RecordDoubt | null {
  if (uexRangeOf(m, o.terminalId, o.commodityId, o.side, ctx).kind === 'none') return 'no-uex';
  const uex = m.uex.get(priceKey(o.terminalId, o.commodityId));
  return uex !== undefined && priceWarning(o.price, uex[o.side].min, uex[o.side].max) ? 'far' : null;
}

/**
 * The player's records, the newest first: one row for every terminal, commodity and side he has a price of (`Market.own`
 * holds the latest observation of each, which is the one the estimates read).
 */
export function recordRows(m: Market, ref: Reference, ctx: EstimateCtx): RecordRow[] {
  return [...m.own.values()]
    .sort((a, b) => b.ts - a.ts || b.id - a.id)
    .map((o): RecordRow => {
      const commodity = ref.commodities.get(o.commodityId);
      const doubt = doubtOf(m, o, ctx);
      return {
        id: o.id, terminalId: o.terminalId, commodityId: o.commodityId, side: o.side,
        when: formatStamp(o.ts), age: formatAge(Math.max(0, ctx.now - o.ts)),
        terminal: terminalLabel(ref, o.terminalId),
        code: commodity?.code || `#${o.commodityId}`, name: commodity?.name || `#${o.commodityId}`,
        sideLabel: o.side === 'buy' ? 'куп.' : 'прод.',
        price: o.price, scu: o.scu,
        priceText: formatUec(o.price), scuText: o.scu === null ? '' : String(o.scu),
        doubt: doubt === null ? null : DOUBT_TEXT[doubt],
      };
    });
}

/** The rows that are worth a second look. */
export const doubtfulRecords = (rows: readonly RecordRow[]): RecordRow[] => rows.filter((row) => row.doubt !== null);
