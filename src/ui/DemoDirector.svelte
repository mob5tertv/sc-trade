<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from './state.svelte';
  import { demoAdvance, demoCoach, type DemoView } from './vm/demo';
  import { terminalLabel } from './vm/terminal-name';

  // The demo trip of version 1.3 as it goes: five times a second the window is read into a `DemoView` (the state, and what the
  // screen shows of the row, the form and the options), the step moves on when its condition is met (`demoAdvance`), and the hint of
  // the step is put on the screen (`demoCoach`, drawn by `CoachBubble.svelte`). Nothing is drawn here.

  let hadRun = false;
  let shown = '';

  const exists = (selector: string): boolean => document.querySelector(selector) !== null;

  function view(): DemoView {
    const strip = app.strip;
    const run = app.activeRun === null ? 'none' : strip.kind === 'run' ? strip.phase : 'loading';
    if (run !== 'none') hadRun = true;
    const targetId = app.settings.targetTerminalId;
    return {
      mode: app.mode,
      locationId: app.settings.currentTerminalId,
      viewedId: app.viewTerminalId,
      lookupCommodityId: app.lookup.request?.commodityId ?? null,
      targetId,
      targetName: targetId === null ? '' : terminalLabel(app.reference, targetId),
      run,
      hadRun,
      openRow: document.querySelector('[data-tour-open]')?.getAttribute('data-tour-open') ?? null,
      formOpen: exists('form.trade'),
    };
  }

  const actions = {
    begin: () => app.demoGo(1),
    leave: () => void app.endDemo('left'),
    finish: () => void app.endDemo('done'),
  };

  function tick(): void {
    const demo = app.demo;
    if (demo === null) return;
    const v = view();
    const step = demoAdvance(demo.step, v);
    if (step !== demo.step) app.demoGo(step);
    const coach = demoCoach(step, v, exists, { ...actions, newPlayer: demo.newPlayer });
    // only a hint that changed is put on the screen again: the frame of its element would restart its breathing five times a second
    const key = JSON.stringify([coach.target, coach.title, coach.text, coach.doing, coach.step, app.language]);
    if (key === shown) return;
    shown = key;
    app.coach = coach;
  }

  const timer = setInterval(tick, 200);
  tick();
  onDestroy(() => {
    clearInterval(timer);
    app.coach = null;
  });
</script>
