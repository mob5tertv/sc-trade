import type { Scene, SceneApp } from './scenes';

// The scenes of task 49 (version 1.1, the small things from the trader's review): the field of the location that sets "Я здесь" by
// Enter, the question "Где прилетел?". They run inside the page; `scenes.ts` imports this module, hence only the type comes from it.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where the window stands, for `--do "eval:window.__where()"`: the current location and the viewed terminal (ids: ARC-L1 1, HUR-L1 3, MIC-L1 4),
 * whether the field of the location asks "Где прилетел?", and the target.
 */
function watchWhere(app: SceneApp): void {
  (window as unknown as { __where: () => unknown }).__where = () => ({
    current: app.settings.currentTerminalId,
    viewed: app.viewTerminalId,
    asking: app.askingWhere,
    target: app.settings.targetTerminalId,
    running: app.activeRun !== null,
  });
}

export const TRADER_SCENES: readonly Scene[] = [
  {
    // HUR-L1 is the current location; `--do "click:header input;type:arc;press:Enter;eval:window.__where()"` makes ARC-L1 the viewed one AND the current one
    name: 'pick-no-run',
    title: 'Локация: без рейса Enter в поле делает выбранный терминал и просматриваемым, и текущей локацией',
    dataset: 'default',
    act: async (app) => {
      watchWhere(app);
      await app.expand('preview');
    },
  },
  {
    // a run is flying from HUR-L1 to ARC-L1: Enter only views (`press:Ctrl+Enter` is "Я здесь")
    name: 'pick-in-run',
    title: 'Локация: в рейсе Enter только смотрит терминал, Ctrl+Enter — «Я здесь»',
    dataset: 'run-flight',
    act: async (app) => {
      watchWhere(app);
      await app.expand('preview');
    },
  },
  {
    // the run is in the air, the target is taken away and the arrival is marked: nothing tells where the ship has landed
    name: 'arrived-no-target',
    title: 'После «Прилетел» без цели поле локации спрашивает «Где прилетел?»',
    dataset: 'run-flight',
    act: async (app) => {
      watchWhere(app);
      await app.setTarget(null);
      await app.mark('arrive');
      await app.expand('preview');
      await pause(100);
    },
  },
];
