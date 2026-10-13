import { DEFAULT_REFILL_FULL_MIN } from './stock';

export interface Settings {
  vehicleId: number | null; scuCapacity: number; starSystemId: number | null; budget: number | null;
  hotMin: number; warmMin: number; coolingMin: number;
  /** Minutes a stock needs to refill from empty to its maximum while no rate is learned for it yet. */
  refillFullMin: number;
  quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number; topN: number;
  /**
   * «Цена на месте хуже — куда лететь» (spec 14.19, item 8): by how many whole percents a sale price typed in must be below the
   * expected one for the window to say so and name a better place. 0 switches the notice off.
   */
  worsePricePct: number;
  /** «Выгоднее» (spec 14.19, item 7): the longest EMPTY flight to a purchase at another terminal, in minutes; a purchase farther away is not offered. */
  nearbyMaxMin: number;
  /**
   * Whole percent of ROI from which a row of the terminal table stands out (a coloured bar at its edge, and one soft flash
   * when it crosses the threshold after a price was entered). 0 marks every row that pays at all.
   */
  roiHighlightPct: number;
  sort: 'uecPerHour' | 'roi'; nearby: boolean;
  /**
   * «Подробные расчёты» (spec 14.19): the extra numbers of the calculations. Off, «лететь дальше» says what it adds and how long it
   * takes; on, it also says the low end of the range and the rate of the further leg against the player's usual pace, and «Мои
   * маршруты» count the lost runs of a route (attempts, the profit and the rate with the losses).
   */
  detailedCalc: boolean;
  /**
   * «К цели» (spec 14.19, item 16): the list of options of a terminal shows the goods of ONE pair, that terminal and the target,
   * with the set that fills the hold, instead of the best trips to anywhere. It applies only while a target is set and is another
   * terminal than the one the options are of.
   */
  optionsToTarget: boolean;
  /**
   * Favourite routes (spec 14.19, item 11): the routes the player marked with a star (where a commodity is bought, where it is
   * sold, and which), and the sound of their alert: whether it plays, and how loud (0 … 1).
   */
  favouriteRoutes: Array<{ originId: number; destId: number; commodityId: number }>;
  favouriteSound: boolean; favouriteVolume: number;
  /** The commodity reference (spec 14.19, item 9): only the terminals of the star system of the settings; and, where to buy, only the places with a known stock that is not empty. */
  guideMySystem: boolean; guideOnlyStock: boolean;
  /**
   * «Обнулить маршруты» (spec 14.19): the moment (unix seconds) from which the player's routes are counted, `null` for "from the first run".
   * The runs that ended before it stay in the history and in the sessions; the rating of the routes, the player's own times of the pairs and
   * his usual pace do not see them. Nothing is deleted, so the reset can be taken back.
   */
  routesSince: number | null;
  /** Optional trigger keys, e.g. 'F8' or 'Ctrl+Alt+T'; '' means not assigned. */
  hotkeyPanel: string; hotkeyDepart: string; hotkeyArrive: string;
  /** Width of the expanded window in px; its height follows its content. */
  panelWidth: number;
  /**
   * The size of the whole window (the mini bar, the expanded view, the settings) as a zoom in whole percent: 100, 110, 125 or 150.
   * 0 is «Авто»: the interface picks one of them by the height of the primary monitor (`src/ui/vm/ui-scale.ts`).
   * `panelWidth` and the offsets below stay in the player's own pixels; on the screen the window is as big as they say × the zoom.
   */
  uiScale: number;
  /**
   * Where the window stands, mini bar and expanded view alike: the anchor corner of the monitor, and the
   * distances (logical px) of the window from that corner's two edges. The player drags the window; the
   * anchor corner of the window stays fixed while its size changes.
   */
  stripCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  windowDx: number;
  windowDy: number;
  /** The grip does not move a locked window. */
  windowLocked: boolean;
  /** Seconds without activity before the expanded window folds into the mini bar by itself; 0 = never. */
  idleCollapseSec: number;
  /** Ids of the sections that are open in the expanded window, separated by commas. */
  openSections: string;
  opacity: number;
  /** "Show the mini bar": off, the collapsed window is hidden and the tray or a key opens it. */
  showStrip: boolean;
  /**
   * The run line of the mini bar (spec 14.19): on, the low and the high end of the sale range of the target take turns in one place;
   * off, they stand side by side as 'мин–макс'. A system that asks for less motion gets them side by side whatever this says.
   */
  stripRangeTurns: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  serverChangedAt: number | null; currentTerminalId: number | null; targetTerminalId: number | null;
  /**
   * The second step of a target in two steps (spec 14.19, item 7): `targetTerminalId` is then where the cargo is BOUGHT, and
   * after a purchase there the target becomes this terminal, where it is sold. `null` for a plain target.
   */
  targetThenId: number | null;
  /** The one-time hint about the keys of "Взлетел" and "Прилетел" was shown, or such a key was assigned: it is never shown (again). */
  keysHintShown: boolean;
  /** The one-time word about the larger window was said («Авто» picked more than 100 %), or the player chose the scale himself: it is never said (again). */
  scaleNoticeShown: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  vehicleId: null, scuCapacity: 0, starSystemId: null, budget: null,
  hotMin: 60, warmMin: 180, coolingMin: 240,
  refillFullMin: DEFAULT_REFILL_FULL_MIN,
  quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, nearbyMaxMin: 10, worsePricePct: 15, topN: 5, roiHighlightPct: 50,
  sort: 'uecPerHour', nearby: false, detailedCalc: false, optionsToTarget: false, favouriteRoutes: [], favouriteSound: true, favouriteVolume: 0.5, guideMySystem: true, guideOnlyStock: false, routesSince: null,
  hotkeyPanel: '', hotkeyDepart: '', hotkeyArrive: '',
  panelWidth: 440, stripCorner: 'top-right', windowDx: 16, windowDy: 16, windowLocked: false,
  uiScale: 0,
  idleCollapseSec: 40, openSections: 'terminal,options,settings:ship',
  opacity: 0.92, showStrip: true, stripRangeTurns: true, logLevel: 'debug',
  serverChangedAt: null, currentTerminalId: null, targetTerminalId: null, targetThenId: null,
  keysHintShown: false, scaleNoticeShown: false,
};
