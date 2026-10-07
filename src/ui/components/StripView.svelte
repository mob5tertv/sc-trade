<script lang="ts">
  import type { StripModel } from '../vm/strip';

  interface Props {
    model: StripModel;
    /** A short message that replaces the content for a moment; the owner decides when it goes away. */
    flash: string | null;
    onOpen: () => void;
    /** The two marks of a run; the buttons are drawn only while a run is on and the callback is given. */
    onDepart?: () => void;
    onArrive?: () => void;
  }
  let { model, flash, onOpen, onDepart, onArrive }: Props = $props();

  const showMarks = $derived(flash === null && model.kind === 'run' && (onDepart !== undefined || onArrive !== undefined));

  // the line shows 'ждём 6 900', the tooltip the range as well ('ждём 6 900 (6 400–7 100)')
  const expect = $derived(model.kind === 'run' ? model.expectShort : null);

  // Everything the strip knows, for the tooltip: the line cuts a long cargo.
  const full = $derived(
    flash ??
      (model.kind === 'idle'
        ? model.location
        : [model.timer, model.cargo, model.target === null ? 'цель не выбрана' : `→ ${model.target}`, model.expect, model.rate].filter(Boolean).join(' · ')),
  );
</script>

<div class="strip">
  <button type="button" class="open" title={full} onclick={() => onOpen()}>
    {#if flash !== null}
      <span class="part flash" aria-live="polite">{flash}</span>
    {:else if model.kind === 'idle'}
      <span class="part mark">SC</span>
      <span class="part location">{model.location}</span>
    {:else}
      <span class="part timer">{model.timer}</span>
      <span class="part cargo">{model.cargo}</span>
      <span class="part" class:muted={model.target === null}>{model.target === null ? 'цель не выбрана' : `→ ${model.target}`}</span>
      {#if expect}<span class="part">{expect}</span>{/if}
      {#if model.rate}<span class="part rate">{model.rate}</span>{/if}
    {/if}
  </button>
  {#if showMarks}
    <div class="marks">
      {#if onDepart}<button type="button" class="sc-btn sc-btn--act" onclick={() => onDepart?.()}>Взлетел</button>{/if}
      {#if onArrive}<button type="button" class="sc-btn sc-btn--act" onclick={() => onArrive?.()}>Прилетел</button>{/if}
    </div>
  {/if}
</div>

<style>
  /* one line, as wide as what it says, and never wider than 520 px: a long cargo is cut; the glass and the frame
     belong to the window around it (`.sc-frame`), so that the glass is painted once */
  .strip {
    display: flex;
    align-items: stretch;
    width: max-content;
    max-width: 520px;
    height: var(--sc-mini-h);
    overflow: hidden;
    color: var(--sc-text);
  }

  .open {
    display: flex;
    flex: 0 1 auto;
    align-items: stretch;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .open:hover {
    background: var(--sc-surface-2);
  }

  .open:focus-visible,
  .marks :global(.sc-btn:focus-visible) {
    outline: 1px solid var(--sc-accent);
    outline-offset: -1px;
  }

  /* the parts are told apart by a hairline, not by gaps */
  .part {
    display: flex;
    flex: none;
    align-items: center;
    padding: 0 var(--sc-pad-x);
    white-space: nowrap;
  }

  .part + .part {
    border-left: 1px solid var(--sc-border);
  }

  .cargo {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    display: block;
    line-height: var(--sc-mini-h);
    text-overflow: ellipsis;
  }

  .mark {
    color: var(--sc-accent);
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .timer {
    color: var(--sc-accent);
    font-weight: 600;
  }

  .rate {
    color: var(--sc-good);
  }

  .muted {
    color: var(--sc-muted);
  }

  .flash {
    color: var(--sc-accent);
    font-weight: 600;
  }

  .marks {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    /* the right edge is the cut corner of the window: the last button keeps clear of it */
    padding: 0 8px 0 4px;
    border-left: 1px solid var(--sc-border);
  }
</style>
