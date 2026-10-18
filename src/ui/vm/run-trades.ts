import { formatUec } from '../../core/format';
import type { Reference, RunWithEvents } from '../../core/types';
import { terminalLabel } from './terminal-name';
import { tr } from '../../i18n';

// The trades of one run as the correction form lists them (spec 14.19, item 5): what was bought or sold, where, how much and for
// what. Pure; the form is `components/RunTrades.svelte`.

export interface TradeLine {
  eventId: number;
  type: 'buy' | 'sell';
  /** 'Купил' or 'Продал'; a movement of the storage (version 1.4) is 'Со склада' or 'На склад'. */
  label: string;
  /** Where: the name of the terminal as everywhere else; the dash for a trade that names none. */
  terminal: string;
  /** The code of the commodity. */
  code: string;
  /** The quantity and the price as they are, for the fields to start from. */
  scu: number; price: number;
  scuText: string; priceText: string;
}

const NONE = '—';

/** The trades of a run in the order they were made; marks and half-filled rows are no trades and are left out. */
export function tradeLines(run: RunWithEvents, ref: Reference): TradeLine[] {
  const lines: TradeLine[] = [];
  for (const e of run.events) {
    if ((e.type !== 'buy' && e.type !== 'sell') || e.commodityId === null || e.scu === null || e.price === null) continue;
    lines.push({
      eventId: e.id, type: e.type,
      label: e.storage === 'back' ? tr('На склад') : e.storage !== undefined ? tr('Со склада') : e.type === 'buy' ? tr('Купил') : tr('Продал'),
      terminal: e.terminalId === null ? NONE : terminalLabel(ref, e.terminalId),
      code: ref.commodities.get(e.commodityId)?.code || `#${e.commodityId}`,
      scu: e.scu, price: e.price,
      scuText: String(e.scu), priceText: formatUec(e.price),
    });
  }
  return lines;
}
