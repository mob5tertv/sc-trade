<script lang="ts">
  import { onMount } from 'svelte';
  import { boot } from './boot';
  import { installKeyboard } from './keyboard';
  import Panel from './Panel.svelte';
  import { app } from './state.svelte';
  import Strip from './Strip.svelte';

  let root = $state<HTMLDivElement>();

  onMount(() => {
    const element = root;
    if (element === undefined) return;
    let disposed = false;
    let unwatch: (() => void) | undefined;
    const stopKeyboard = installKeyboard(app.keyboard, app.log);

    // The window is exactly as big as this root. Every change of its size goes to the window, at most
    // once per frame; the content is measured in CSS pixels and rounded up so that nothing is cut off.
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const { width, height } = element.getBoundingClientRect();
      app.fit({ width: Math.ceil(width), height: Math.ceil(height) });
    };
    const observer = new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    });
    observer.observe(element);

    // The cursor over the window is activity (the window does not fold under it); leaving starts the idle time.
    const inside = (): void => app.pointer(true);
    const outside = (): void => app.pointer(false);
    element.addEventListener('pointerenter', inside);
    element.addEventListener('pointermove', inside);
    element.addEventListener('pointerdown', inside);
    element.addEventListener('pointerleave', outside);

    void (async () => {
      // Subscribed before the first show so that its focus changes are logged too.
      const stop = await app.watchWindow();
      if (disposed) stop();
      else unwatch = stop;
      await boot();
    })();

    return () => {
      disposed = true;
      unwatch?.();
      stopKeyboard();
      observer.disconnect();
      cancelAnimationFrame(frame);
      element.removeEventListener('pointerenter', inside);
      element.removeEventListener('pointermove', inside);
      element.removeEventListener('pointerdown', inside);
      element.removeEventListener('pointerleave', outside);
    };
  });
</script>

<!--
  The root is the whole interface and the window is as big as it: nothing here depends on the size of the
  screen or of the window. The mini bar is as wide as its content; the expanded view is `panelWidth` wide
  and as tall as its content, up to `--sc-max-h` (the window layer sets both limits from the monitor).
-->
<div
  class="sc-root"
  bind:this={root}
  data-mode={app.mode}
  data-corner={app.settings.stripCorner}
  style:--sc-panel-w="{app.settings.panelWidth}px"
>
  {#if app.mode === 'mini'}
    <Strip />
  {:else if app.phase === 'ready'}
    <Panel />
  {:else}
    <!-- the expanded view while the application starts or when the start failed -->
    <main>
      <header>
        <strong>SC Trade</strong>
        <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
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
</div>

<style>
  /* Fixed to the corner of the window, so while the window catches up with a change of size the content
     stays where it is instead of jumping. */
  .sc-root {
    position: fixed;
    display: flex;
    flex-direction: column;
    max-width: var(--sc-max-w, none);
    max-height: var(--sc-max-h, none);
  }

  .sc-root[data-corner^='top'] {
    top: 0;
  }

  .sc-root[data-corner^='bottom'] {
    bottom: 0;
  }

  .sc-root[data-corner$='left'] {
    left: 0;
  }

  .sc-root[data-corner$='right'] {
    right: 0;
  }

  .sc-root[data-mode='mini'] {
    width: max-content;
  }

  .sc-root[data-mode='expanded'] {
    width: var(--sc-panel-w);
  }

  main {
    flex: 1 1 auto;
    min-height: 0;
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
