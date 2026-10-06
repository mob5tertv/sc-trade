<script lang="ts">
  import { onMount } from 'svelte';
  import { boot } from './boot';
  import Panel from './Panel.svelte';
  import { app } from './state.svelte';
  import Strip from './Strip.svelte';

  // Esc collapses the panel (the focus is not pulled back by force; the player is in the panel).
  // A key that another handler already used (the list of a search box) does not count.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.defaultPrevented && app.mode === 'panel') {
      void app.closePanel('escape');
    }
  }

  onMount(() => {
    let disposed = false;
    let unwatch: (() => void) | undefined;

    void (async () => {
      // Subscribed before the first mode change so that its focus changes are logged too.
      const stop = await app.watchWindow();
      if (disposed) stop();
      else unwatch = stop;
      await boot();
    })();

    return () => {
      disposed = true;
      unwatch?.();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if app.mode === 'strip'}
  <Strip />
{:else if app.phase === 'ready'}
  <Panel />
{:else}
  <!-- the panel while the application starts or when the start failed -->
  <main>
    <header>
      <strong>SC Trade</strong>
      <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Закрыть" title="Закрыть (Esc)" onclick={() => app.closePanel('close button')}>
        ×
      </button>
    </header>
    {#if app.phase === 'failed'}
      <p class="error" role="alert">{app.bootError}</p>
      <p>
        <button class="sc-btn" type="button" onclick={() => { app.log.info('ui', 'retry start'); void boot(); }}>Повторить</button>
      </p>
    {:else}
      <p class="status" role="status">{app.bootStatus}</p>
    {/if}
  </main>
{/if}

<style>
  main {
    width: 100vw;
    height: 100vh;
    padding: var(--sc-gap) calc(var(--sc-gap) * 1.5);
    background: var(--sc-bg);
    border-left: 1px solid var(--sc-border);
    border-right: 1px solid var(--sc-border);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .error {
    color: var(--sc-bad);
  }

  .status {
    color: var(--sc-muted);
  }
</style>
