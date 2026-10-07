<script lang="ts">
  import type { RouteRow } from '../vm/stats-rows';

  let { rows }: { rows: RouteRow[] } = $props();

  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#if rows.length === 0}
  <p class="empty">Заверши первый рейс — здесь появится рейтинг маршрутов</p>
{:else}
  <div class="table" role="table" aria-label="Мои маршруты">
    <div class="grid head sc-label" role="row">
      <span role="columnheader">Маршрут</span>
      <span role="columnheader">Товар</span>
      <span role="columnheader" class="r">UEC/ч</span>
      <span role="columnheader" class="r" title="Число завершённых рейсов">Рейс</span>
      <span role="columnheader" class="r">Время</span>
      <span role="columnheader" class="r">Прибыль</span>
      <span role="columnheader" class="r">ROI</span>
    </div>
    {#each rows as row (row.key)}
      <div class="grid line" role="row">
        <span class="route" title={row.route}>{row.route}</span>
        <span class="code">{row.commodity}</span>
        <span class="sc-num strong" title="UEC в час">{row.rate}</span>
        <span class="sc-num" title="Число завершённых рейсов">{row.runs}</span>
        <span class="sc-num" title={row.phases ? `Медианное время: погрузка · полёт · разгрузка ${row.phases}` : 'Медианное время рейса'}>{row.time}</span>
        <span class="sc-num" class:loss={isLoss(row.profit)} title="Суммарная прибыль">{row.profit}</span>
        <span class="sc-num" title="Средний ROI">{row.roi}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 38px 54px 32px 46px 62px 46px;
    column-gap: 4px;
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

  .line span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .code {
    color: var(--sc-label);
    font-weight: 600;
  }

  .strong {
    font-weight: 600;
  }

  .loss {
    color: var(--sc-bad);
  }

  .empty {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }
</style>
