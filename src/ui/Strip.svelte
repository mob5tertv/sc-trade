<script lang="ts">
  import { app } from './state.svelte';
  import { stripModel } from './vm/strip';

  // While the application starts, or when the start failed, the badge says so instead of the location.
  const text = $derived.by(() => {
    if (app.phase === 'booting') return app.bootStatus;
    if (app.phase === 'failed') return 'Ошибка запуска, нажмите';
    const model = stripModel(app.activeRun, app.market, app.reference, app.settings, app.routeCtx());
    // The content of a run on the strip comes with the run screens; until then only the essentials.
    return model.kind === 'idle' ? model.location : [model.timer, model.cargo].filter((part) => part !== '').join(' · ');
  });
</script>

<button class="strip" type="button" title={text} onclick={() => app.openPanel('strip click')}>
  <span class="brand">SC</span>
  <span class="text">{text}</span>
</button>

<style>
  /* The whole badge is the button and never takes the keyboard focus from the game: the window is not focusable. */
  .strip {
    display: flex;
    align-items: center;
    gap: var(--sc-gap);
    width: 100vw;
    height: 100vh;
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
