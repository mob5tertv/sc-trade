<script lang="ts">
  import { onMount } from 'svelte';
  import { boot } from './boot';
  import { installDrag } from './drag';
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
    // the grip moves the window without taking the focus (no `startDragging()`, no keyboard)
    const stopDrag = installDrag({
      begin: () => app.dragBegin(),
      move: (rect) => app.dragMove(rect),
      end: (rect) => app.dragEnd(rect),
    });

    // The window is exactly as big as this root. Every change of its size goes to the window, at most
    // once per frame; the content is measured in CSS pixels and rounded up so that nothing is cut off.
    let frame = 0;
    const size = () => {
      const { width, height } = element.getBoundingClientRect(); // forces the layout, painting or not
      return { width: Math.ceil(width), height: Math.ceil(height) };
    };
    const measure = (): void => {
      frame = 0;
      app.fit(size());
    };
    const observer = new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    // a hidden window paints nothing, so nothing reports its size; the state asks for it before it shows the window
    app.setRootMeasurer(size);

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
      stopDrag();
      app.setRootMeasurer(null);
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
  screen or of the window. It carries the glass and the frame with the cut corners (`.sc-frame`): nothing inside
  paints a background of its own. The mini line is as wide as its content; the expanded view is `panelWidth` wide
  and as tall as its content, up to `--sc-max-h` (the window layer sets both limits from the monitor).
  `data-float-host`: the lists that open from a field (`SearchBox`) ask this root to be tall enough to hold them.
-->
<div
  class="sc-root sc-frame"
  bind:this={root}
  data-float-host
  data-mode={app.mode}
  data-corner={app.settings.stripCorner}
  style:--sc-panel-w="{app.settings.panelWidth}px"
>
  {#if app.mode === 'mini'}
    <Strip />
  {:else}
    <Panel />
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
    min-height: var(--sc-float-min-h, 0);
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
</style>
