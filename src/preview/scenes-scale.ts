import type { DatasetName } from './datasets';
import type { Scene } from './scenes';

// The scenes of the scale of the window (the setting «Масштаб»): the scenes that show the whole interface, each one at 125 and at
// 150 %. A scale scene sets the scale and then does what its base scene does, so the window is fitted to the zoomed content the
// way the player's own change of the field fits it. The data and the monitor of a scale scene are those of its base: they are
// repeated here (a scene holds them as plain fields), and tests/preview/scenes-scale.test.ts fails when they drift apart.
//
// The scale can also be changed on the fly in any scene, the way the player does it, with a step of the picture command:
//   --scene settings-open-all --do "eval:(() => { const f = document.getElementById('set-ui-scale'); f.value = '125'; f.dispatchEvent(new Event('change', { bubbles: true })); })()"
// and «Авто» shows what it picks on the monitor: the same scene with `--monitor 1920x1080@1`, `2560x1440@1`, `3840x2160@1.5`.

export const SCALE_PERCENTS = [125, 150] as const;

interface ScaleBase {
  /** The name of the scene whose act runs after the scale is set. */
  base: string;
  /** What the scene says it shows. */
  what: string;
  dataset: DatasetName;
  monitor?: string;
}

export const SCALE_BASES: readonly ScaleBase[] = [
  { base: 'mini', what: 'мини-строка', dataset: 'default' },
  { base: 'mini-run', what: 'мини-строка в рейсе', dataset: 'run' },
  { base: 'expanded', what: 'развёрнутый вид', dataset: 'default' },
  { base: 'settings-open-all', what: 'настройки, все группы открыты', dataset: 'default' },
  { base: 'expanded-tall', what: 'таблица на мониторе 1366×768: прокручивается внутри окна', dataset: 'window', monitor: '1366x768@1' },
];

export const scaleSceneName = (base: string, percent: number): string => `${base}-scale-${percent}`;

export const SCALE_SCENES: readonly Scene[] = SCALE_BASES.flatMap(({ base, what, dataset, monitor }) =>
  SCALE_PERCENTS.map((percent): Scene => ({
    name: scaleSceneName(base, percent),
    title: `Масштаб ${percent} %: ${what}`,
    dataset,
    ...(monitor === undefined ? {} : { monitor }),
    act: async (app) => {
      await app.updateSetting('uiScale', percent);
      // looked up when the scene runs: the scene list imports this file, so it cannot be read while this file is loaded
      const { findScene } = await import('./scenes');
      await findScene(base)?.act?.(app);
    },
  })),
);
