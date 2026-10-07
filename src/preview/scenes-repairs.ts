import { installHttpFake, type FakeAnswer } from './http-fake';
import type { Scene, SceneApp } from './scenes';

// The scenes of task 35, the repairs after the review of the whole branch: places where the state and the screens met badly.
// They run inside the page, as the scenes of `scenes.ts` do (that module imports this one, hence only the type comes from it).

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ok = (data: unknown): FakeAnswer => ({ status: 200, body: { status: 'ok', data } });

// ids of the preview data: terminals HUR-L1 3, ARC-L1 1; the run of `run-loading` bought at HUR-L1 and goes to ARC-L1
const HUR_L1 = 3;

/** The distance from the place of the purchase of the run (HUR-L1) to its target (ARC-L1) is not stored: the time of the run is not known. */
async function forgetTheFlight(app: SceneApp): Promise<void> {
  await app.suggestDeps().db.execute('DELETE FROM uex_distance WHERE terminal_a_id = 1 AND terminal_b_id = 3');
  await app.loadFromDb();
}

export const REPAIR_SCENES: readonly Scene[] = [
  {
    // a few minutes after the purchase, the flight to the target is not known: the line says what the cargo is expected to
    // sell for (the profit), and no «≈ …/ч» (the seconds since the purchase are not the time of the run)
    name: 'mini-run-unknown-flight',
    title: 'Мини-строка в рейсе, время полёта до цели неизвестно: ожидание есть, «≈ …/ч» нет',
    dataset: 'run-loading',
    act: forgetTheFlight,
  },
  {
    name: 'run-unknown-flight',
    title: '«Рейс» развёрнут, время полёта до цели неизвестно: прибыль и ROI «≈», в UEC/ч прочерк',
    dataset: 'run-loading',
    act: async (app) => {
      await forgetTheFlight(app);
      await app.expand('preview');
      await app.toggleSection('run');
    },
  },
  {
    // The distance from the place of the purchase to the target is not stored, so the rate of the run is not known: the mini
    // line shows no «≈ …/ч». A lookup from HUR-L1 fetches the distance from UEX (the scene's network answers for it) and stores
    // it; from then on the state counts with it, and the number is there (`--do "eval:..."`: `app.distances.size`, `app.strip.rate`).
    name: 'lookup-fetches-distances',
    title: 'Рейс без известного расстояния до цели; поиск догружает его с UEX, и число «≈ …/ч» появляется без других действий',
    dataset: 'run-loading',
    act: async (app) => {
      await forgetTheFlight(app);
      installHttpFake((url) => (url.includes('commodities_routes') ? ok([]) : ok({ distance: 31.5 })));
      await app.expand('preview');
      await app.runLookup({ kind: 'from', terminalId: HUR_L1, commodityId: null, price: null });
      await pause(300);
    },
  },
];
