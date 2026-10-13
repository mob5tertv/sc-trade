<script lang="ts">
  import type { HoldSet, TargetGoodsRow } from '../vm/target-goods';
  import TempBadge from './TempBadge.svelte';

  interface Props {
    /** The goods of the pair, the best first. */
    rows: TargetGoodsRow[];
    /** The set that fills the hold; `null` when nothing can be taken. */
    set: HoldSet | null;
    /** What to say instead of the list when the pair has no goods. */
    emptyText: string;
  }
  let { rows, set, emptyText }: Props = $props();
</script>

{#if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  {#if set !== null}
    <div class="set" title="Товары разложены по вместимости, запасу на станции и бюджету: сначала тот, что приносит больше с одного SCU">
      <span class="caption">{set.caption}</span>
      <span class="item"><span class="sc-label">Вложить</span><span class="sc-num">{set.invested}</span></span>
      <span class="item"><span class="sc-label">Прибыль</span><span class="sc-num good">{set.profit}</span></span>
      <span class="item"><span class="sc-label">ROI</span><span class="sc-num">{set.roi}</span></span>
    </div>
    {#if set.note !== null}<p class="note">{set.note}</p>{/if}
  {/if}
  <div class="table" role="table" aria-label="Товары к цели">
    <div class="grid head sc-label" role="row">
      <span role="columnheader">Товар</span>
      <span role="columnheader" class="r" title="Цена закупки на этой станции">Купить</span>
      <span role="columnheader" class="r" title="Цена продажи в точке цели">Продать</span>
      <span role="columnheader" class="r">ROI</span>
      <span role="columnheader" class="r" title="Сколько взять в этот набор, SCU">Взять</span>
      <span role="columnheader" class="r" title="Ожидаемая прибыль с этой части набора">Прибыль</span>
    </div>
    {#each rows as row (row.key)}
      <div class="grid line tier-{row.tier}" class:out={row.take === '—'} role="row">
        <span class="what" title={row.name}><span class="code">{row.code}</span><span class="name">{row.name}</span></span>
        <span class="cell sc-num"><span>{row.buy.price}</span><TempBadge compact text={row.buy.badge.text} kind={row.buy.badge.kind} /></span>
        <span class="cell sc-num"><span>{row.sell.price}</span><TempBadge compact text={row.sell.badge.text} kind={row.sell.badge.kind} /></span>
        <span class="sc-num roi">{row.roi}</span>
        <span class="sc-num take" title={row.takeTitle}>{row.take}{#if row.unsure}<span class="unsure" role="img" aria-label="Запас неизвестен">?</span>{/if}</span>
        <span class="sc-num">{row.profit}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .set {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--sc-row-h);
    padding: 0 var(--sc-pad-x);
    background: var(--sc-surface);
    white-space: nowrap;
  }

  .caption {
    flex: none;
    margin-right: auto;
    font-weight: 600;
  }

  .item {
    display: flex;
    gap: 5px;
  }

  .good {
    color: var(--sc-good);
  }

  .note,
  .empty {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    overflow: hidden;
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    color: var(--sc-warn);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 62px 62px 40px 46px 62px;
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

  .r,
  .line > .sc-num {
    text-align: right;
  }

  .line {
    height: var(--sc-row-h);
    border-bottom: 1px solid var(--sc-surface-2);
    border-left: 3px solid var(--tier);
    padding-left: calc(var(--sc-pad-x) - 3px);
  }

  .tier-great { --tier: var(--sc-roi-great); }
  .tier-good { --tier: var(--sc-roi-good); }
  .tier-ok { --tier: var(--sc-roi-ok); }
  .tier-poor { --tier: var(--sc-roi-poor); }
  .tier-loss { --tier: var(--sc-roi-loss); }

  /* a commodity that did not get into the set is still listed, muted: the player may prefer it */
  .line.out {
    color: var(--sc-muted);
  }

  .what {
    display: flex;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .code {
    flex: none;
    font-weight: 600;
  }

  .name {
    overflow: hidden;
    color: var(--sc-muted);
    text-overflow: ellipsis;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
  }

  .roi {
    color: var(--tier);
  }

  .take {
    font-weight: 600;
  }

  .line.out .take {
    font-weight: 400;
  }

  .unsure {
    margin-left: 2px;
    color: var(--sc-warn);
  }
</style>
