<script lang="ts">
  import type { RouteRow } from '../vm/stats-rows';

  let { rows }: { rows: RouteRow[] } = $props();

  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#if rows.length === 0}
  <p class="empty">Заверши первый рейс — здесь появится твой рейтинг маршрутов</p>
{:else}
  <ul class="list">
    {#each rows as row (row.key)}
      <li class="item">
        <div class="head">
          <span class="route" title={row.route}>{row.route}</span>
          <span class="code">{row.commodity}</span>
          <span class="num strong" title="UEC в час">{row.rate}</span>
        </div>
        <div class="metrics">
          <span title="Число завершённых рейсов"><span class="muted">рейсов</span> <span class="num">{row.runs}</span></span>
          <span title="Медианное время рейса"><span class="num">{row.time}</span></span>
          {#if row.phases}
            <span title="Погрузка · полёт · разгрузка"><span class="num">{row.phases}</span></span>
          {/if}
          <span title="Суммарная прибыль"><span class="num" class:loss={isLoss(row.profit)}>{row.profit}</span></span>
          <span title="Средний ROI"><span class="muted">ROI</span> <span class="num">{row.roi}</span></span>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    padding: 2px 6px;
    border-bottom: 1px solid var(--sc-border);
  }

  .head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 72px;
    align-items: center;
    gap: var(--sc-gap);
    min-height: 26px;
  }

  .route {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .code {
    font-family: var(--sc-mono);
  }

  .head .num {
    text-align: right;
  }

  .metrics {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    min-height: 22px;
    font-size: var(--sc-font-sm);
  }

  .num {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
  }

  .strong {
    font-weight: 600;
  }

  .muted {
    color: var(--sc-muted);
  }

  .loss {
    color: var(--sc-bad);
  }

  .empty {
    margin: 0;
    padding: var(--sc-gap);
    color: var(--sc-muted);
  }
</style>
