import type { RouteOption } from '../../src/core/routes';
import type { Settings } from '../../src/core/settings';
import type { Reference } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { loadSettings } from '../../src/data/repo/settings';
import { loadReference } from '../../src/data/repo/uex-cache';
import { loadMarket, type SuggestDeps, type Suggestion, type SuggestProgress, type SuggestRun } from '../../src/data/suggest';
import { createUexClient } from '../../src/data/uex-client';
import { prepareAnyDataset } from '../../src/preview/prepare';
import type { LookupFlow } from '../../src/ui/vm/lookup-flow';
import type { Cell } from '../../src/ui/vm/terminal-rows';
import { terminalRows } from '../../src/ui/vm/terminal-rows';
import type { SideRow } from '../../src/ui/vm/terminal-side';
import { testDb } from './test-db';

// Fixtures of the window layout tasks (the one-line header, the sections, the two-step lookup).

/** The moment the preview data of the window layout is made and read. */
export const WINDOW_NOW = 1_800_000_000;

export interface WindowData { db: Db; reference: Reference; settings: Settings; deps: SuggestDeps }

/**
 * The `window` dataset of the preview in Node: a real SQLite database filled by the real seed, with the loaders and the
 * suggestion services behind it and a UEX client that is offline (the dataset holds every distance, so a suggestion
 * must not reach for the network).
 */
export async function windowData(now: number = WINDOW_NOW): Promise<WindowData> {
  const db = testDb();
  await prepareAnyDataset(db, 'window', now);
  const log = createLogger(memorySink());
  const reference = await loadReference(db);
  const settings = await loadSettings(db, log);
  const uex = createUexClient(async () => { throw new Error('offline'); }, log);
  return { db, reference, settings, deps: { db, uex, log, now: () => now, reference, settings, ownMedian: new Map() } };
}

/** The rows of the table of a terminal, as the window draws them. */
export async function rowsOf(data: WindowData, terminalId: number, now: number = WINDOW_NOW) {
  const { settings } = data;
  return terminalRows(await loadMarket(data.db), data.reference, terminalId, {
    now, thresholds: { hotMin: settings.hotMin, warmMin: settings.warmMin, coolingMin: settings.coolingMin },
    serverChangedAt: settings.serverChangedAt, refillFullMin: settings.refillFullMin,
  });
}

/** A row of the terminal table as far as the layout cares: which sides it has. The cells are not looked into. */
export function sideRow(commodityId: number, sides: { buy?: boolean; sell?: boolean }): SideRow {
  return { commodityId, buy: sides.buy ? ({} as Cell) : null, sell: sides.sell ? ({} as Cell) : null };
}

/** A trip as far as the layout cares (it only carries it around). */
export function option(commodityId: number): RouteOption {
  return { commodityId } as RouteOption;
}

export const CACHED_ANSWER: Suggestion = { options: [option(1), option(2)], missing: 3 };
export const FINAL_ANSWER: Suggestion = { options: [option(2), option(1), option(3)], missing: 0 };

/**
 * A lookup flow made of recording fakes. Each fake answers what its property says; `events` lists what the flow did,
 * in order, and `runs` the modes it asked for.
 */
export interface FlowHarness {
  flow: LookupFlow;
  events: string[];
  /** The `distances` mode of every `suggest` call, in order. */
  runs: Array<SuggestRun['distances']>;
  /** Set to make a step wait; call the returned function to let it go on. */
  hold: { first?: Promise<void>; second?: Promise<void> };
  state: {
    newest: boolean;
    capacity: boolean;
    firstAnswer: Suggestion | Error;
    secondAnswer: Suggestion | Error;
    progress: SuggestProgress[];
    /** The UEX queue is busy: its jobs wait until this is set free. */
    queueBusy: Promise<void> | null;
  };
}

export function flowHarness(): FlowHarness {
  const events: string[] = [];
  const runs: Array<SuggestRun['distances']> = [];
  const hold: FlowHarness['hold'] = {};
  const state: FlowHarness['state'] = {
    newest: true, capacity: true, firstAnswer: CACHED_ANSWER, secondAnswer: FINAL_ANSWER, progress: [], queueBusy: null,
  };

  const flow: LookupFlow = {
    async suggest(run) {
      const mode = run.distances ?? 'fetch';
      runs.push(mode);
      events.push(`suggest:${mode}`);
      if (mode === 'cached') {
        await hold.first;
        if (state.firstAnswer instanceof Error) throw state.firstAnswer;
        return state.firstAnswer;
      }
      for (const point of state.progress) run.onProgress?.(point);
      await hold.second;
      if (state.secondAnswer instanceof Error) throw state.secondAnswer;
      return state.secondAnswer;
    },
    async withUex(job) {
      events.push('queue:wait');
      await state.queueBusy;
      events.push('queue:run');
      return job();
    },
    isNewest: () => state.newest,
    canRun: () => state.capacity,
    show: {
      answer: (options, preliminary) => events.push(`answer:${options.map((o) => o.commodityId).join('')}:${preliminary ? 'preliminary' : 'final'}`),
      progress: (p) => events.push(`progress:${p.done}/${p.total}`),
      failed: () => events.push('failed'),
      refineFailed: () => events.push('refine-failed'),
    },
  };
  return { flow, events, runs, hold, state };
}
