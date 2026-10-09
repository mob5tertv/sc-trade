import type { Scene, SceneApp } from './scenes';

// The scenes of the clearing of the history of runs (spec 14.14): "Настройки" → "Данные" with the status line and the two buttons.
// The `stats-old` dataset has runs that ended more than thirty days ago (and the one that began 31 days ago and ended 29 days ago),
// `stats` has none that old, `no-runs` has no run at all, `run` has two finished runs and one that is going. The clearing itself is
// driven with `--do`:  `click:[data-clear=old];click:.ask .yes;wait:600`  (the buttons carry `data-clear`, the question is `.ask`).
// The list is added to `SCENES` in `scenes.ts`.

/** The window expanded, the settings open, and the group «Данные» unfolded. */
async function openData(app: SceneApp): Promise<void> {
  await app.expand('preview');
  app.openSettings();
  await app.toggleSection('settings:data');
}

/**
 * The next `times` statements of the database that begin with `prefix` fail like a full disk (the SQL of the preview goes through
 * `fetch`, so the page answers for the server). Installed AFTER the start, so the sweep of the leftovers at the start is not the one that fails.
 */
function failStatements(prefix: string, times: number): void {
  const real = window.fetch.bind(window);
  let left = times;
  window.fetch = async (input, init) => {
    const request = typeof init?.body === 'string' && String(input).endsWith('/__preview/sql') ? (JSON.parse(init.body) as { op?: string; query?: string }) : null;
    if (request?.op === 'execute' && request.query?.startsWith(prefix) && left > 0) {
      left--;
      return new Response(JSON.stringify({ ok: false, error: 'disk full' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  };
}

export const CLEAR_SCENES: readonly Scene[] = [
  {
    name: 'settings-history',
    title: 'Настройки → Данные: в истории 46 рейсов, семь из них старше 30 дней (обе кнопки очистки)',
    dataset: 'stats-old',
    act: openData,
  },
  {
    name: 'settings-history-recent',
    title: 'Настройки → Данные: в истории нет рейсов старше 30 дней (кнопка «Очистить старше 30 дней» не видна)',
    dataset: 'stats',
    act: openData,
  },
  {
    // the second statement of the clearing fails once: the service tries it again, and the player sees the usual notice
    name: 'settings-history-retry',
    title: 'Очистка истории: второй запрос упал один раз, сервис повторил его, игрок видит обычное «Удалено N рейсов»',
    dataset: 'stats-old',
    act: async (app) => {
      await openData(app);
      failStatements('DELETE FROM run WHERE', 1);
    },
  },
  {
    // the second statement fails twice: the events are gone, the runs stay as empty rows, the notice says so and what to do
    name: 'settings-history-partial',
    title: 'Очистка истории: второй запрос упал дважды, события удалены, пустые рейсы остались; сообщение об ошибке, кнопки на месте',
    dataset: 'stats-old',
    act: async (app) => {
      await openData(app);
      failStatements('DELETE FROM run WHERE', 2);
    },
  },
  {
    name: 'settings-history-empty',
    title: 'Настройки → Данные: «История пуста», кнопок очистки нет',
    dataset: 'no-runs',
    act: openData,
  },
  {
    name: 'settings-history-run',
    title: 'Настройки → Данные при идущем рейсе: в истории два рейса (идущий не считается); «Очистить всю историю» оставляет идущий рейс',
    dataset: 'run',
    act: openData,
  },
];
