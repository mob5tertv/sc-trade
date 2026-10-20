<script lang="ts">
  import { LEGEND } from '../vm/legend';
  import { outlookText, stripTitle, type StripModel } from '../vm/strip';
  import { tr } from '../../i18n';

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
    /** The two ends of the range take turns (the default), or stand side by side as 'мин–макс' (the setting; also what a system that asks for less motion gets). */
    rangeStill?: boolean;
    /** The part «склад …» was clicked: the window opens on the tab «Склад» of this station (version 1.4.1). Default: as a click on the line. */
    onStored?: () => void;
    /** The favourite routes whose stock is full now, in the words of their alerts: the line wears «★N» while there are any. */
    favourites?: readonly string[];
  }
  let { model, flash, flashKind = 'info', onOpen, onDepart, onArrive, onStored, rangeStill = false, favourites = [] }: Props = $props();

  const lot = $derived(model.kind === 'run' ? model.lot ?? null : null);

  const showMarks = $derived(flash === null && model.kind === 'run' && (onDepart !== undefined || onArrive !== undefined));

  // the profit the run is expected to bring: '≈ +66 720'
  const outlook = $derived(outlookText(model));

  // Everything the strip knows, for the tooltip: the line cuts a long cargo.
  const full = $derived(flash ?? stripTitle(model));
</script>

