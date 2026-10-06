export interface Settings {
  vehicleId: number | null; scuCapacity: number; starSystemId: number | null; budget: number | null;
  hotMin: number; warmMin: number; coolingMin: number;
  quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number; topN: number;
  sort: 'uecPerHour' | 'roi'; nearby: boolean;
  hotkeyPanel: string; hotkeyDepart: string; hotkeyArrive: string;
  panelSide: 'left' | 'right'; panelWidth: number;
  stripCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number; showStrip: boolean; logLevel: 'debug' | 'info' | 'warn' | 'error';
  serverChangedAt: number | null; currentTerminalId: number | null; targetTerminalId: number | null;
}
export const DEFAULT_SETTINGS: Settings = {
  vehicleId: null, scuCapacity: 0, starSystemId: null, budget: null,
  hotMin: 60, warmMin: 180, coolingMin: 240,
  quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 5,
  sort: 'uecPerHour', nearby: false,
  hotkeyPanel: 'Ctrl+Alt+T', hotkeyDepart: 'Ctrl+Alt+1', hotkeyArrive: 'Ctrl+Alt+2',
  panelSide: 'right', panelWidth: 470, stripCorner: 'top-left',
  opacity: 0.92, showStrip: true, logLevel: 'debug',
  serverChangedAt: null, currentTerminalId: null, targetTerminalId: null,
};
