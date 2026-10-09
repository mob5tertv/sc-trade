import { DEFAULT_REFILL_FULL_MIN } from './stock';

export interface Settings {
  vehicleId: number | null; scuCapacity: number; starSystemId: number | null; budget: number | null;
  hotMin: number; warmMin: number; coolingMin: number;
  /** Minutes a stock needs to refill from empty to its maximum while no rate is learned for it yet. */
  refillFullMin: number;
  quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number; topN: number;
  /**
   * Whole percent of ROI from which a row of the terminal table stands out (a coloured bar at its edge, and one soft flash
   * when it crosses the threshold after a price was entered). 0 marks every row that pays at all.
   */
  roiHighlightPct: number;
  sort: 'uecPerHour' | 'roi'; nearby: boolean;
  /** Optional trigger keys, e.g. 'F8' or 'Ctrl+Alt+T'; '' means not assigned. */
  hotkeyPanel: string; hotkeyDepart: string; hotkeyArrive: string;
  /** Width of the expanded window in px; its height follows its content. */
  panelWidth: number;
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
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  serverChangedAt: number | null; currentTerminalId: number | null; targetTerminalId: number | null;
  /** The one-time hint about the keys of "Взлетел" and "Прилетел" was shown, or such a key was assigned: it is never shown (again). */
  keysHintShown: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  vehicleId: null, scuCapacity: 0, starSystemId: null, budget: null,
  hotMin: 60, warmMin: 180, coolingMin: 240,
  refillFullMin: DEFAULT_REFILL_FULL_MIN,
  quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 5, roiHighlightPct: 50,
  sort: 'uecPerHour', nearby: false,
  hotkeyPanel: '', hotkeyDepart: '', hotkeyArrive: '',
  panelWidth: 440, stripCorner: 'top-right', windowDx: 16, windowDy: 16, windowLocked: false,
  idleCollapseSec: 40, openSections: 'terminal,options,settings:ship',
  opacity: 0.92, showStrip: true, logLevel: 'debug',
  serverChangedAt: null, currentTerminalId: null, targetTerminalId: null,
  keysHintShown: false,
};
