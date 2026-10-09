<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { formatUec } from '../../core/format';
  import type { CargoLine, Side } from '../../core/types';
  import { baseTexts, cellEditBase, resolveCellEdit } from '../vm/inputs';
  import type { CellFinish, EditBase } from '../vm/inputs';
  import type { RoiCell } from '../vm/row-roi';
  import { DEFAULT_TERMINAL_SORT, holdMark, holdOf, orderRows, terminalAriaSort } from '../vm/terminal-order';
  import type { TerminalSort, TerminalSortKey } from '../vm/terminal-order';
  import { cellScu, rangeView, unknownScuTitle } from '../vm/terminal-rows';
  import type { Cell, TerminalRow } from '../vm/terminal-rows';
  import TempBadge from './TempBadge.svelte';
  import TrendMark from './TrendMark.svelte';

  const NO_ROI: ReadonlyMap<number, RoiCell> = new Map();
  const NO_PULSE: ReadonlySet<number> = new Set();
  const NO_CARGO: readonly CargoLine[] = [];
  const NO_CAPACITY_HINT = 'Укажи корабль в настройках — без вместимости ROI не считается';

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
    /** A cell was left with a number that cannot be saved (nothing was written): which of its two fields was marked. */
    onReject?: (e: { commodityId: number; side: Side; price: boolean; scu: boolean }) => void;
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
    /** The cargo space is not set: no ROI is counted, and the tooltip of the column says why. */
    noCapacity?: boolean;
    /**
     * What is in the hold while a run goes on, in the order of the cargo. On the sell side these commodities come first and
     * wear a mark with their quantity; on the buy side, and with an empty hold, nothing changes.
     */
    cargo?: readonly CargoLine[];
    /**
     * The header the rows are ordered by and the direction; that header carries the arrow. The owner keeps the choice, the
     * table only puts the rows in this order (it never changes `rows`, so no draft is touched by a sort).
     */
    sort?: TerminalSort;
    /** The header «Товар» or «ROI» was clicked. Without it the heads are plain text. */
    onSort?: (key: TerminalSortKey) => void;
  }
  let {
    rows, side, selectedCommodityId, scope = '', onSelect, onSavePrice, onReject, onLookup, onTrade, tradeFor = null, tradeForm,
    roi = NO_ROI, pulse = NO_PULSE, noCapacity = false, cargo = NO_CARGO, sort = DEFAULT_TERMINAL_SORT, onSort,
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

  const emptyDraft = (): Draft => ({
    shown: { price: null, scu: null }, typed: { price: false, scu: false }, bad: { price: false, scu: false }, sent: null,
  });

  function type(key: string, field: 'price' | 'scu', text: string): void {
    const draft: Draft = drafts[key] ?? emptyDraft();
    draft.shown[field] = text;
    draft.typed[field] = true;
    draft.bad[field] = false;
    drafts[key] = draft;
  }

  // What the cell holds is read now, when the cell is left, not when the typing began. Enter ("I see this now") writes what
  // stands in the fields even when nothing was typed, so it has a draft to keep the numbers it sent (and to mark a refusal) at once.
  function commit(commodityId: number, side: Side, cell: Cell, finish: CellFinish): void {
    const key = keyOf(commodityId, side);
    if (finish === 'enter' && !drafts[key]) drafts[key] = emptyDraft();
    const draft = drafts[key];
    if (!draft) return;
    const edit = resolveCellEdit(
      { price: draft.typed.price ? draft.shown.price : null, scu: draft.typed.scu ? draft.shown.scu : null },
      draft.sent ?? cellEditBase(cell),
      finish,
    );
    if (edit.kind === 'unchanged') {
      if (draft.sent === null) delete drafts[key];
      return;
    }
    if (edit.kind === 'invalid') {
      // the same refusal again (Enter, then leaving the cell) is one refusal: typing clears the marks, so a new one is a new line
      const again = draft.bad.price === edit.price && draft.bad.scu === edit.scu;
      draft.bad = { price: edit.price, scu: edit.scu };
      if (!again) onReject?.({ commodityId, side, price: edit.price, scu: edit.scu });
      return;
    }
    drafts[key] = {
      shown: {
        price: draft.typed.price ? String(edit.price) : draft.shown.price,
        scu: draft.typed.scu ? (edit.scu === null ? '' : String(edit.scu)) : draft.shown.scu,
      },
      typed: { price: false, scu: false },
      bad: { price: false, scu: false },
      // what was sent is mine from now on, so leaving the cell after Enter compares with it and writes nothing a second time
      sent: { price: edit.price, scu: edit.scu, priceIsOwn: true },
    };
    onSavePrice({ commodityId, side, price: edit.price, scu: edit.scu });
  }

  function onKeydown(e: KeyboardEvent, commodityId: number, side: Side, cell: Cell): void {
    const key = keyOf(commodityId, side);
    if (e.key === 'Enter') {
      e.preventDefault();
      // a key held down repeats Enter: one press is one "I see this now", not a stream of readings
      if (!e.repeat) commit(commodityId, side, cell, 'enter');
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
    commit(commodityId, side, cell, 'leave');
  }

  // One row is expanded at a time; the click on it again takes it back.
  const toggle = (commodityId: number): void => onSelect(commodityId === selectedCommodityId ? null : commodityId);

  const placeholder = (n: number | null): string => (n === null ? '—' : formatUec(n));

  // Only the ORDER of the rows is made here; `rows`, and with it every draft, stays as it was.
  const hold = $derived(holdOf(side, cargo));
  const shown = $derived(orderRows(rows.filter(row => row[side] !== null), {
    side, sort, cargo, percentOf: commodityId => roi.get(commodityId)?.percent ?? null,
  }));

  const roiTitle = $derived(`${noCapacity ? NO_CAPACITY_HINT : 'Лучший ROI для этого товара'}\nНажми, чтобы отсортировать по ROI`);
  const empty = $derived(rows.length === 0 ? 'Нет цен' : side === 'buy' ? 'Здесь ничего не продают' : 'Здесь ничего не покупают');
</script>

{#snippet expanded(row: TerminalRow, cell: Cell)}
  {@const key = keyOf(row.commodityId, side)}
  {@const draft = drafts[key]}
  {@const base = cellEditBase(cell)}
  {@const texts = baseTexts(base)}
  <!-- the price of UEX (or my cold one) stands in the field, muted, until the player touches it or sends it: then it is his -->
  {@const foreign = !base.priceIsOwn && !draft?.typed.price && !draft?.sent}
  {@const estimated = cell.ownScu !== null && cell.ownScuBase !== null}
  <div class="expand sc-reveal">
    <div class="edit">
      <input
        class="sc-input sc-num in-price"
        class:foreign
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

{#snippet head(key: TerminalSortKey, label: string, title: string)}
  <span role="columnheader" class:r={key === 'roi'} aria-sort={terminalAriaSort(sort, key)}>
    {#if onSort}
      <button type="button" class="sort" class:on={sort.key === key} {title} onclick={() => onSort(key)}>
        {#if sort.key === key && key === 'roi'}{@render arrow()}{/if}
        {label}
        {#if sort.key === key && key === 'name'}{@render arrow()}{/if}
      </button>
    {:else}
      <span {title}>{label}</span>
    {/if}
  </span>
{/snippet}

{#snippet arrow()}
  <svg class="arrow" viewBox="0 0 5 4" width="5" height="4" aria-hidden="true"><path d={sort.dir === 'asc' ? 'M2.5 0L5 4H0z' : 'M0 0H5L2.5 4z'} /></svg>
{/snippet}

{#if shown.length === 0}
  <p class="empty">{empty}</p>
{:else}
  <div class="table" role="table" aria-label={side === 'buy' ? 'Что можно купить' : 'Что можно продать'}>
    <div class="grid head sc-label" role="row">
      {@render head('name', 'Товар', 'Порядок по умолчанию: по названию товара')}
      <span role="columnheader" class="r price-head">Цена</span>
      <span role="columnheader" class="r">Мин–макс</span>
      <span role="columnheader" class="r">SCU</span>
      {@render head('roi', 'ROI', roiTitle)}
    </div>
    {#each shown as row (row.commodityId)}
      {@const cell = row[side]}
      {#if cell}
        {@const selected = row.commodityId === selectedCommodityId}
        {@const scu = cellScu(cell, side)}
        {@const span = rangeView(cell.range)}
        {@const best = roi.get(row.commodityId)}
        {@const held = hold.get(row.commodityId)}
        <!-- the number of the ROI is a button of its own, beside the one of the row (a button inside a button is not allowed):
             a click on it asks for the options and does not open the row -->
        <div class="row {best ? `tier-${best.tier}` : ''}" class:selected class:hot={best?.hot} class:pulse={pulse.has(row.commodityId)} role="row">
          <div class="top">
            <button type="button" class="grid line" aria-expanded={selected} onclick={() => toggle(row.commodityId)}>
              <span class="name" title={row.name}>
                <span class="code">{row.code}</span><span class="full">{row.name}</span>
                {#if held}
                  {@const mark = holdMark(held)}
                  <span class="hold" title={mark.title}>
                    <svg class="box" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><rect x="0.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" /><rect x="2.5" y="2.5" width="3" height="3" fill="currentColor" /></svg>
                    <span class="sc-num">{mark.text}</span>
                  </span>
                {/if}
              </span>
              <span class="price sc-num" class:hint={cell.own === null}>
                {#if cell.warn}<span class="bang" title="Цена далеко от истории UEX: проверь цифру">!</span>{/if}
                <TrendMark trend={cell.trend} />
                <span class="digits">{cell.own === null && cell.hint === null ? '—' : formatUec(cell.own ?? cell.hint ?? 0)}</span>
                {#if cell.badge}<TempBadge compact text={cell.badge.text} kind={cell.badge.kind} />{:else}<span class="nomark"></span>{/if}
              </span>
              <span class="range sc-num" data-range={span.kind} title={span.title}>{span.text}</span>
              <span class="scu sc-num" class:hint={scu === null || !scu.own} title={scu === null ? unknownScuTitle(side) : scu.title}>{scu === null ? '—' : `${scu.estimated ? '≈' : ''}${scu.text}`}</span>
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
  /* The columns, named once for the head and for the rows. Measured on the real texts (the gallery state `roi-long`): a
     seven-digit price is 47 px, a spread of four-digit numbers in «Мин–макс» 52 px (a six-digit one is about 73 by its
     digits), a stock of four digits with its «≈» 35 px, the ROI «990%» 26 px. What is left goes to the names: 180 px, where
     the longest there is, «RMC Recycled Material Composite», takes 168 */
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

  /* The two heads that sort are buttons as tall as the head, so the head keeps its height and the columns their widths: the label of «ROI»
     stays at the right edge, where the numbers are, and the arrow takes the room to its left; the arrow of «Товар» stands after the word. */
  .head [role='columnheader']:has(.sort) {
    display: flex;
    align-self: stretch;
    min-width: 0;
  }

  .head .r:has(.sort) {
    justify-content: flex-end;
  }

  /* The negative margin takes back the letter-spacing that follows the last letter, so that the label ends where the numbers do. */
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 100%;
    margin-right: -0.08em;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .sort:hover {
    color: var(--sc-text);
  }

  .sort.on {
    color: var(--sc-accent);
  }

  .arrow {
    flex: none;
    fill: currentColor;
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
     the padding of the row, so the texts do not move when a row gets one, and takes no clicks, so that the whole row opens */
  .row.hot .top::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: var(--tier);
    content: '';
    pointer-events: none;
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

  /* a commodity of my hold (sell side): a box and the quantity after the name; the name gives way to it, the columns of numbers do not move */
  .hold {
    display: flex;
    flex: none;
    align-items: center;
    gap: 3px;
    color: var(--sc-accent);
    font-size: var(--sc-font-sm);
  }

  .box {
    flex: none;
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

  /* a price that is not mine (UEX, or mine gone cold) reads as what the row says: muted, like the price of the row itself */
  .in-price.foreign {
    color: var(--sc-muted);
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
