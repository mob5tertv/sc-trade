import type { Corner } from '../core/layout';
import type { Scene, SceneApp } from './scenes';

// Scenes for the anchor of a dragged window: the window stands by its TOP edge, unfolds downward, and is shifted onto
// the screen (not shrunk) when it does not fit from its anchor. The numbers are for a monitor of 2560x1440 at scale 1,
// the one of the player's log: shoot them with `--monitor 2560x1440@1`. A real drag is a step of the picture
// command: `--do "drag:[data-drag]:-300,700"`.

/** Saves the anchor the way a drag does (corner and the two distances), without a drag. */
async function anchorAt(app: SceneApp, corner: Corner, dx: number, dy: number): Promise<void> {
  await app.updateSetting('stripCorner', corner);
  await app.updateSetting('windowDx', dx);
  await app.updateSetting('windowDy', dy);
}

export const ANCHOR_SCENES: readonly Scene[] = [
  {
    // the case of the log: the window of 440x642 dropped at x=101, y=627. The mini line must stand at y=627 (it stood at 1241)
    name: 'anchor-expanded-low',
    title: 'Окно в нижней половине экрана, якорь сверху слева 101/627, развёрнуто (--monitor 2560x1440@1)',
    dataset: 'default',
    act: async (app) => {
      await anchorAt(app, 'top-left', 101, 627);
      await app.expand('preview');
    },
  },
  {
    // the mini line near the bottom edge: the expanded window does not fit below it, so it is shifted up whole
    name: 'anchor-mini-bottom',
    title: 'Мини-строка у нижнего края, якорь сверху слева 101/1400; развернуть — окно сдвинется вверх (--monitor 2560x1440@1)',
    dataset: 'default',
    act: (app) => anchorAt(app, 'top-left', 101, 1400),
  },
  {
    // a left anchor near the right edge (a stored setting; a drag gives a right anchor there): the expanded window is shifted left
    name: 'anchor-mini-far-right',
    title: 'Мини-строка с левым якорем у правого края, 2300/100; развернуть — окно сдвинется влево (--monitor 2560x1440@1)',
    dataset: 'default',
    act: (app) => anchorAt(app, 'top-left', 2300, 100),
  },
];
