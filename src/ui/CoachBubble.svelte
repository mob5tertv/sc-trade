<script lang="ts">
  import { app } from './state.svelte';

  // The hint of the demo trip (version 1.3, the author: «подсказки должны быть со стрелками, показывающими элементы интерфейса»).
  // A bubble, and a line with an arrow from it to the element of the window it speaks of (`app.coach.target`, a CSS selector), which
  // is framed. The bubble covers nothing the player needs (the author of build c: «дроп-даун находится под подсказкой обучения,
  // выбрать невозможно»; «терминал под окном обучения»): unfolded, it stands under everything the window shows, a list that opens
  // from a field included, and the window grows to hold it; on the mini line it stands under the line. Without a target it is a card
  // in the middle of the window (the first and the last step, where nothing is to be pressed in the window).

  interface Place {
    left: number;
    top: number;
    /** Where along the top edge of the bubble the line starts. */
    arrow: number;
    /** How long the line is: from the top edge of the bubble up to the element. */
    reach: number;
  }

  let bubble = $state<HTMLDivElement | null>(null);
  let place = $state<Place | null>(null);
  const coach = $derived(app.coach);
  const mini = $derived(app.mode === 'mini');

  const GAP = 18; // between what the window shows and the bubble: room for the head of the arrow

  $effect(() => {
    const current = coach;
    const element = bubble;
    if (current === null || element === null) return;
    // The root is taken now, while the bubble is in it: when the hint goes away for good (the end of the demo) Svelte takes the bubble out
    // of the page before the cleanup below runs, and the bubble could not find the root any more to take its height back (1.3.0: every
    // mini line after the demo was as tall as the last hint).
    const root = element.closest<HTMLElement>('.sc-root');
    if (root === null) return;
    const target = current.target === null ? null : document.querySelector<HTMLElement>(current.target);
    target?.classList.add('sc-tour-target');
    let frame = requestAnimationFrame(function measure() {
      const box = root.getBoundingClientRect();
      const zoom = box.width / root.offsetWidth || 1; // the root is zoomed by the scale of the window: positions inside it are not
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const y = (screen: number): number => (screen - box.top) / zoom;
      if (target === null) {
        const top = Math.max(8, (root.offsetHeight - height) / 2);
        root.style.setProperty('--sc-coach-min-h', `${Math.ceil(top + height + 8)}px`);
        place = { left: (root.offsetWidth - width) / 2, top, arrow: -1, reach: 0 };
      } else {
        const t = target.getBoundingClientRect();
        const centre = (t.left + t.width / 2 - box.left) / zoom;
        if (mini) {
          place = { left: 0, top: 0, arrow: Math.min(Math.max(centre - 1, 12), width - 14), reach: 10 };
        } else {
          // the bottom of what the window shows: its parts (not the bubble), and a list open under a field
          let bottom = t.bottom;
          for (const part of root.children) if (part !== element) bottom = Math.max(bottom, part.getBoundingClientRect().bottom);
          for (const list of root.querySelectorAll<HTMLElement>('[role="listbox"]')) {
            if (list.offsetParent !== null) bottom = Math.max(bottom, list.getBoundingClientRect().bottom);
          }
          const top = y(bottom) + GAP;
          const left = Math.min(Math.max(centre - width / 2, 8), root.offsetWidth - width - 8);
          root.style.setProperty('--sc-coach-min-h', `${Math.ceil(top + height + 8)}px`);
          place = { left, top, arrow: Math.min(Math.max(centre - left - 1, 12), width - 14), reach: Math.max(10, top - y(t.bottom) - 3) };
        }
      }
      frame = requestAnimationFrame(measure); // the window moves under it (a list opens, a row unfolds, the window refits): follow it
    });
    return () => {
      cancelAnimationFrame(frame);
      target?.classList.remove('sc-tour-target');
      root.style.removeProperty('--sc-coach-min-h');
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
      <span class="pointer" style:left="{place.arrow}px" style:height="{place.reach}px" style:top="{-place.reach}px" aria-hidden="true"></span>
    {/if}
    <div class="head">
      <strong id="coach-title">{coach.title}</strong>
      <span class="count sc-label">{coach.step} / {coach.total}</span>
    </div>
    <p class="text">{coach.text}</p>
    {#if coach.doing}<p class="doing">{coach.doing}</p>{/if}
    {#if coach.leave || coach.primary}
      <div class="actions">
        {#if coach.leave}<button type="button" class="sc-btn sc-btn--ghost" onclick={() => coach.leave?.run()}>{coach.leave.label}</button>{/if}
        {#if coach.primary}<button type="button" class="sc-btn sc-btn--primary" onclick={() => coach.primary?.run()}>{coach.primary.label}</button>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .coach {
    position: absolute;
    z-index: 30;
    width: min(320px, calc(100% - 16px));
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
    margin: 14px 6px 6px;
  }

  /* the line from the bubble up to the element, with the head of the arrow at its end; it lets the cursor through to what it crosses */
  .pointer {
    position: absolute;
    width: 2px;
    background: var(--sc-accent);
    pointer-events: none;
  }

  .pointer::before {
    position: absolute;
    top: -1px;
    left: -6px;
    width: 0;
    height: 0;
    border-right: 7px solid transparent;
    border-bottom: 9px solid var(--sc-accent);
    border-left: 7px solid transparent;
    content: '';
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
