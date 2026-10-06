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

  // The second line of a run: where it goes and what it is expected to bring. Parts that are not known are left out.
  const secondLine = $derived(
    model.kind === 'run' ? [model.target === null ? 'цель не выбрана' : `→ ${model.target}`, model.expect, model.rate].filter(Boolean).join(' · ') : '',
  );

  // Everything the strip knows, for the tooltip: the lines are cut to fit 260 × 36 px.
  const full = $derived(flash ?? (model.kind === 'idle' ? model.location : `${model.timer} ${model.cargo}\n${secondLine}`));
</script>

<div class="strip" class:marks={showMarks} aria-live="polite">
  <button type="button" class="open" title={full} onclick={onOpen}>
    {#if flash !== null}
      <span class="line flash">{flash}</span>
    {:else if model.kind === 'idle'}
      <span class="line location">{model.location}</span>
    {:else}
      <span class="line"><span class="timer">{model.timer}</span> {model.cargo}</span>
      <span class="line second">{secondLine}</span>
    {/if}
  </button>
  {#if showMarks}
    <div class="marks-box">
      {#if onDepart}<button type="button" onclick={onDepart}>Взлетел</button>{/if}
      {#if onArrive}<button type="button" onclick={onArrive}>Прилетел</button>{/if}
    </div>
  {/if}
</div>

<style>
  .strip {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-bg);
    color: var(--sc-text);
    font-size: var(--sc-font-sm);
  }

  /* The badge is one big button; the two marks lie over its right edge and take only their own clicks. */
  .open {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-sizing: border-box;
    width: 100%;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .marks .open {
    padding-right: 74px;
  }

  .open:hover {
    background: var(--sc-surface-2);
  }

  .open:focus-visible,
  .marks-box button:focus-visible {
    outline: 2px solid var(--sc-accent);
    outline-offset: -2px;
  }

  .line {
    display: block;
    overflow: hidden;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .location {
    font-size: var(--sc-font);
  }

  .flash {
    font-size: var(--sc-font);
    font-weight: 600;
  }

  .timer {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .second {
    color: var(--sc-muted);
  }

  .marks-box {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 0 4px;
    pointer-events: none;
  }

  .marks-box button {
    height: 16px;
    padding: 0 6px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-surface);
    color: var(--sc-text);
    font: inherit;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
  }

  .marks-box button:hover {
    background: var(--sc-surface-2);
  }
</style>
