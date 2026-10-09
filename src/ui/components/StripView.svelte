<script lang="ts">
  import { outlookText, stripTitle, type StripModel } from '../vm/strip';

  interface Props {
    model: StripModel;
    /** A short message that replaces the content for a moment; the owner decides when it goes away. */
    flash: string | null;
    /** `error`: the message is red (the start failed). */
    flashKind?: 'info' | 'error';
    onOpen: () => void;
    /** The two marks of a run; the buttons are drawn only while a run is on and the callback is given. */
    onDepart?: () => void;
    onArrive?: () => void;
  }
  let { model, flash, flashKind = 'info', onOpen, onDepart, onArrive }: Props = $props();

  const showMarks = $derived(flash === null && model.kind === 'run' && (onDepart !== undefined || onArrive !== undefined));

  // the profit the run is expected to bring and the rate after it: '≈ +66 720 · 337k/ч'
  const outlook = $derived(outlookText(model));

  // Everything the strip knows, for the tooltip: the line cuts a long cargo.
  const full = $derived(flash ?? stripTitle(model));
</script>

<div class="strip">
  <button type="button" class="open" title={full} onclick={() => onOpen()}>
    {#if flash !== null}
      <span class="part flash" class:error={flashKind === 'error'} aria-live="polite">{flash}</span>
    {:else if model.kind === 'idle'}
      <span class="part mark">SC</span>
      <span class="part location">{model.location}{#if model.target !== null}<span class="to">→</span><span class="goal">{model.target}</span>{/if}</span>
      {#if model.session !== null}
        <span class="part session {model.session.tone}"><span class="caption">сессия</span>{model.session.short}</span>
      {/if}
    {:else}
      <span class="part timer" title="Всего: {model.timer}"><span class="phase">{model.phaseLabel}</span>{model.phaseTimer}</span>
      <span class="part cargo" title={model.cargoTitle || undefined}>{model.cargoLine}</span>
      <span class="part" class:muted={model.target === null}>{model.target === null ? 'цель не выбрана' : `→ ${model.target}`}</span>
      {#if outlook}<span class="part rate" class:loss={model.profitLoss}>{outlook}</span>{/if}
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
  /* one line, as wide as what it says, and never wider than 660 px: a long cargo is cut, nothing else is. The cargo says what each commodity was bought for
     ('MEDS 120 по 2 115') and, for one commodity, what it is expected to sell for ('…, ждём 2 351'); after the target stands the profit expected with the rate
     ('≈ +66 720 · 273k/ч'). Measured in the gallery (task 49, the frame included): 533 px with one commodity at an ordinary price, 607 with a seven-digit price and
     nine-digit numbers of the profit, 654 with the longest name of a target (nothing is cut), 631 with two commodities, and 662 (660 and the frame) with three: there the
     cargo is cut; the glass and the frame belong to the window around it (`.sc-frame`), so that the glass is painted once */
  .strip {
    display: flex;
    align-items: stretch;
    width: max-content;
    max-width: 660px;
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
    gap: 6px;
    color: var(--sc-accent);
    font-weight: 600;
  }

  /* the name of the phase is a small caption, the number after it is the timer */
  .phase {
    color: var(--sc-label);
    font-size: var(--sc-font-sm);
    font-weight: 400;
    letter-spacing: 0.06em;
  }

  .to {
    padding: 0 6px;
    color: var(--sc-muted);
  }

  .goal {
    color: var(--sc-accent);
  }

  .rate {
    color: var(--sc-good);
  }

  /* the run is expected to lose */
  .rate.loss {
    color: var(--sc-bad);
  }

  /* what the session that is going has earned: the colour of a profit, of a loss, or none for an even one */
  .session {
    gap: 6px;
    font-weight: 600;
  }

  .session.gain {
    color: var(--sc-good);
  }

  .session.loss {
    color: var(--sc-bad);
  }

  .session.even {
    color: var(--sc-muted);
  }

  /* the word is a small caption, the number after it is the figure */
  .session .caption {
    color: var(--sc-label);
    font-size: var(--sc-font-sm);
    font-weight: 400;
  }

  .muted {
    color: var(--sc-muted);
  }

  .flash {
    color: var(--sc-accent);
    font-weight: 600;
  }

  .flash.error {
    color: var(--sc-bad);
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
