import { formatDuration } from '../../core/format';
import type { Run, RunEvent, RunWithEvents } from '../../core/types';
import { tr } from '../../i18n';

// What a run is doing right now and for how long: loading, flight or unloading (spec 14.7, the live timers of 15c).
//
// The rules are those of `phases()` in core/run.ts, which splits a FINISHED run that has a route (one pair of
// terminals, whatever it carried): loading is the time from the
// first purchase to the take-off, flight from the take-off to the arrival, unloading from the arrival to the last
// sale. Here the same three phases are followed while the run goes on, and a run that has several flights is
// followed too, which `phases()` cannot express (it wants exactly one take-off and one arrival, and answers `null`
// for anything else): a take-off again after the arrival is a flight again, a purchase after the arrival (more is
// bought at a stop) is loading again.

export type RunPhase = 'loading' | 'flight' | 'unloading';

const ORDER: readonly RunPhase[] = ['loading', 'flight', 'unloading'];
const NONE = '—';

const NAME: Record<RunPhase, string> = { get loading() { return tr('Погрузка'); }, get flight() { return tr('Полёт'); }, get unloading() { return tr('Выгрузка'); } };
const CAPS: Record<RunPhase, string> = { get loading() { return tr('ПОГРУЗКА'); }, get flight() { return tr('ПОЛЁТ'); }, get unloading() { return tr('ВЫГРУЗКА'); } };

export const phaseName = (phase: RunPhase): string => NAME[phase];
/** For the mini line. */
export const phaseCaps = (phase: RunPhase): string => CAPS[phase];

export interface RunPhases {
  /** The phase that is running now. */
  phase: RunPhase;
  /** Seconds since it began. */
  sinceSec: number;
  /**
   * How long each phase of the CURRENT leg lasted: a finished one is fixed, the running one is `sinceSec`, a phase that
   * has not come yet in this leg is `null` (the loading of a second flight is the one it began with).
   */
  slots: Record<RunPhase, number | null>;
  /** The whole run, from its first purchase. */
  totalSec: number;
}

interface Segment { phase: RunPhase; from: number }

/** The phases the run went through, in order: the run is loading from its start; the marks and a purchase after an arrival move it on. */
function segmentsOf(run: Run, events: RunEvent[]): Segment[] {
  const segments: Segment[] = [{ phase: 'loading', from: run.startedAt }];
  const enter = (phase: RunPhase, from: number): void => {
    if (segments[segments.length - 1].phase !== phase) segments.push({ phase, from });
  };
  for (const e of events) {
    if (e.type === 'depart') enter('flight', e.ts);
    else if (e.type === 'arrive') enter('unloading', e.ts);
    else if (e.type === 'buy' && segments[segments.length - 1].phase === 'unloading') enter('loading', e.ts);
  }
  return segments;
}

/**
 * What the run is doing at `now` (Unix seconds), from its events; the events are in the order the database gives them
 * (time, then id). A run that has ended counts to its end, not to `now`: every number of a finished run stands still.
 */
export function runPhases(run: Run, events: RunEvent[], now: number): RunPhases {
  const segments = segmentsOf(run, events);
  const current = segments[segments.length - 1];
  const end = run.endedAt ?? now;
  const length = (i: number): number => Math.max(0, (segments[i + 1]?.from ?? end) - segments[i].from);

  const slots: Record<RunPhase, number | null> = { loading: null, flight: null, unloading: null };
  for (const phase of ORDER) {
    if (ORDER.indexOf(phase) > ORDER.indexOf(current.phase)) continue; // not yet in this leg
    const latest = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.phase === phase).pop();
    if (latest !== undefined) slots[phase] = length(latest.i);
  }
  return {
    phase: current.phase,
    sinceSec: Math.max(0, end - current.from),
    slots,
    totalSec: Math.max(0, end - run.startedAt),
  };
}

/**
 * The mark the button of the mini line and of the section header gives: the take-off while loading, the arrival in flight,
 * none while unloading (the sale ends the run). A second take-off with cargo aboard is the key or the card of the run.
 */
export function nextMarkOf(active: RunWithEvents | null, now: number): 'depart' | 'arrive' | null {
  if (active === null) return null;
  const { phase } = runPhases(active.run, active.events, now);
  return phase === 'loading' ? 'depart' : phase === 'flight' ? 'arrive' : null;
}

/**
 * The marks the card of the run offers in its body: the ones the header of the section does NOT offer. The header has the
 * mark that comes next (the take-off while loading, the arrival in flight), so the card has nothing then; while unloading the
 * header has none (the sale ends the run), and the card has the take-off of another leg with the cargo that is still aboard.
 */
export function cardMarks(phase: RunPhase): Array<'depart' | 'arrive'> {
  return phase === 'unloading' ? ['depart'] : [];
}

const NO_RUN = (): string => tr('Нет активного рейса');

/**
 * Why a mark cannot be written, in a sentence for the player; `null` when it can. There must be a run, and a mark
 * that repeats the one before it (two take-offs in a row, a double click) is not written twice.
 */
export function markRefusal(type: 'depart' | 'arrive', active: RunWithEvents | null): string | null {
  if (active === null) return NO_RUN();
  const last = [...active.events].reverse().find((e) => e.type === 'depart' || e.type === 'arrive');
  if (last?.type !== type) return null;
  return type === 'depart' ? tr('Взлёт уже отмечен') : tr('Прилёт уже отмечен');
}

export interface PhaseLine {
  items: Array<{ phase: RunPhase; name: string; text: string; state: 'done' | 'running' | 'future' }>;
  /** The whole run, 'm:ss'. */
  total: string;
}

/** The three phases of the current leg for one line of the section: the finished ones fixed, the running one ticking, the others a dash. */
export function phaseLine(p: RunPhases): PhaseLine {
  return {
    items: ORDER.map((phase) => {
      const sec = p.slots[phase];
      return {
        phase, name: NAME[phase],
        text: sec === null ? NONE : formatDuration(sec),
        state: phase === p.phase ? 'running' : sec === null ? 'future' : 'done',
      };
    }),
    total: formatDuration(p.totalSec),
  };
}
