<script lang="ts">
  import { app } from './state.svelte';
  import { stripModel } from './vm/strip';

  // While the application starts, or when the start failed, the bar says so instead of the location.
  const text = $derived.by(() => {
    if (app.phase === 'booting') return app.bootStatus;
    if (app.phase === 'failed') return 'Ошибка запуска, нажмите';
    const model = stripModel(app.activeRun, app.market, app.reference, app.settings, app.routeCtx());
    // The content of a run on the bar comes with the run screens; until then only the essentials.
    return model.kind === 'idle' ? model.location : [model.timer, model.cargo].filter((part) => part !== '').join(' · ');
  });
</script>

<button class="strip" type="button" title={text} onclick={() => app.expand('mini click')}>
  <span class="brand">SC</span>
  <span class="text">{text}</span>
</button>

<style>
  /* One line, as wide as its text (the root limits it to the monitor). Clicking it expands the window; the
     window is not focusable, so the click does not take the keyboard from the game. */
  .strip {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--sc-gap);
    min-width: 0;
    height: 26px;
    margin: 0;
    padding: 0 12px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-bg);
    color: var(--sc-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }

  .strip:hover {
    background: color-mix(in srgb, var(--sc-bg), white 8%);
  }

  .brand {
    flex: none;
    color: var(--sc-accent);
    font-weight: 700;
  }

  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