<div class="strip">
  <button type="button" class="open" data-tour="strip" title={full} onclick={() => onOpen()}>
    {#if flash !== null}
      <span class="part flash" class:error={flashKind === 'error'} aria-live="polite">{flash}</span>
    {:else if model.kind === 'idle'}
      {#if favourites.length > 0}<span class="part fav" title={favourites.join('\n')}>★{favourites.length}</span>{/if}
      <span class="part location">{model.location}{#if model.target !== null}<span class="to">→</span>{#if model.then}<span class="step">{tr('закупка')}</span>{/if}<span class="goal">{model.target}</span>{#if model.then}<span class="step then">{tr('потом {then}', { then: model.then })}</span>{/if}{/if}</span>
      {#if model.session !== null}
        <span class="part session {model.session.tone}"><span class="caption">{tr('сессия')}</span>{model.session.short}</span>
      {/if}
    {:else}
      {#if favourites.length > 0}<span class="part fav" title={favourites.join('\n')}>★{favourites.length}</span>{/if}
      <span class="part timer" title={tr('Всего: {timer}', { timer: model.timer })}><span class="phase">{model.phaseLabel}</span>{model.phaseTimer}</span>
      {#if lot !== null}
        <span class="part lot" title={model.cargoTitle || undefined}>
          <span class="code">{lot.code}</span><span class="qty">{lot.qty}</span><span class="buy">{lot.buy}</span>
          {#if lot.person !== null || lot.range !== null || lot.single !== null}<span class="arrow" aria-hidden="true">→</span>{/if}
          {#if lot.person !== null}
            <span class="person" title={tr('Цена, которую ввёл человек, и её возраст')}>
              <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><circle cx="5" cy="3" r="2.2" /><path d="M1 10c0-2.6 1.8-4 4-4s4 1.4 4 4z" /></svg>
              <span class="who">{lot.person.who}</span>{lot.person.price}<span class="age">{lot.person.age}</span>
            </span>
          {/if}
          {#if lot.range !== null}
            {#if rangeStill}
              <span class="range still"><span class="low">{lot.range.low}</span>–<span class="high">{lot.range.high}</span></span>
            {:else}
              <span class="range turn" title={tr('Минимум и максимум цены продажи в точке цели, по очереди')}>
                <span class="low"><span class="cap">{tr('мин')}</span>{lot.range.low}</span>
                <span class="high"><span class="cap">{tr('макс')}</span>{lot.range.high}</span>
              </span>
            {/if}
          {:else if lot.single !== null}
            <span class="single">{lot.single}</span>
          {/if}
        </span>
      {:else}
        <span class="part cargo" title={model.cargoTitle || undefined}>{model.cargoLine}</span>
      {/if}
      <span class="part" class:muted={model.target === null}>{model.target === null ? tr('цель не выбрана') : `→ ${model.target}`}</span>
      {#if outlook}<span class="part outlook" class:loss={model.profitLoss} title={LEGEND.approxStrip}>{outlook}</span>{/if}
    {/if}
  </button>
  {#if model.kind === 'idle' && model.stored && flash === null}
    <!-- version 1.4.1: what lies at the storage here is a button of its own: it opens the tab «Склад» of this station -->
    <button type="button" class="stored" data-tour="strip-storage" title={tr('Здесь на складе лежит твой груз: открыть вкладку «Склад» и погрузить')} onclick={() => (onStored ?? onOpen)()}>{model.stored}</button>
  {/if}
  {#if showMarks}
    <div class="marks">
      {#if onDepart}<button type="button" class="sc-btn sc-btn--act" data-tour="mark" onclick={() => onDepart?.()}>{tr('Взлетел')}</button>{/if}
      {#if onArrive}<button type="button" class="sc-btn sc-btn--act" data-tour="mark" onclick={() => onArrive?.()}>{tr('Прилетел')}</button>{/if}
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

  /* the one commodity of the hold in parts: what, how much, bought for → the sale side */
  .lot {
    flex: 0 1 auto;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .lot > * {
    flex: none;
  }

  .lot .code {
    color: var(--sc-accent);
    font-weight: 600;
  }

  .lot .qty,
  .lot .arrow,
  .lot .age,
  .lot .cap {
    color: var(--sc-muted);
  }

  /* a price a person typed in: a frame of the accent, his name, the price, its age; it never moves */
  .person {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 5px;
    border: 1px solid var(--sc-accent);
    color: var(--sc-text);
  }

  .person svg {
    fill: var(--sc-accent);
  }

  .person .who {
    color: var(--sc-accent);
  }

  .person .age {
    font-size: var(--sc-font-sm);
  }

  .range .low {
    color: var(--sc-warn);
  }

  .range .high {
    color: var(--sc-good);
  }

  .range .cap {
    margin-right: 4px;
    font-size: var(--sc-font-sm);
  }

  /* The two ends take turns in ONE place: both lie in the same cell (it is as wide as the wider one), and each is seen for three
     seconds. They SCROLL (the author, 14.10.2026): the upper price lies above the lower one, the line goes up to the upper price
     (it comes down from above) and down to the lower one (it comes up from below). `clip-path` cuts what is outside the cell and,
     unlike `overflow`, leaves the line of the text where it was. */
  .range.turn {
    display: inline-grid;
    clip-path: inset(0);
  }

  .range.turn > * {
    grid-area: 1 / 1;
  }

  .range.turn > .low {
    animation: sc-turn-low 6s ease-in-out infinite;
  }

  .range.turn > .high {
    animation: sc-turn-high 6s ease-in-out infinite;
  }

  /* the lower price: in place for the first half, then away downwards, and back from below */
  @keyframes sc-turn-low {
    0%, 44% { transform: translateY(0); }
    50%, 94% { transform: translateY(110%); }
    100% { transform: translateY(0); }
  }

  /* the upper price: above the cell for the first half, then down into it, and away upwards */
  @keyframes sc-turn-high {
    0%, 44% { transform: translateY(-110%); }
    50%, 94% { transform: translateY(0); }
    100% { transform: translateY(-110%); }
  }

  /* a system that asks for less motion gets the two ends side by side, the low one first */
  @media (prefers-reduced-motion: reduce) {
    .range.turn {
      display: inline-flex;
      gap: 6px;
    }

    .range.turn > * {
      animation: none;
    }
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

  /* a target in two steps: the word before the place of the purchase, and the place of the sale after it */
  .step {
    padding-right: 5px;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .step.then {
    padding: 0 0 0 6px;
  }

  .outlook {
    color: var(--sc-good);
  }

  /* the run is expected to lose */
  .outlook.loss {
    color: var(--sc-bad);
  }

  /* what the session that is going has earned: the colour of a profit, of a loss, or none for an even one */
  .session {
    gap: 6px;
    font-weight: 600;
  }

  /* the storage of the place the ship stands at (version 1.4): goods of the player lie here, in the colour of a caution; a button of its own
     (version 1.4.1) that opens the tab «Склад» */
  .stored {
    flex: none;
    padding: 0 var(--sc-pad-x);
    border: 0;
    border-left: 1px solid var(--sc-border);
    background: transparent;
    color: var(--sc-warn);
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .stored:hover {
    background: var(--sc-surface-2);
  }

  /* «★N»: so many favourite routes have a full stock now; it stays while that is true, the alert itself is a moment */
  .fav {
    color: var(--sc-good);
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
