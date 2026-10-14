<script lang="ts">
  import { onMount } from 'svelte';
  import { boot } from './boot';
  import { installDrag } from './drag';
  import { installKeyboard } from './keyboard';
  import Panel from './Panel.svelte';
  import { app } from './state.svelte';
  import Strip from './Strip.svelte';
  import { scaleFactor } from './vm/ui-scale';

  // The scale of the whole window: the root is zoomed, and everything in it with it (the theme is in px, nothing is laid out again).
  const scale = $derived(scaleFactor(app.uiScalePct));

  // `bind:this` is `undefined` before the element exists and `null` after it has gone
  let root = $state<HTMLDivElement | null>();

  onMount(() => {
    const element = root;
    if (!element) return;
    let disposed = false;
    let unwatch: (() => void) | undefined;
    const stopKeyboard = installKeyboard(app.keyboard, app.log, (gone) => app.showKeyboardGone(gone));
    // the grip moves the window without taking the focus (no `startDragging()`, no keyboard)
    const stopDrag = installDrag({
      begin: () => app.dragBegin(),
      move: (rect) => app.dragMove(rect),
      end: (rect) => app.dragEnd(rect),
    });

    // The window is exactly as big as this root. Every change of its size goes to the window, at most
    // once per frame; the content is measured in CSS pixels and rounded up so that nothing is cut off.
    // `getBoundingClientRect` measures on the screen, zoom included (width × scale); the observer below reports the size in the
    // root's own pixels, which a change of the scale does not change, so a change of the scale is measured by the state (`#refit`).
    // This relies on the standard CSS zoom (Chromium / WebView2 128 or newer): there `getBoundingClientRect` returns the zoomed size.
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
  The scale of the window is the CSS `zoom` of this root (the setting «Масштаб», `app.uiScalePct`): every length of the root and
  of what is inside it, its own width and limits included, is multiplied by it. So the window is `--sc-panel-w` × the scale wide,
  and the limits of the monitor, which are in screen pixels, are divided by the scale below. At 100 % there is no `zoom` at all.
-->
<div
  class="sc-root sc-frame"
  bind:this={root}
  data-float-host
  data-mode={app.mode}
  data-corner={app.settings.stripCorner}
  style:--sc-panel-w="{app.settings.panelWidth}px"
  style:--sc-ui-scale={scale}
  style:zoom={scale === 1 ? undefined : scale}
>
  <!-- drawn anew when the language changes (version 1.3): every text of the window is said again in the new one -->
  {#key app.language}
    {#if app.mode === 'mini'}
      <Strip />
    {:else}
      <Panel />
    {/if}
  {/key}
</div>

<style>
  /* Fixed to the corner of the window, so while the window catches up with a change of size the content
     stays where it is instead of jumping. */
  .sc-root {
    position: fixed;
    display: flex;
    flex-direction: column;
    /* The limits of the monitor are in screen pixels; the zoom of the root multiplies a length written here, so they are divided by it
       (a limit the window layer has not set yet leaves the custom property invalid, and `none` stays). */
    --own-max-w: calc(var(--sc-max-w) / var(--sc-ui-scale, 1));
    --own-max-h: calc(var(--sc-max-h) / var(--sc-ui-scale, 1));
    max-width: var(--own-max-w, none);
    max-height: var(--own-max-h, none);
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
