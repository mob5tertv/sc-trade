import type { Side } from '../core/types';
import type { Scene, SceneApp } from './scenes';

// The scenes of task 34: the best ROI of every row of the table of the terminal (spec 14.10). The player has just come to
// Lorville and marks the prices he sees there; the rows that are worth a look say it themselves, by the colour of their
// ROI and, from the threshold of the setting (50 %), by a bar at their edge.
//
// The prices are what a player types, over the `default` dataset (the reference: ids of the preview data below). Each one is
// made from the best price of the other end of the trip in that dataset, so that the ROI of the row is the one wanted:
//   sale price = cheapest purchase price elsewhere × (1 + ROI)          (the table of "Продать здесь")
//   purchase price = dearest sale price elsewhere ÷ (1 + ROI)           (the table of "Купить здесь")
// `tests/preview/scenes-roi.test.ts` counts the ROI of these prices with the real search, so a change of the dataset that
// moves them is a failing test, not a wrong picture.

/** TDD Lorville, the terminal of the story. */
export const LORVILLE = 6;

/** Commodity ids of the preview data. */
export const COMMODITY: Readonly<Record<string, number>> = {
  MEDS: 1, GOLD: 2, TUNG: 3, LARA: 4, AGRI: 5, TITA: 6, DIAM: 7, STIM: 8, QUAR: 9, HYDR: 10, PFOO: 11, SCRA: 12, WAST: 13, BERY: 14, ALUM: 15,
};

export interface PricedCommodity { code: string; price: number; /** The ROI the price is made for; `null`: no trip pays at this price. */ roi: number | null }

/**
 * What the player saw Lorville PAY for his cargo ("Продать здесь"): ROI of every tier on the table, the first four rows are at
 * or above 50 % (the bar), two more are great and below it, then good, ok and poor, and two prices below the cheapest source
 * (no trip, an empty cell).
 */
export const SELL_PRICES: readonly PricedCommodity[] = [
  { code: 'STIM', price: 4305, roi: 0.7 },
  { code: 'DIAM', price: 9435, roi: 0.62 },
  { code: 'MEDS', price: 2870, roi: 0.54 },
  { code: 'GOLD', price: 7965, roi: 0.5 },
  { code: 'PFOO', price: 1875, roi: 0.41 },
  { code: 'TUNG', price: 4600, roi: 0.32 },
  { code: 'HYDR', price: 475, roi: 0.22 },
  { code: 'ALUM', price: 1145, roi: 0.16 },
  { code: 'LARA', price: 3185, roi: 0.09 },
  { code: 'AGRI', price: 2410, roi: 0.03 },
  { code: 'QUAR', price: 1200, roi: null },
  { code: 'BERY', price: 3700, roi: null },
];

/** What the player saw Lorville ASK ("Купить здесь"): Gold at a bargain, a trip of each lower tier, Scrap dearer than anyone pays. */
export const BUY_PRICES: readonly PricedCommodity[] = [
  { code: 'GOLD', price: 4650, roi: 0.58 },
  { code: 'TUNG', price: 3300, roi: 0.31 },
  { code: 'HYDR', price: 470, roi: 0.17 },
  { code: 'QUAR', price: 1370, roi: 0.14 },
  { code: 'WAST', price: 120, roi: 0.04 },
  { code: 'SCRA', price: 2100, roi: null },
];

/** A few prices of the sell side, below the threshold: the player has entered only the first ones and goes on (the flash scene). */
export const EARLY_SELL_PRICES: readonly PricedCommodity[] = [
  { code: 'DIAM', price: 9435, roi: 0.62 },
  { code: 'STIM', price: 3290, roi: 0.3 },
  { code: 'PFOO', price: 1700, roi: 0.28 },
  { code: 'MEDS', price: 2150, roi: 0.15 },
  { code: 'HYDR', price: 460, roi: 0.18 },
];

/** The prices go in one by one, as a player writes them: each one through the same call as the entry of the window. */
async function enter(app: SceneApp, side: Side, prices: readonly PricedCommodity[]): Promise<void> {
  for (const { code, price } of prices) {
    const failure = await app.recordPrice({ terminalId: LORVILLE, commodityId: COMMODITY[code], side, price, scu: null });
    if (failure !== null) throw new Error(`the scene could not record ${code} at ${price}: ${failure}`);
  }
}

/** The window expanded at Lorville, on one side of its table, with the prices entered. */
async function atLorville(app: SceneApp, side: Side, prices: readonly PricedCommodity[]): Promise<void> {
  await app.expand('preview');
  await enter(app, side, prices);
  app.setViewTerminal(LORVILLE);
  app.setTerminalSide(side);
}

export const ROI_SCENES: readonly Scene[] = [
  {
    name: 'roi-sell',
    title: 'Лорвилль, «Продать здесь»: ROI всех ступеней, строки от 50 % с полосой, две строки без вариантов',
    dataset: 'default',
    act: (app) => atLorville(app, 'sell', SELL_PRICES),
  },
  {
    name: 'roi-buy',
    title: 'Лорвилль, «Купить здесь»: лучший ROI «отвезти отсюда», строка без вариантов',
    dataset: 'default',
    act: (app) => atLorville(app, 'buy', BUY_PRICES),
  },
  {
    // the flash: `--do "eval:…;click:…;type:4305;press:Enter"` writes the price after which Stims cross 50 %
    name: 'roi-entering',
    title: 'Лорвилль, «Продать здесь»: пять цен введены, дальше цена Stims переведёт строку за порог (вспышка)',
    dataset: 'default',
    act: (app) => atLorville(app, 'sell', EARLY_SELL_PRICES),
  },
  {
    // a terminal of another star system than the one of the settings: the filter of the system leaves every row without a trip
    name: 'roi-none',
    title: 'Ruin Station (Pyro): система поиска Stanton, у строк нет вариантов, столбец ROI пуст',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(14);
    },
  },
];
