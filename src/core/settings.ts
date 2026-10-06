import { DEFAULT_REFILL_FULL_MIN } from './stock';

export interface Settings {
  vehicleId: number | null; scuCapacity: number; starSystemId: number | null; budget: number | null;
  hotMin: number; warmMin: number; coolingMin: number;
  /** Minutes a stock needs to refill from empty to its maximum while no rate is learned for it yet. */
  refillFullMin: number;
  quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number; topN: number;
  sort: 'uecPerHour' | 'roi'; nearby: boolean;
  /** Optional trigger keys, e.g. 'F8' or 'Ctrl+Alt+T'; '' means not assigned. */
  hotkeyPanel: string; hotkeyDepart: string; hotkeyArrive: string;
  /** The panel opens on the side of the strip, so there is no separate panel-side setting. */
  panelWidth: number;
  stripCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number; showStrip: boolean; logLevel: 'debug' | 'info' | 'warn' | 'error';
  serverChangedAt: number | null; currentTerminalId: number | null; targetTerminalId: number | null;
}
export const DEFAULT_SETTINGS: Settings = {
  vehicleId: null, scuCapacity: 0, starSystemId: null, budget: null,
  hotMin: 60, warmMin: 180, coolingMin: 240,
  refillFullMin: DEFAULT_REFILL_FULL_MIN,
  quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 5,
  sort: 'uecPerHour', nearby: false,
  hotkeyPanel: '', hotkeyDepart: '', hotkeyArrive: '',
  panelWidth: 470, stripCorner: 'top-right',
  opacity: 0.92, showStrip: true, logLevel: 'debug',
  serverChangedAt: null, currentTerminalId: null, targetTerminalId: null,
};
