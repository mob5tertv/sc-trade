<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { formatUec } from '../../core/format';
  import type { Side } from '../../core/types';
  import { baseTexts, cellEditBase, resolveCellEdit } from '../vm/inputs';
  import type { EditBase } from '../vm/inputs';
  import type { RoiCell } from '../vm/row-roi';
  import { cellScu, rangeView } from '../vm/terminal-rows';
  import type { Cell, TerminalRow } from '../vm/terminal-rows';
  import TempBadge from './TempBadge.svelte';
  import TrendMark from './TrendMark.svelte';

  const NO_ROI: ReadonlyMap<number, RoiCell> = new Map();
  const NO_PULSE: ReadonlySet<number> = new Set();

  interface Props {
    rows: TerminalRow[];
    /** Which side of the terminal is drawn: `buy` what the player can buy here, `sell` what he can sell here. Rows without that side are left out. */
    side: Side;
    selectedCommodityId: number | null;
    /**
     * What these rows belong to, say the id of the viewed terminal. A draft is kept per scope: when the scope
     * changes, every unsaved or invalid draft is dropped, so none can show up on another terminal's row.
     */
    scope?: string | number;
    /** A click on a row: its commodity, or `null` when the selected row was clicked again. */
    onSelect: (commodityId: number | null) => void;
    /**
     * `scu` is the quantity the player typed in this very edit. `null` means "no quantity reading in this
     * observation": a price typed alone, or an emptied quantity. It does not mean the quantity became unknown.
     */
    onSavePrice: (e: { commodityId: number; side: Side; price: number; scu: number | null }) => void;
    onLookup: (e: { commodityId: number; side: Side }) => void;
    onTrade: (e: { commodityId: number; side: Side }) => void;
    /**
     * The commodity whose trade form is open, and the form: it is drawn right under the expanded row of that commodity,
     * in the flow of the table. The owner writes the form, the table only gives it the place.
     */
    tradeFor?: number | null;
    tradeForm?: Snippet<[TerminalRow]>;
    /**
     * The best ROI of each commodity of the table, by commodity id (`roiCells`): the number in the last column, in the
     * colour of its tier, a button that asks `onLookup` for the options of that commodity. A row with a cell that is
     * `hot` stands out with a bar at its edge. A commodity with no entry has an empty cell.
     */
    roi?: ReadonlyMap<number, RoiCell>;
    /** The commodities whose rows flash once now (they crossed the threshold after a price was entered). */
    pulse?: ReadonlySet<number>;
  }
  let {
    rows, side, selectedCommodityId, scope = '', onSelect, onSavePrice, onLookup, onTrade, tradeFor = null, tradeForm,
    roi = NO_ROI, pulse = NO_PULSE,
  }: Props = $props();

  /**
   * What is being typed into one cell (one commodity, one side). A cell with no draft shows its values from
   * `rows`. `shown` holds the texts of the inputs that were typed into (`null`: show the value of `rows`) and
   * `typed` says which inputs were typed into in this edit: only those are ever saved, a value that merely
   * stands in an input is never sent. `sent` is set once the edit was handed to `onSavePrice`: the typed text
   * then stays on screen until `rows` is refreshed, so the number does not jump back to the old one in between.
   */
  interface Draft {
    shown: { price: string | null; scu: string | null };
    typed: { price: boolean; scu: boolean };
    bad: { price: boolean; scu: boolean };
    sent: EditBase | null;
  }
  let drafts = $state<Record<string, Draft>>({});

  const keyOf = (commodityId: number, side: Side): string => `${scope}:${commodityId}:${side}`;

  // Another scope is another set of rows: nothing typed for the old one may stay.
  $effect(() => {
    void scope;
    untrack(() => {
      for (const key of Object.keys(drafts)) delete drafts[key];
    });
  });

  // A refresh of the rows carries what was sent. A draft that was typed into again since stays and is compared with the new values.
  $effect(() => {
    void rows;
    untrack(() => {
      for (const [key, draft] of Object.entries(drafts)) {
        if (draft.sent === null) continue;
        if (!draft.typed.price && !draft.typed.scu) delete drafts[key];
        else draft.sent = null;
      }
    });
  });

  function type(key: string, field: 'price' | 'scu', text: string): void {
    const draft: Draft = drafts[key] ?? {
      shown: { price: null, scu: null }, typed: { price: false, scu: false }, bad: { price: false, scu: false }, sent: null,
    };
    draft.shown[field] = text;
    draft.typed[field] = true;
    draft.bad[field] = false;
    drafts[key] = draft;
  }

  // What the cell holds is read now, when the cell is left, not when the typing began.
  function commit(commodityId: number, side: Side, cell: Cell): void {
    const key = keyOf(commodityId, side);
    const draft = drafts[key];
    if (!draft) return;
    const edit = resolveCellEdit(
      { price: draft.typed.price ? draft.shown.price : null, scu: draft.typed.scu ? draft.shown.scu : null },
      draft.sent ?? cellEditBase(cell),
    );
    if (edit.kind === 'unchanged') {
      if (draft.sent === null) delete drafts[key];
      return;
    }
    if (edit.kind === 'invalid') {
      draft.bad = { price: edit.price, scu: edit.scu };
      return;
    }
    drafts[key] = {
      shown: {
        price: draft.typed.price ? String(edit.price) : draft.shown.price,
        scu: draft.typed.scu ? (edit.scu === null ? '' : String(edit.scu)) : draft.shown.scu,
      },
      typed: { price: false, scu: false },
      bad: { price: false, scu: false },
      sent: { price: edit.price, scu: edit.scu },
    };
    onSavePrice({ commodityId, side, price: edit.price, scu: edit.scu });
  }

  function onKeydown(e: KeyboardEvent, commodityId: number, side: Side, cell: Cell): void {
    const key = keyOf(commodityId, side);
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(commodityId, side, cell);
    } else if (e.key === 'Escape' && drafts[key]) {
      // takes back what was typed; with nothing typed Esc goes on and closes the panel
      e.stopPropagation();
      delete drafts[key];
    }
  }

  // Tab between the two inputs of one cell is not leaving it: the cell is saved once, when the focus goes elsewhere.
  function onBlur(e: FocusEvent, commodityId: number, side: Side, cell: Cell): void {
    const next = e.relatedTarget;
    if (next instanceof HTMLElement && next.dataset.cell === keyOf(commodityId, side)) return;
    commit(commodityId, side, cell);
  }

  // One row is expanded at a time; the click on it again takes it back.
  const toggle = (commodityId: number): void => onSelect(commodityId === selectedCommodityId ? null : commodityId);

  const placeholder = (n: number | null): string => (n === null ? '—' : formatUec(n));

  const shown = $derived(rows.filter(row => row[side] !== null));
  const empty = $derived(rows.length === 0 ? 'Нет цен' : side === 'buy' ? 'Здесь ничего не продают' : 'Здесь ничего не покупают');
