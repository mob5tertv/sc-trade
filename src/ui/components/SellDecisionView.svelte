<script lang="ts">
  import type { SellAlternative, SellHere } from '../../core/sell';
  import type { Reference } from '../../core/types';
  import { sellAlternativeRow, sellHereRow } from '../vm/route-rows';
  import TempBadge from './TempBadge.svelte';

  interface Props {
    commodityCode: string;
    here: SellHere;
    /** The best other buyers; at most three are shown. */
    alternatives: SellAlternative[];
    reference: Reference;
  }
  let { commodityCode, here, alternatives, reference }: Props = $props();

  const MAX_ALTERNATIVES = 3;

  const hereRow = $derived(sellHereRow(here));
  const rows = $derived(alternatives.slice(0, MAX_ALTERNATIVES).map(a => sellAlternativeRow(a, reference)));
</script>

<section class="card" aria-label="Продать здесь или лететь дальше: {commodityCode}">
  <div class="here" title="Продать весь груз здесь и сейчас">
    <span class="caption">Здесь <span class="code">{commodityCode}</span></span>
    <span class="sc-num qty">{hereRow.qty}</span>
    <span class="item" title="Прибыль, если продать здесь">
      <span class="sc-label">Прибыль</span>
      <span class="sc-num" class:good={!hereRow.loss} class:loss={hereRow.loss}>{hereRow.profit}</span>
    </span>
    <span class="item" title="Прибыль к вложенному"><span class="sc-label">ROI</span><span class="sc-num">{hereRow.roi}</span></span>
    <span class="sc-num" title="UEC в час за время, что прошло с начала рейса">{hereRow.rate}</span>
  </div>

  {#if rows.length === 0}
    <p class="none">Других покупателей нет</p>
  {:else}
    <div class="table" role="table" aria-label="Другие покупатели">
      <div class="grid head sc-label" role="row">
        <span role="columnheader">Куда</span>
        <span role="columnheader" class="r">Цена</span>
        <span role="columnheader" class="r" title="Ожидаемая прибыль всего рейса">Прибыль</span>
        <span role="columnheader" class="r" title="UEC в час всего рейса при ожидаемой цене">Ждём</span>
        <span role="columnheader" class="r" title="UEC в час всего рейса при худшей цене диапазона">Худш.</span>
        <span role="columnheader" class="r" title="Сколько лететь отсюда">Лететь</span>
      </div>
      {#each rows as row (row.key)}
        <div class="grid line" role="row">
          <span class="terminal" title={row.terminal}>{row.terminal}</span>
          <span class="cell sc-num" title={row.price.range.kind === 'spread' ? `Диапазон цен ${row.price.range.text}` : undefined}>
            <span>{row.price.price}</span>
            <TempBadge compact text={row.price.badge.text} kind={row.price.badge.kind} />
          </span>
          <span class="sc-num" class:good={!row.loss} class:loss={row.loss}>{row.profit}</span>
          <span class="sc-num">{row.expectedRate}</span>
          <span class="sc-num">{row.worstRate}</span>
          <span class="sc-num">{row.extra}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .card {
    padding: 0;
  }

  .here {
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
    font-weight: 600;
  }

  .qty {
    color: var(--sc-muted);
  }

  .item {
    display: flex;
    gap: 5px;
  }

  .here > :last-child {
    margin-left: auto;
  }

  .code {
    color: var(--sc-label);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 62px 62px 52px 56px 44px;
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

  .line {
    height: var(--sc-row-h);
    border-bottom: 1px solid var(--sc-surface-2);
  }

  .here .sc-num,
  .line .sc-num {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
  }

  .good {
    color: var(--sc-good);
  }

  .loss {
    color: var(--sc-bad);
  }

  .none {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }
</style>
