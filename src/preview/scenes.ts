import type { app } from '../ui/state.svelte';
import type { DatasetName } from './datasets';

/** The one state of the application; scenes drive it only through its public methods. */
export type SceneApp = typeof app;

export interface Scene {
  /** The value of the `scene=` parameter. */
  name: string;
  /** What the scene shows, for the selector of the desktop page (Russian). */
  title: string;
  /** The test data the database is filled with (`seed.ts`). */
  dataset: DatasetName;
  /** What happens after the application has started and settled: open the panel, switch a tab, and so on. */
  act?: (app: SceneApp) => Promise<void> | void;
}

// To add a scene: one more entry below. To add a dataset: `datasets.ts` and `seed.ts`.
export const SCENES: readonly Scene[] = [
  { name: 'strip', title: 'Полоска, без рейса', dataset: 'default' },
  { name: 'strip-run', title: 'Полоска в рейсе', dataset: 'run' },
  { name: 'panel', title: 'Панель, вкладка по умолчанию', dataset: 'default', act: (app) => app.openPanel('preview') },
  {
    name: 'settings',
    title: 'Панель, настройки',
    dataset: 'default',
    act: async (app) => {
      await app.openPanel('preview');
      app.setTab('settings');
    },
  },
  { name: 'boot-failed', title: 'Ошибка запуска: пустая база, UEX недоступен', dataset: 'empty', act: (app) => app.openPanel('preview') },
];

export const DEFAULT_SCENE = 'strip';

export const findScene = (name: string): Scene | undefined => SCENES.find((scene) => scene.name === name);