</script>

{#snippet expanded(row: TerminalRow, cell: Cell)}
  {@const key = keyOf(row.commodityId, side)}
  {@const draft = drafts[key]}
  {@const texts = baseTexts(cellEditBase(cell))}
  {@const estimated = cell.ownScu !== null && cell.ownScuBase !== null}
  <div class="expand sc-reveal">
    <div class="edit">
      <input
        class="sc-input sc-num in-price"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        data-cell={key}
        aria-label="{row.code}: цена {side === 'buy' ? 'покупки' : 'продажи'}, UEC за SCU"
        aria-invalid={draft?.bad.price ? 'true' : undefined}
        placeholder={placeholder(cell.hint)}
        value={draft?.shown.price ?? texts.price}
        oninput={e => type(key, 'price', e.currentTarget.value)}
        onkeydown={e => onKeydown(e, row.commodityId, side, cell)}
        onblur={e => onBlur(e, row.commodityId, side, cell)}
      />
      <input
        class="sc-input sc-num in-scu"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        data-cell={key}
        aria-label={side === 'buy' ? `${row.code}: количество у продавца, SCU` : `${row.code}: количество у покупателя на складе, SCU`}
        aria-invalid={draft?.bad.scu ? 'true' : undefined}
        placeholder={placeholder(cell.hintScu)}
        value={draft?.shown.scu ?? texts.scu}
        oninput={e => type(key, 'scu', e.currentTarget.value)}
        onkeydown={e => onKeydown(e, row.commodityId, side, cell)}
        onblur={e => onBlur(e, row.commodityId, side, cell)}
      />
      {#if estimated && cell.ownScu !== null}
        <span class="est" title="Оценка по таймеру пополнения: сколько там сейчас">≈ {formatUec(cell.ownScu)}</span>
      {:else}
        <span class="unit" title={side === 'sell' ? 'Столько уже лежит на складе у покупателя, а не сколько он готов купить' : undefined}>SCU</span>
      {/if}
      <span class="spacer"></span>
      {#if side === 'buy'}
        <button type="button" class="sc-btn sc-btn--act" aria-label="Где продать {row.code}" onclick={() => onLookup({ commodityId: row.commodityId, side })}>Где продать</button>
        <button type="button" class="sc-btn sc-btn--act" aria-label="Купил {row.code}" onclick={() => onTrade({ commodityId: row.commodityId, side })}>Купил</button>
      {:else}
        <button type="button" class="sc-btn sc-btn--act" aria-label="Где купить {row.code}" onclick={() => onLookup({ commodityId: row.commodityId, side })}>Где купить</button>
        <button type="button" class="sc-btn sc-btn--act" aria-label="Продал {row.code}" onclick={() => onTrade({ commodityId: row.commodityId, side })}>Продал</button>
      {/if}
    </div>
    <!-- One line, never wrapped. The warning, the plaque and the rate mark keep their size; the texts between them give way
         with an ellipsis (the whole text is in their `title`), so the warning is never the part that is cut. -->
    {#if cell.badge || cell.warn || cell.ownLast || (estimated && cell.ownScuBase)}
      <div class="meta">
        {#if cell.warn}<span class="warn fixed">проверь цифру</span>{/if}
        {#if cell.badge}<span class="fixed"><TempBadge text={cell.badge.text} kind={cell.badge.kind} /></span>{/if}
        {#if cell.trend}
          <span class="note"><TrendMark trend={cell.trend} /><span class="text muted" title={cell.trend.title}>{cell.trend.title}</span></span>
        {/if}
        {#if estimated && cell.ownScuBase}
          {@const was = `было ${formatUec(cell.ownScuBase.scu)} · ${cell.ownScuBase.age}`}
          <span class="text muted" title={was}>{was}</span>
          {#if cell.ownScuRate === 'learned'}
            <span class="rate learned fixed" title="Скорость пополнения выучена по твоим замерам">скорость выучена</span>
          {:else if cell.ownScuRate === 'default'}
            <span class="rate fixed" title="По твоим замерам скорость пополнения ещё не выучена, взята запасная">скорость запасная</span>
          {/if}
        {/if}
        {#if cell.ownLast}
          {@const last = `моя была ${formatUec(cell.ownLast.price)} · ${cell.ownLast.age}`}
          <span class="text muted" title={last}>{last}</span>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#if shown.length === 0}
  <p class="empty">{empty}</p>
{:else}
  <div class="table" role="table" aria-label={side === 'buy' ? 'Что можно купить' : 'Что можно продать'}>
    <div class="grid head sc-label" role="row">
      <span role="columnheader">Товар</span>
      <span role="columnheader" class="r price-head">Цена</span>
      <span role="columnheader" class="r">Мин–макс</span>
      <span role="columnheader" class="r">SCU</span>
      <span role="columnheader" class="r" title="Лучший ROI для этого товара">ROI</span>
    </div>
    {#each shown as row (row.commodityId)}
      {@const cell = row[side]}
      {#if cell}
        {@const selected = row.commodityId === selectedCommodityId}
        {@const scu = cellScu(cell, side)}
        {@const span = rangeView(cell.range)}
        {@const best = roi.get(row.commodityId)}
        <!-- the number of the ROI is a button of its own, beside the one of the row (a button inside a button is not allowed):
             a click on it asks for the options and does not open the row -->
        <div class="row {best ? `tier-${best.tier}` : ''}" class:selected class:hot={best?.hot} class:pulse={pulse.has(row.commodityId)} role="row">
          <div class="top">
            <button type="button" class="grid line" aria-expanded={selected} onclick={() => toggle(row.commodityId)}>
              <span class="name" title={row.name}><span class="code">{row.code}</span><span class="full">{row.name}</span></span>
              <span class="price sc-num" class:hint={cell.own === null}>
                {#if cell.warn}<span class="bang" title="Цена далеко от истории UEX: проверь цифру">!</span>{/if}
                <TrendMark trend={cell.trend} />
                <span class="digits">{cell.own === null && cell.hint === null ? '—' : formatUec(cell.own ?? cell.hint ?? 0)}</span>
                {#if cell.badge}<TempBadge compact text={cell.badge.text} kind={cell.badge.kind} />{:else}<span class="nomark"></span>{/if}
              </span>
              <span class="range sc-num" data-range={span.kind} title={span.title}>{span.text}</span>
              <span class="scu sc-num" class:hint={scu === null || !scu.own} title={scu?.title}>{scu === null ? '—' : `${scu.estimated ? '≈' : ''}${scu.text}`}</span>
            </button>
            {#if best}
              <button
                type="button"
                class="roi sc-num"
                aria-label="ROI {best.text}: варианты для {row.name}"
                title={best.title}
                onclick={() => onLookup({ commodityId: row.commodityId, side })}
              >{best.text}</button>
            {/if}
          </div>
          {#if selected}{@render expanded(row, cell)}{/if}
          {#if selected && tradeForm && tradeFor === row.commodityId}{@render tradeForm(row)}{/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  /* The columns, named once for the head and for the rows. Measured on the real texts (the gallery audit): a seven-digit price
     is 47 px, a six-digit spread of «Мин–макс» 73 px, a five-digit stock with its «≈» 41 px, a ROI of three digits 29 px;
     what is left goes to the names (180 px: «Recycled Material Composite» with its code is 172 px) */
  .table {
    /* the number and its 6 px mark (62 px) and the slot of the triangle with the gap before the number */
    --col-price: calc(62px + var(--sc-trend-w) + 4px);
    --col-range: 76px;
    --col-scu: 44px;
    --col-roi: 32px;
    --col-gap: 4px;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--col-price) var(--col-range) var(--col-scu) var(--col-roi);
    column-gap: var(--col-gap);
    align-items: center;
    padding: 0 var(--sc-pad-x);
  }

  .head {
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    color: var(--sc-muted);
    white-space: nowrap;
  }

  .r {
    text-align: right;
  }

  /* the number stands left of its 6 px mark: the caption stands over the number */
  .price-head {
    padding-right: 10px;
  }

  .row {
    border-bottom: 1px solid var(--sc-surface-2);
  }

  /* the top of a row: its button and, over the room that the button leaves at its right edge, the button of the ROI */
  .top {
    position: relative;
  }

  .line {
    /* the ROI column is not in this grid: its room is the padding */
    grid-template-columns: minmax(0, 1fr) var(--col-price) var(--col-range) var(--col-scu);
    width: 100%;
    height: calc(var(--sc-row-h) - 1px);
    padding-right: calc(var(--sc-pad-x) + var(--col-roi) + var(--col-gap));
    border: 0;
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .top:hover .line,
  .row.selected .line {
    background: var(--sc-surface-2);
  }

  /* the colour of the tier of the best ROI: the number, the bar and the flash of a row */
  .tier-great { --tier: var(--sc-roi-great); }
  .tier-good { --tier: var(--sc-roi-good); }
  .tier-ok { --tier: var(--sc-roi-ok); }
  .tier-poor { --tier: var(--sc-roi-poor); }
  .tier-loss { --tier: var(--sc-roi-loss); }

  .roi {
    position: absolute;
    top: 0;
    right: var(--sc-pad-x);
    bottom: 0;
    width: var(--col-roi);
    padding: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: var(--tier);
    font: inherit;
    font-weight: 600;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .roi:hover {
    text-decoration: underline;
  }

  /* a row at or above the threshold stands out with a bar at its left edge, in the colour of its tier; the bar lies over
     the padding of the row, so the texts do not move when a row gets one */
  .row.hot .top::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: var(--tier);
    content: '';
  }

  /* One soft flash of a row that has just crossed the threshold, drawn over the row so that an open row shows it too.
     It changes no size and no place: only the opacity of a layer that takes no clicks. */
  .row.pulse .top::after {
    position: absolute;
    inset: 0;
    background: var(--tier);
    content: '';
    opacity: 0;
    pointer-events: none;
    animation: roi-pulse 1200ms ease-out 1;
  }

  @keyframes roi-pulse {
    0% { opacity: 0; }
    15% { opacity: 0.28; }
    100% { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .row.pulse .top::after {
      animation: none;
    }
  }

  .name {
    display: flex;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .code {
    flex: none;
    font-weight: 600;
  }

  .full {
    min-width: 0;
    overflow: hidden;
    color: var(--sc-muted);
    text-overflow: ellipsis;
  }

  .price {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
  }

  .price.hint,
  .hint {
    color: var(--sc-muted);
  }

  .digits {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nomark {
    flex: none;
    width: 6px;
  }

  .bang {
    color: var(--sc-warn);
    font-weight: 600;
  }

  .range {
    overflow: hidden;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scu {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* the row that was clicked opens one line under it: the fields of that side and what can be done with them */
  .expand {
    padding: 4px var(--sc-pad-x);
    background: var(--sc-surface);
  }

  .edit {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--sc-ctl-h);
  }

  .in-price {
    flex: none;
    width: 66px;
  }

  .in-scu {
    flex: none;
    width: 48px;
  }

  .spacer {
    flex: 1;
  }

  .unit,
  .est {
    flex: none;
    font-size: var(--sc-font-sm);
    white-space: nowrap;
  }

  .unit {
    color: var(--sc-muted);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 20px;
    padding-top: 4px;
    overflow: hidden;
    font-size: var(--sc-font-sm);
    white-space: nowrap;
  }

  .warn {
    color: var(--sc-warn);
  }

  /* what never gives way: the warning, the plaque, the mark of the refill rate */
  .fixed {
    flex: none;
  }

  /* what gives way when the line is too long: the texts, cut with an ellipsis */
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* how the price moved: the same triangle as in the row, then the text of its hint */
  .note {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .muted {
    color: var(--sc-muted);
  }

  .rate {
    padding: 0 4px;
    border: 1px solid var(--sc-border);
    color: var(--sc-muted);
    line-height: 14px;
  }

  .rate.learned {
    border-color: var(--sc-good);
    color: var(--sc-good);
  }

  .empty {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }
</style>
