// src/core/types.ts
export type Side = 'buy' | 'sell';
export type Temp = 'hot' | 'warm' | 'cooling' | 'cold';
export interface TempThresholds { hotMin: number; warmMin: number; coolingMin: number }

export interface StarSystem { id: number; name: string; code: string; isAvailableLive: boolean }
export interface Terminal {
  id: number; starSystemId: number; planetId: number; orbitId: number;
  name: string; nickname: string; displayname: string; code: string;
  starSystemName: string | null; planetName: string | null; orbitName: string | null;
  moonName: string | null; spaceStationName: string | null; outpostName: string | null; cityName: string | null;
  hasFreightElevator: boolean; hasLoadingDock: boolean; isAutoLoad: boolean; isAvailableLive: boolean;
}
export interface Commodity { id: number; name: string; code: string; isIllegal: boolean; isBuyable: boolean; isSellable: boolean; isAvailableLive: boolean }
export interface Vehicle { id: number; name: string; nameFull: string; scu: number }
export interface Reference { starSystems: StarSystem[]; terminals: Map<number, Terminal>; commodities: Map<number, Commodity>; vehicles: Vehicle[] }

export interface UexSideStats {
  last: number;
  minWeek: number; maxWeek: number; avgWeek: number;
  minMonth: number; maxMonth: number; avgMonth: number;
  min: number; max: number; avg: number;
}
export interface UexPrice {
  terminalId: number; commodityId: number; buy: UexSideStats; sell: UexSideStats;
  scuBuy: number; scuSell: number;
  scuBuyMax: number; scuSellMax: number;   // наибольшее, что видел UEX (за неделю, иначе за всё время); 0 — неизвестно
  dateModified: number;
}
/** В своём наблюдении `scu: 0` — известно, что пусто; `null` — неизвестно (у данных UEX ноль по-прежнему «неизвестно»). */
export interface Observation { id: number; ts: number; terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }

/** Выучено по своему дневнику для одной пары «терминал, товар, сторона»; `null` — нечего вывести. */
export interface StockStats { maxScu: number | null; ratePerMin: number | null }
/** Оценка количества на точке «сейчас»: от базы (своего замера) со скоростью пополнения, не выше максимума. */
export interface StockEstimate {
  scu: number;                 // оценка сейчас
  baseScu: number; baseAgeSec: number;
  ratePerMin: number; rateSource: 'learned' | 'default' | 'none';
  maxScu: number | null;
}

export interface Market {
  uex: Map<string, UexPrice>;          // priceKey
  own: Map<string, Observation>;       // obsKey, только последнее наблюдение
  byTerminal: Map<number, Set<number>>;   // терминал → товары
  byCommodity: Map<number, Set<number>>;  // товар → терминалы
  stock: Map<string, StockStats>;      // obsKey
}
export const priceKey = (terminalId: number, commodityId: number) => `${terminalId}:${commodityId}`;
export const obsKey = (terminalId: number, commodityId: number, side: Side) => `${terminalId}:${commodityId}:${side}`;
export const distKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
export const pairKey = (originId: number, destId: number) => `${originId}>${destId}`;

export interface Estimate {
  price: number; low: number; high: number;
  source: 'own' | 'uex'; temp: Temp | null; ageSec: number;
  ownLast: { price: number; ageSec: number } | null;   // своё холодное, справочно
  uexRange: { low: number; high: number } | null;      // рядом с «остывает»
  scu: number | null;            // на закупке — остаток у продавца; на продаже — склад покупателя (справка, ничего не ограничивает)
  stock: StockEstimate | null;   // только на закупке и только когда scu получено из своего наблюдения; на продаже всегда null
}

export type RunEventType = 'buy' | 'sell' | 'depart' | 'arrive';
export interface Run { id: number; vehicleId: number | null; scuCapacity: number; startedAt: number; endedAt: number | null; status: 'active' | 'done' | 'lost' }
export interface RunEvent { id: number; runId: number; ts: number; type: RunEventType; terminalId: number | null; commodityId: number | null; scu: number | null; price: number | null }
export interface RunWithEvents { run: Run; events: RunEvent[] }
export interface CargoLine { commodityId: number; scu: number; avgBuyPrice: number }
