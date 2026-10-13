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

/**
 * Замер количества: последнее своё наблюдение по этой паре и стороне, в котором количество указано (ноль — известный ноль).
 * Наблюдение без количества — это замер одной только цены, он количество не отменяет (спека 14.6).
 */
export interface QuantityReading { terminalId: number; commodityId: number; side: Side; ts: number; scu: number }

/**
 * Предыдущий свой замер цены для той же точки, товара и стороны: самый поздний, который старше последнего не меньше
 * чем на `MIN_READING_GAP_SEC`. Замер через несколько секунд после другого — исправление опечатки, а не движение рынка.
 */
export interface PriceReading { terminalId: number; commodityId: number; side: Side; ts: number; price: number }

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
  ownScu: Map<string, { ts: number; scu: number }>;   // obsKey → последний свой замер с количеством; своё время, не время наблюдения цены
  ownPrev: Map<string, { ts: number; price: number }>;   // obsKey → предыдущий свой замер цены (см. PriceReading); пуст, пока рынок строят без него
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
  ageKnown: boolean;             // false только для цены UEX у строки без даты изменения: возраст тогда не показывается
  ownLast: { price: number; ageSec: number } | null;   // своё холодное, справочно
  uexRange: { low: number; high: number } | null;      // рядом с «остывает»
  scu: number | null;            // на закупке — остаток у продавца; на продаже — склад покупателя (справка, ничего не ограничивает)
  scuOrigin: 'own' | 'uex' | null;   // откуда scu: свой не холодный замер количества (не обязательно того же наблюдения, что цена), UEX, или нигде
  stock: StockEstimate | null;   // только на закупке и только когда scuOrigin === 'own'; на продаже всегда null
  prev: { price: number; ageSec: number } | null;   // предыдущий свой замер этой цены; только когда цена своя и не холодная, иначе null
}

export type RunEventType = 'buy' | 'sell' | 'depart' | 'arrive';
export interface Run {
  id: number; vehicleId: number | null; scuCapacity: number; startedAt: number; endedAt: number | null; status: 'active' | 'done' | 'lost';
  /** Цель, которая стояла у рейса, когда груз списали как потерянный (таблица `run_target`); у остальных рейсов её нет. */
  targetId?: number | null;
}
export interface RunEvent { id: number; runId: number; ts: number; type: RunEventType; terminalId: number | null; commodityId: number | null; scu: number | null; price: number | null }
export interface RunWithEvents { run: Run; events: RunEvent[] }
export interface CargoLine { commodityId: number; scu: number; avgBuyPrice: number }
