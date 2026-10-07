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
  /** What happens after the application has started and settled: expand the window, open the settings, and so on. */
  act?: (app: SceneApp) => Promise<void> | void;
}

// To add a scene: one more entry below. To add a dataset: `datasets.ts` and `seed.ts`.
export const SCENES: readonly Scene[] = [
  { name: 'mini', title: 'Мини-строка, без рейса', dataset: 'default' },
  { name: 'mini-run', title: 'Мини-строка в рейсе', dataset: 'run' },
  {
    name: 'mini-bottom-left',
    title: 'Мини-строка в левом нижнем углу',
    dataset: 'default',
    act: async (app) => void (await app.setCorner('bottom-left')),
  },
  { name: 'expanded', title: 'Развёрнутый вид, вкладка по умолчанию', dataset: 'default', act: (app) => app.expand('preview') },
  {
    name: 'expanded-bottom-left',
    title: 'Развёрнутый вид в левом нижнем углу',
    dataset: 'default',
    act: async (app) => {
      await app.setCorner('bottom-left');
      await app.expand('preview');
    },
  },
  {
    // a short screen: the window is only as tall as it is
    name: 'expanded-short',
    title: 'Развёрнутый вид с коротким содержимым (вкладка «Рейс»)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setTab('run');
    },
  },
  {
    name: 'expanded-short-bottom-left',
    title: 'Короткое содержимое в левом нижнем углу',
    dataset: 'default',
    act: async (app) => {
      await app.setCorner('bottom-left');
      await app.expand('preview');
      app.setTab('run');
    },
  },
  {
    name: 'settings',
    title: 'Развёрнутый вид, настройки',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.openSettings();
    },
  },
  { name: 'boot-failed', title: 'Ошибка запуска: пустая база, UEX недоступен', dataset: 'empty', act: (app) => app.expand('preview') },
  {
    // The player has just clicked the mini bar, so the cursor is over the window. `hover:.sc-root;leave;wait:3000`
    // takes it away: the window folds 2 seconds later, unless the keyboard or a dialog holds it.
    name: 'idle',
    title: 'Развёрнутый вид, курсор над окном, сворачивается через 2 с после ухода курсора',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('idleCollapseSec', 2);
      await app.expand('preview');
      app.pointer(true);
    },
  },
];

export const DEFAULT_SCENE = 'mini';

export const findScene = (name: string): Scene | undefined => SCENES.find((scene) => scene.name === name);
