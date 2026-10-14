<script lang="ts">
  import { resolveQuickEntry } from '../vm/quick-entry';
  import type { RecordRow } from '../vm/records';
  import ConfirmButton from './ConfirmButton.svelte';

  interface Props {
    /** The player's records in the order to show them (the owner filters and sorts). */
    rows: RecordRow[];
    /** Writes the corrected price and quantity of one record; the answer is the sentence to show when it failed, `null` when it was written. */
    onEdit: (edit: { id: number; price: number; scu: number | null }) => Promise<string | null>;
    /** Takes the record out of the diary. */
    onRemove: (row: RecordRow) => void;
    /** What the list says when it is empty. */
    emptyText?: string;
  }
  let { rows, onEdit, onRemove, emptyText = 'Своих записей цен пока нет' }: Props = $props();

  // One row is open at a time: its price and quantity can be typed over.
  let openId = $state<number | null>(null);
  let priceText = $state('');
  let scuText = $state('');
  let failure = $state<string | null>(null);
  let busy = $state(false);

  function toggle(row: RecordRow): void {
    failure = null;
    if (openId === row.id) {
      openId = null;
      return;
    }
    openId = row.id;
    priceText = row.priceText;
    scuText = row.scuText;
  }

  /** The numbers typed for the open row when they can be read and differ from what is recorded; `null` otherwise. */
  function changed(row: RecordRow): { price: number; scu: number | null } | null {
    const input = resolveQuickEntry(priceText, scuText);
    if (!input.ok || (input.price === row.price && input.scu === row.scu)) return null;
    return { price: input.price, scu: input.scu };
  }

  async function save(event: SubmitEvent, row: RecordRow): Promise<void> {
    event.preventDefault();
    const next = changed(row);
    if (next === null || busy) return;
    busy = true;
    try {
      failure = await onEdit({ id: row.id, ...next });
      if (failure === null) openId = null;
    } finally {
      busy = false;
    }
  }
</script>

{#if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <div class="table" role="table" aria-label="Мои записи цен">
    <div class="grid head sc-label" role="row">
      <span role="columnheader">Когда</span>
      <span role="columnheader">Станция</span>
      <span role="columnheader">Товар</span>
      <span role="columnheader" class="r">Цена</span>
      <span role="columnheader" class="r">SCU</span>
    </div>
    {#each rows as row (row.id)}
      <div
        class="grid line"
        class:open={openId === row.id}
        class:doubt={row.doubt !== null}
        role="row"
        tabindex="0"
        title={row.doubt === null ? `Записано ${row.age} назад. Клик — исправить или убрать` : `${row.doubt}. Клик — исправить или убрать`}
        onkeydown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row); } }}
        onclick={() => toggle(row)}
      >
        <span class="when sc-num">{row.when}</span>
        <span class="terminal">{row.terminal}</span>
        <span class="what" title={row.name}><span class="code">{row.code}</span><span class="side">{row.sideLabel}</span></span>
        <span class="price sc-num">{#if row.doubt !== null}<span class="bang" aria-hidden="true">!</span>{/if}{row.priceText}</span>
        <span class="sc-num r">{row.scu === null ? '—' : row.scuText}</span>
      </div>
      {#if openId === row.id}
        <form class="edit sc-reveal" novalidate onsubmit={(e) => void save(e, row)}>
          <input
            class="sc-input sc-num in-price"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            data-select-on-focus
            aria-label="Цена, UEC за SCU"
            title="Цена, UEC за SCU"
            bind:value={priceText}
          />
          <input
            class="sc-input sc-num in-scu"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            data-select-on-focus
            placeholder="SCU"
            aria-label="Количество, SCU (можно не вводить)"
            title="Количество, SCU (можно не вводить)"
            bind:value={scuText}
          />
          <button type="submit" class="sc-btn sc-btn--act" disabled={changed(row) === null || busy} title="Записать исправленные цену и количество. Время записи не меняется">Исправить</button>
          <span class="spacer"></span>
          <ConfirmButton
            label="Убрать запись"
            sureLabel="Точно убрать?"
            title="Убрать эту запись из дневника. Если до неё была другая твоя запись, вернётся она, иначе цена UEX"
            onConfirm={() => { openId = null; onRemove(row); }}
          />
        </form>
        {#if row.doubt !== null}<p class="note">{row.doubt}.</p>{/if}
        {#if failure !== null}<p class="note failure" role="alert">{failure}</p>{/if}
      {/if}
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 84px 66px 44px;
    column-gap: 4px;
    align-items: center;
    padding: 0 var(--sc-pad-x);
  }

  /* the line of heads stays at the top of the body while the rows scroll under it */
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-bg-solid);
    color: var(--sc-muted);
    white-space: nowrap;
  }

  .r {
    text-align: right;
  }

  .line {
    height: var(--sc-row-h);
    border-bottom: 1px solid var(--sc-surface-2);
    cursor: pointer;
  }

  .line:hover,
  .line.open {
    background: var(--sc-surface-2);
  }

  .line:focus-visible {
    outline: 1px solid var(--sc-accent);
    outline-offset: -1px;
  }

  .line span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .when {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .what {
    display: flex;
    gap: 5px;
    min-width: 0;
  }

  .code {
    flex: none;
    font-weight: 600;
  }

  .side {
    color: var(--sc-label);
    font-size: var(--sc-font-sm);
  }

  .price {
    text-align: right;
  }

  .bang {
    margin-right: 3px;
    color: var(--sc-warn);
    font-weight: 600;
  }

  .doubt .price {
    color: var(--sc-warn);
  }

  .edit {
    display: flex;
    align-items: center;
    gap: var(--sc-gap);
    height: calc(var(--sc-row-h) + 4px);
    padding: 0 var(--sc-pad-x);
    background: var(--sc-surface);
  }

  .in-price {
    flex: none;
    width: 76px;
    text-align: right;
  }

  .in-scu {
    flex: none;
    width: 56px;
    text-align: right;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .note,
  .empty {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    min-height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }

  .note {
    background: var(--sc-surface);
    font-size: var(--sc-font-sm);
  }

  .note.failure {
    color: var(--sc-bad);
  }
</style>
