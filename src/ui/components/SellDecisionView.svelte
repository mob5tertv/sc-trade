<script lang="ts">
  import type { SellAlternative, SellHere } from '../../core/sell';
  import type { Pace } from '../../core/stats';
  import type { Reference } from '../../core/types';
  import { paceLine, sellAlternativeRow, sellHereRow } from '../vm/route-rows';
  import TempBadge from './TempBadge.svelte';

  interface Props {
    commodityCode: string;
    here: SellHere;
    /** The best other buyers; at most three are shown. */
    alternatives: SellAlternative[];
    reference: Reference;
    /** The setting «Подробные расчёты»: the low end of the range, the rate of the further leg and the usual pace beside it. */
    detailed?: boolean;
    /** The player's usual pace, the yardstick of the rate; `null` while he has no finished run. Read only when `detailed`. */
    pace?: Pace | null;
  }
  let { commodityCode, here, alternatives, reference, detailed = false, pace = null }: Props = $props();

  const MAX_ALTERNATIVES = 3;

  const hereRow = $derived(sellHereRow(here));
  const rows = $derived(alternatives.slice(0, MAX_ALTERNATIVES).map(a => sellAlternativeRow(a, reference, pace?.uecPerHour ?? null)));
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
    {#if detailed}
      <span class="sc-num" title="UEC в час за время, что прошло с начала рейса">{hereRow.rate}</span>
    {/if}
  </div>

  {#if rows.length === 0}
    <p class="none">Других покупателей нет</p>
  {:else}
    <div class="table" class:detailed role="table" aria-label="Лететь дальше">
      <div class="grid head sc-label" role="row">
        <span role="columnheader">Лететь дальше</span>
        <span role="columnheader" class="r">Цена</span>
        <span role="columnheader" class="r" title="Сколько добавит перелёт туда к продаже здесь">Добавка</span>
        {#if detailed}
          <span role="columnheader" class="r" title="Добавка, если там заплатят по нижней цене диапазона. У твоей цены диапазона нет — прочерк">По нижней</span>
          <span role="columnheader" class="r" title="Добавка, делённая на время пути: сколько в час зарабатывает сам перелёт дальше">В час</span>
        {/if}
        <span role="columnheader" class="r" title="Сколько займёт путь отсюда: перелёт и выгрузка">Лететь</span>
      </div>
      {#each rows as row (row.key)}
        <div class="grid line" role="row">
          <span class="terminal" title={row.terminal}>{row.terminal}</span>
          <span class="cell sc-num" title={row.price.range.kind === 'spread' ? `Диапазон цен ${row.price.range.text}` : undefined}>
            <span>{row.price.price}</span>
            <TempBadge compact text={row.price.badge.text} kind={row.price.badge.kind} />
          </span>
          <span class="sc-num" class:good={!row.loss} class:loss={row.loss}>{row.extra}</span>
          {#if detailed}
            <span class="sc-num" class:loss={row.extraLowLoss}>{row.extraLow}</span>
            <span
              class="sc-num"
              class:good={row.rateTone === 'above'}
              class:low={row.rateTone === 'below'}
              title={row.rateTone === 'above' ? 'Выше твоего обычного темпа' : row.rateTone === 'below' ? 'Ниже твоего обычного темпа' : undefined}
            >{row.rate}</span>
          {/if}
          <span class="sc-num" title={row.timeTitle ?? 'Нет ни твоих рейсов по этой паре, ни расстояния'}>{row.time}</span>
        </div>
      {/each}
    </div>
    {#if detailed}
      <p class="pace" title="Средний заработок в час по твоим последним рейсам, потерянные входят. Лететь дальше стоит, когда «В час» выше">{paceLine(pace)}</p>
    {/if}
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

  .here > .sc-num:last-child {
    margin-left: auto;
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
    grid-template-columns: minmax(0, 1fr) 62px 62px 62px 52px 52px;
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

  .low {
    color: var(--sc-muted);
  }

  .none,
  .pace {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }

  .pace {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
