<script lang="ts">
  import { untrack } from 'svelte';
  import { formatUec } from '../../core/format';
  import type { Side } from '../../core/types';
  import { baseTexts, cellEditBase, resolveCellEdit } from '../vm/inputs';
  import type { EditBase } from '../vm/inputs';
  import type { Cell, TerminalRow } from '../vm/terminal-rows';
  import TempBadge from './TempBadge.svelte';

  interface Props {
    rows: TerminalRow[];
    selectedCommodityId: number | null;
    onSelect: (commodityId: number) => void;
    /** `scu` is what the quantity input holds when the price is saved; `null` while it is empty (unknown). */
    onSavePrice: (e: { commodityId: number; side: Side; price: number; scu: number | null }) => void;
    onLookup: (e: { commodityId: number; side: Side }) => void;
    onTrade: (e: { commodityId: number; side: Side }) => void;
  }
  let { rows, selectedCommodityId, onSelect, onSavePrice, onLookup, onTrade }: Props = $props();

  /**
   * What is being typed into one cell (one commodity, one side). A cell with no draft shows its values from
   * `rows`. `sent` is set once the draft was handed to `onSavePrice`: the typed text then stays on screen
   * until `rows` is refreshed, so the number does not jump back to the old one in between.
   */
  interface Draft { price: string; scu: string; bad: { price: boolean; scu: boolean }; sent: EditBase | null }
  let drafts = $state<Record<string, Draft>>({});

  const keyOf = (commodityId: number, side: Side): string => `${commodityId}:${side}`;

  // A refresh of the rows carries what was sent. A draft that was edited again since stays and is compared with the new values.
  $effect(() => {
    void rows;
    untrack(() => {
      for (const [key, draft] of Object.entries(drafts)) {
        if (draft.sent === null) continue;
        const sent = baseTexts(draft.sent);
        if (draft.price === sent.price && draft.scu === sent.scu) delete drafts[key];
        else draft.sent = null;
      }
    });
  });

  function type(key: string, cell: Cell, field: 'price' | 'scu', text: string): void {
    const draft = drafts[key] ?? { ...baseTexts(cellEditBase(cell)), bad: { price: false, scu: false }, sent: null };
    draft[field] = text;
    draft.bad[field] = false;
    drafts[key] = draft;
  }

  function commit(commodityId: number, side: Side, cell: Cell): void {
    const key = keyOf(commodityId, side);
    const draft = drafts[key];
    if (!draft) return;
    const edit = resolveCellEdit(draft.price, draft.scu, draft.sent ?? cellEditBase(cell));
    if (edit.kind === 'unchanged') {
      if (draft.sent === null) delete drafts[key];
      return;
    }
    if (edit.kind === 'invalid') {
      draft.bad = { price: edit.price, scu: edit.scu };
      return;
    }
    const sent = { price: edit.price, scu: edit.scu };
    drafts[key] = { ...baseTexts(sent), bad: { price: false, scu: false }, sent };
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

  const select = (commodityId: number): void => {
    if (commodityId !== selectedCommodityId) onSelect(commodityId);
  };

  const placeholder = (n: number | null): string => (n === null ? '—' : formatUec(n));
</script>

{#snippet sideLine(row: TerminalRow, cell: Cell, side: Side)}
  {@const key = keyOf(row.commodityId, side)}
  {@const draft = drafts[key]}
  {@const texts = baseTexts(cellEditBase(cell))}
  {@const estimated = cell.ownScu !== null && cell.ownScuBase !== null}
  <div class="side">
    <span class="label">{side === 'buy' ? 'Купить' : 'Продать'}</span>
    <input
      class="num price"
      class:invalid={draft?.bad.price}
      type="text"
      inputmode="numeric"
      autocomplete="off"
      data-cell={key}
      aria-label="{row.code}: цена {side === 'buy' ? 'покупки' : 'продажи'}, UEC за SCU"
      aria-invalid={draft?.bad.price ? 'true' : undefined}
      placeholder={placeholder(cell.hint)}
      value={draft?.price ?? texts.price}
      oninput={e => type(key, cell, 'price', e.currentTarget.value)}
      onkeydown={e => onKeydown(e, row.commodityId, side, cell)}
      onblur={e => onBlur(e, row.commodityId, side, cell)}
    />
    <input
      class="num scu"
      class:invalid={draft?.bad.scu}
      type="text"
      inputmode="numeric"
      autocomplete="off"
      data-cell={key}
      aria-label={side === 'buy' ? `${row.code}: количество у продавца, SCU` : `${row.code}: количество у покупателя на складе, SCU`}
      aria-invalid={draft?.bad.scu ? 'true' : undefined}
      placeholder={placeholder(cell.hintScu)}
      value={draft?.scu ?? texts.scu}
      oninput={e => type(key, cell, 'scu', e.currentTarget.value)}
      onkeydown={e => onKeydown(e, row.commodityId, side, cell)}
      onblur={e => onBlur(e, row.commodityId, side, cell)}
    />
    {#if estimated && cell.ownScu !== null}
      <span class="est" title="Оценка по таймеру пополнения: сколько там сейчас">≈ {formatUec(cell.ownScu)}</span>
    {:else if side === 'sell'}
      <span class="unit" title="Столько уже лежит на складе у покупателя, а не сколько он готов купить">у покупателя</span>
    {:else}
      <span class="unit">SCU</span>
    {/if}
    <span class="actions">
      {#if side === 'buy'}
        <button type="button" onclick={() => onLookup({ commodityId: row.commodityId, side })}>Где продать</button>
        <button type="button" onclick={() => onTrade({ commodityId: row.commodityId, side })}>Купил</button>
      {:else}
        <button type="button" onclick={() => onLookup({ commodityId: row.commodityId, side })}>Где купить</button>
        <button type="button" onclick={() => onTrade({ commodityId: row.commodityId, side })}>Продал</button>
      {/if}
    </span>
  </div>
  {#if cell.badge || cell.warn || cell.uexRange || cell.ownLast || (estimated && cell.ownScuBase)}
    <div class="meta">
      {#if cell.badge}<TempBadge text={cell.badge.text} kind={cell.badge.kind} />{/if}
      {#if cell.warn}<span class="warn">проверь цифру</span>{/if}
      {#if cell.uexRange}
        <span class="muted" title="Диапазон UEX за неделю">UEX {formatUec(cell.uexRange.low)}–{formatUec(cell.uexRange.high)}</span>
      {/if}
      {#if cell.ownLast}
        <span class="muted">моя была {formatUec(cell.ownLast.price)} · {cell.ownLast.age}</span>
      {/if}
      {#if estimated && cell.ownScuBase}
        <span class="muted">было {formatUec(cell.ownScuBase.scu)} · {cell.ownScuBase.age}</span>
        {#if cell.ownScuRate === 'learned'}
          <span class="rate learned" title="Скорость пополнения выучена по твоим замерам">скорость выучена</span>
        {:else if cell.ownScuRate === 'default'}
          <span class="rate" title="По твоим замерам скорость пополнения ещё не выучена, взята запасная">скорость запасная</span>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}

{#if rows.length === 0}
  <p class="empty">Для этой точки пока нет цен.</p>
{:else}
  <ul class="rows">
    {#each rows as row (row.commodityId)}
      <li class="row" class:selected={row.commodityId === selectedCommodityId} onfocusin={() => select(row.commodityId)}>
        <button type="button" class="head" tabindex="-1" title={row.name} onclick={() => select(row.commodityId)}>
          <span class="code">{row.code}</span>
          <span class="name">{row.name}</span>
        </button>
        {#if row.buy}{@render sideLine(row, row.buy, 'buy')}{/if}
        {#if row.sell}{@render sideLine(row, row.sell, 'sell')}{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    padding: 2px 6px 4px;
    border-bottom: 1px solid var(--sc-border);
  }

  .row.selected {
    background: var(--sc-surface-2);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--sc-gap);
    width: 100%;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .code {
    flex: none;
    font-family: var(--sc-mono);
    font-weight: 600;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .side {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
    min-height: 28px;
  }

  .label {
    flex: none;
    width: 52px;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  input {
    box-sizing: border-box;
    height: 26px;
    padding: 0 6px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-surface);
    color: var(--sc-text);
    font: inherit;
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  input::placeholder {
    color: var(--sc-muted);
  }

  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--sc-accent);
    outline-offset: 1px;
  }

  input.invalid {
    border-color: var(--sc-bad);
  }

  .price {
    width: 76px;
  }

  .scu {
    width: 64px;
  }

  .unit,
  .est {
    font-size: var(--sc-font-sm);
    white-space: nowrap;
  }

  .unit {
    color: var(--sc-muted);
  }

  .est {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .actions button {
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    font-size: var(--sc-font-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .actions button:hover {
    background: var(--sc-surface-2);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-height: 18px;
    padding-left: 58px;
    font-size: var(--sc-font-sm);
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
    border-radius: var(--sc-radius);
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    line-height: 14px;
  }

  .rate.learned {
    border-color: var(--sc-good);
    color: var(--sc-good);
  }

  .empty {
    margin: 0;
    padding: var(--sc-gap);
    color: var(--sc-muted);
  }
</style>
