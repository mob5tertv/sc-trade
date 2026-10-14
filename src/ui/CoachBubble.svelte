<script lang="ts">
  import { tr } from '../i18n';
  import { app } from './state.svelte';

  // The hint of the demo trip (version 1.3, the author: «подсказки должны быть со стрелками, показывающими элементы интерфейса»).
  // A bubble with an arrow at the element of the window it speaks of (`app.coach.target`, a CSS selector); that element is framed.
  // Unfolded, the bubble lies over the window, under the element when there is room and above it otherwise; on the mini line,
  // which is as tall as its one line, it stands under the line and makes the window taller. Without a target it is a card in the
  // middle of the window.

  let bubble = $state<HTMLDivElement | null>(null);
  let place = $state<{ left: number; top: number; arrow: number; below: boolean } | null>(null);
  const coach = $derived(app.coach);
  const mini = $derived(app.mode === 'mini');

  $effect(() => {
    const current = coach;
    const element = bubble;
    if (current === null || element === null) return;
    const target = current.target === null ? null : document.querySelector<HTMLElement>(current.target);
    target?.classList.add('sc-tour-target');
    let frame = requestAnimationFrame(function measure() {
      const root = element.closest<HTMLElement>('.sc-root');
      if (root === null) return;
      const box = root.getBoundingClientRect();
      const zoom = box.width / root.offsetWidth || 1; // the root is zoomed by the scale of the window: positions inside it are not
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (target === null) {
        const top = Math.max(8, (root.offsetHeight - height) / 2);
        root.style.setProperty('--sc-coach-min-h', `${Math.ceil(top + height + 8)}px`);
        place = { left: (root.offsetWidth - width) / 2, top, arrow: -1, below: true };
        return;
      }
      const t = target.getBoundingClientRect();
      const centre = (t.left + t.width / 2 - box.left) / zoom;
      if (mini) {
        place = { left: 0, top: 0, arrow: Math.min(Math.max(centre - 8, 12), width - 28), below: true };
      } else {
        const left = Math.min(Math.max(centre - width / 2, 8), root.offsetWidth - width - 8);
        const under = (t.bottom - box.top) / zoom + 10;
        const over = (t.top - box.top) / zoom - height - 10;
        // under the element, unless it stands low in the window and the bubble fits above it; the window grows to hold the bubble
        const below = over < 4 || (t.top + t.height / 2 - box.top) / zoom < root.offsetHeight * 0.55;
        const top = below ? under : over;
        root.style.setProperty('--sc-coach-min-h', `${Math.ceil(top + height + 8)}px`);
        place = { left, top, arrow: Math.min(Math.max(centre - left - 8, 12), width - 28), below };
      }
      frame = requestAnimationFrame(measure); // the window moves under it (a list grows, the window refits): follow it
    });
    return () => {
      cancelAnimationFrame(frame);
      target?.classList.remove('sc-tour-target');
      element.closest<HTMLElement>('.sc-root')?.style.removeProperty('--sc-coach-min-h');
    };
  });
</script>

{#if coach !== null}
  <div
    class="coach sc-reveal"
    class:mini
    class:card={coach.target === null}
    bind:this={bubble}
    role="dialog"
    aria-labelledby="coach-title"
    style:left={mini || place === null ? undefined : `${place.left}px`}
    style:top={mini || place === null ? undefined : `${place.top}px`}
    style:visibility={place === null && !mini ? 'hidden' : undefined}
  >
    {#if place !== null && place.arrow >= 0}
      <span class="arrow" class:up={place.below} class:down={!place.below} style:left="{place.arrow}px"></span>
    {/if}
    <div class="head">
      <strong id="coach-title">{coach.title}</strong>
      <span class="count sc-label">{coach.step} / {coach.total}</span>
    </div>
    <p class="text">{coach.text}</p>
    {#if coach.doing}<p class="doing">{coach.doing}</p>{/if}
    <div class="actions">
      <button type="button" class="sc-btn sc-btn--ghost">{tr('Выйти из демо')}</button>
      {#if coach.button}<button type="button" class="sc-btn sc-btn--primary">{coach.button}</button>{/if}
    </div>
  </div>
{/if}

<style>
  .coach {
    position: absolute;
    z-index: 30;
    width: min(300px, calc(100% - 16px));
    padding: 8px 10px;
    border: 1px solid var(--sc-accent);
    background: var(--sc-bg-solid, #07121b);
    box-shadow: 0 4px 18px rgb(0 0 0 / 55%);
  }

  .coach.card {
    width: min(340px, calc(100% - 16px));
  }

  /* on the mini line: under the line, in the flow of the window, which grows to hold it */
  .coach.mini {
    position: relative;
    /* as wide as the line, never wider: a width of its own would widen the window, which is as wide as its content */
    width: 0;
    min-width: calc(100% - 12px);
    margin: 10px 6px 6px;
  }

  .arrow {
    position: absolute;
    width: 0;
    height: 0;
    border-right: 8px solid transparent;
    border-left: 8px solid transparent;
  }

  .arrow.up {
    top: -9px;
    border-bottom: 9px solid var(--sc-accent);
  }

  .arrow.down {
    bottom: -9px;
    border-top: 9px solid var(--sc-accent);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sc-gap);
  }

  .head strong {
    color: var(--sc-accent);
  }

  .count {
    flex: none;
  }

  .text {
    margin: 4px 0 0;
    color: var(--sc-text);
  }

  .doing {
    margin: 4px 0 0;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sc-gap);
    margin-top: 6px;
  }
</style>
