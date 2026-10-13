<script lang="ts">
  import StripView from './components/StripView.svelte';
  import { app } from './state.svelte';
  import WindowGrip from './WindowGrip.svelte';

  // While the application starts, or when the start failed, the line says so instead of the location; after that it is
  // the short message of an action (a mark that cannot be written, ...) for three seconds.
  const flash = $derived(app.phase === 'booting' ? app.bootStatus : app.phase === 'failed' ? 'Ошибка запуска' : app.flash);
  const model = $derived(app.strip);
  // the one button of the line: the mark that comes next by the phase of the run (none while unloading)
  const next = $derived(model.kind === 'run' ? model.next : null);
</script>

<!--
  The glass and the frame are the root's (`.sc-frame`). The grip is next to the line, not inside it: pressing it moves
  the window and does not expand it, and a click on the rest of the line expands. The mark button is a real button of
  the line: one click writes the mark, the window stays as it is and the game keeps the focus.
-->
<div class="mini">
  <WindowGrip divider />
  <StripView
    {model}
    {flash}
    flashKind={app.phase === 'failed' ? 'error' : app.flashKind}
    onOpen={() => app.expandByHand('mini click')}
    onDepart={next === 'depart' ? () => void app.mark('depart') : undefined}
    onArrive={next === 'arrive' ? () => void app.mark('arrive') : undefined}
    rangeStill={!app.settings.stripRangeTurns}
  />
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
