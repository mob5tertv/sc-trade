import type { Settings } from '../../core/settings';
import type { Reference } from '../../core/types';
import { headerModel, type HeaderModel } from './header';

/** The header with the VIEWED terminal as its location (spec 14.2), and what differs from the current one. */
export interface LocationModel {
  header: HeaderModel;
  /** Where the ship stands, when that is another terminal than the viewed one; the secondary line. */
  currentLocation: string | null;
  /** "Я здесь" is offered: a real terminal is viewed and it is not the current location. */
  canSetCurrent: boolean;
}

export function locationModel(
  ref: Reference,
  s: Settings,
  viewTerminalId: number | null,
  pricesSyncedAt: number | null,
  uexOk: boolean,
  now: number,
): LocationModel {
  const header = headerModel(ref, { ...s, currentTerminalId: viewTerminalId }, pricesSyncedAt, uexOk, now);
  const viewedExists = viewTerminalId !== null && ref.terminals.has(viewTerminalId);
  const currentExists = s.currentTerminalId !== null && ref.terminals.has(s.currentTerminalId);
  const differs = viewTerminalId !== s.currentTerminalId;
  return {
    header,
    currentLocation: differs && currentExists ? headerModel(ref, s, pricesSyncedAt, uexOk, now).location : null,
    canSetCurrent: viewedExists && differs,
  };
}
