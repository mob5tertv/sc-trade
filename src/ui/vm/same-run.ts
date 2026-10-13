import type { RunWithEvents } from '../../core/types';

/**
 * Whether two readings of the active run are the same run in the same state. The state keeps the run it has when the
 * database says the same, so that whoever follows `app.activeRun` by identity (the statistics) is not woken for nothing.
 * An event is told by its id AND by what it says: a trade can be corrected in place (spec 14.19, item 5: its quantity and price),
 * and a corrected trade is another state of the run, which every screen that shows the hold or the money must see.
 */
export function sameRun(a: RunWithEvents | null, b: RunWithEvents | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  const [x, y] = [a.run, b.run];
  if (x.id !== y.id || x.status !== y.status || x.startedAt !== y.startedAt || x.endedAt !== y.endedAt || x.scuCapacity !== y.scuCapacity || x.vehicleId !== y.vehicleId) {
    return false;
  }
  return a.events.length === b.events.length && a.events.every((e, i) => {
    const o = b.events[i];
    return e.id === o.id && e.scu === o.scu && e.price === o.price;
  });
}
