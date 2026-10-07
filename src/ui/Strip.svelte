<script lang="ts">
  import StripView from './components/StripView.svelte';
  import { app } from './state.svelte';
  import { stripModel, type StripModel } from './vm/strip';
  import WindowGrip from './WindowGrip.svelte';

  const NOTHING_YET: StripModel = { kind: 'idle', location: '' };

  // While the application starts, or when the start failed, the line says so instead of the location.
  const flash = $derived(app.phase === 'booting' ? app.bootStatus : app.phase === 'failed' ? 'Ошибка запуска' : null);
  const model = $derived(
    app.phase === 'ready' ? stripModel(app.activeRun, app.market, app.reference, app.settings, app.routeCtx()) : NOTHING_YET,
  );
</script>

<!--
  The glass and the frame are the root's (`.sc-frame`). The grip is next to the line, not inside it: pressing it moves
  the window and does not expand it, and a click on the rest of the line expands. The buttons of the marks of a run
  come with the run screens.
-->
<div class="mini">
  <WindowGrip divider />
  <StripView {model} {flash} flashKind={app.phase === 'failed' ? 'error' : 'info'} onOpen={() => app.expand('mini click')} />
</div>

<style>
  /* One line, as wide as its content (the root limits it to the monitor). The window is not focusable, so the click
     does not take the keyboard from the game. */
  .mini {
    display: flex;
    flex: 1 1 auto;
    align-items: stretch;
    min-width: 0;
  }
</style>
