<script lang="ts">
  import type { SellAlternative, SellHere } from '../../core/sell';
  import type { Reference } from '../../core/types';
  import { sellAlternativeRow, sellHereRow } from '../vm/route-rows';
  import TempBadge from './TempBadge.svelte';
  import { tr } from '../../i18n';

  interface Props {
    commodityCode: string;
    here: SellHere;
    /** The best other buyers; at most three are shown. */
    alternatives: SellAlternative[];
    reference: Reference;
    /** The setting «Подробные расчёты»: what flying on adds at the low end of the price range there. */
    detailed?: boolean;
  }
  let { commodityCode, here, alternatives, reference, detailed = false }: Props = $props();

  const MAX_ALTERNATIVES = 3;

  const hereRow = $derived(sellHereRow(here));
  const rows = $derived(alternatives.slice(0, MAX_ALTERNATIVES).map(a => sellAlternativeRow(a, reference)));
</script>

<section class="card" aria-label={tr('Продать здесь или лететь дальше: {commodityCode}', { commodityCode })}>
  <div class="here" title={tr('Продать весь груз здесь и сейчас')}>
    <span class="caption">{tr('Здесь')} <span class="code">{commodityCode}</span></span>
    <span class="sc-num qty">{hereRow.qty}</span>
    <span class="item" title={tr('Прибыль, если продать здесь')}>
      <span class="sc-label">{tr('Прибыль')}</span>
      <span class="sc-num" class:good={!hereRow.loss} class:loss={hereRow.loss}>{hereRow.profit}</span>
    </span>
    <span class="item" title={tr('Прибыль к вложенному')}><span class="sc-label">ROI</span><span class="sc-num">{hereRow.roi}</span></span>
  </div>

  {#if rows.length === 0}
    <p class="none">{tr('Других покупателей нет')}</p>
  {:else}
    <div class="table" class:detailed role="table" aria-label={tr('Лететь дальше')}>
      <div class="grid head sc-label" role="row">
        <span role="columnheader">{tr('Лететь дальше')}</span>
        <span role="columnheader" class="r">{tr('Цена')}</span>
        <span role="columnheader" class="r" title={tr('Сколько добавит перелёт туда к продаже здесь')}>{tr('Добавка')}</span>
        {#if detailed}
          <span role="columnheader" class="r" title={tr('Добавка, если там заплатят по нижней цене диапазона. У твоей цены диапазона нет — прочерк')}>{tr('По нижней')}</span>
        {/if}
        <span role="columnheader" class="r" title={tr('Сколько займёт путь отсюда: перелёт и выгрузка')}>{tr('Лететь')}</span>
      </div>
      {#each rows as row (row.key)}
        <div class="grid line" role="row">
          <span class="terminal" title={row.terminal}>{row.terminal}</span>
          <span class="cell sc-num" title={row.price.range.kind === 'spread' ? tr('Диапазон цен {text}', { text: row.price.range.text }) : undefined}>
            <span>{row.price.price}</span>
            <TempBadge compact text={row.price.badge.text} kind={row.price.badge.kind} />
          </span>
          <span class="sc-num" class:good={!row.loss} class:loss={row.loss}>{row.extra}</span>
          {#if detailed}
            <span class="sc-num" class:loss={row.extraLowLoss}>{row.extraLow}</span>
          {/if}
          <span class="sc-num" title={row.timeTitle ?? tr('Нет ни твоих рейсов по этой паре, ни расстояния')}>{row.time}</span>
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

  .code {
    color: var(--sc-label);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 62px 68px 56px;
    column-gap: var(--sc-gap);
    align-items: center;
    padding: 0 var(--sc-pad-x);
  }

  .detailed .grid {
    grid-template-columns: minmax(0, 1fr) 62px 66px 66px 56px;
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

  .line > .sc-num:not(.cell) {
    text-align: right;
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
