<script lang="ts">
  import { untrack } from 'svelte';
  import { formatUec } from '../../core/format';
  import type { Side } from '../../core/types';
  import { baseTexts, cellEditBase, resolveCellEdit } from '../vm/inputs';
  import type { EditBase } from '../vm/inputs';
  import { cellScu } from '../vm/terminal-rows';
  import type { Cell, TerminalRow } from '../vm/terminal-rows';
  import TempBadge from './TempBadge.svelte';

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
  }
  let { rows, side, selectedCommodityId, scope = '', onSelect, onSavePrice, onLookup, onTrade }: Props = $props();

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
  const range = (cell: Cell): string | null => (cell.range === null ? null : `${formatUec(cell.range.low)}–${formatUec(cell.range.high)}`);
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
    {#if cell.badge || cell.warn || cell.ownLast || (estimated && cell.ownScuBase)}
      <div class="meta">
        {#if cell.badge}<TempBadge text={cell.badge.text} kind={cell.badge.kind} />{/if}
        {#if estimated && cell.ownScuBase}
          <span class="muted">было {formatUec(cell.ownScuBase.scu)} · {cell.ownScuBase.age}</span>
          {#if cell.ownScuRate === 'learned'}
            <span class="rate learned" title="Скорость пополнения выучена по твоим замерам">скорость выучена</span>
          {:else if cell.ownScuRate === 'default'}
            <span class="rate" title="По твоим замерам скорость пополнения ещё не выучена, взята запасная">скорость запасная</span>
          {/if}
        {/if}
        {#if cell.ownLast}
          <span class="muted">моя была {formatUec(cell.ownLast.price)} · {cell.ownLast.age}</span>
        {/if}
        {#if cell.warn}<span class="warn">проверь цифру</span>{/if}
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
    </div>
    {#each shown as row (row.commodityId)}
      {@const cell = row[side]}
      {#if cell}
        {@const selected = row.commodityId === selectedCommodityId}
        {@const scu = cellScu(cell, side)}
        {@const span = range(cell)}
        <div class="row" class:selected role="row">
          <button type="button" class="grid line" aria-expanded={selected} onclick={() => toggle(row.commodityId)}>
            <span class="name" title={row.name}><span class="code">{row.code}</span><span class="full">{row.name}</span></span>
            <span class="price sc-num" class:hint={cell.own === null}>
              {#if cell.warn}<span class="bang" title="Цена далеко от истории UEX: проверь цифру">!</span>{/if}
              <span class="digits">{cell.own === null && cell.hint === null ? '—' : formatUec(cell.own ?? cell.hint ?? 0)}</span>
              {#if cell.badge}<TempBadge compact text={cell.badge.text} kind={cell.badge.kind} />{:else}<span class="nomark"></span>{/if}
            </span>
            <span class="range sc-num" title={span === null ? undefined : 'Диапазон цен по данным UEX'}>{span ?? '—'}</span>
            <span class="scu sc-num" class:hint={scu === null || !scu.own} title={scu?.title}>{scu === null ? '—' : `${scu.estimated ? '≈' : ''}${scu.text}`}</span>
          </button>
          {#if selected}{@render expanded(row, cell)}{/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 62px 80px 52px;
    column-gap: var(--sc-gap);
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

  .line {
    width: 100%;
    height: calc(var(--sc-row-h) - 1px);
    border: 0;
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .line:hover,
  .row.selected .line {
    background: var(--sc-surface-2);
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
