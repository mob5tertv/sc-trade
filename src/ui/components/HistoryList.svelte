<script lang="ts">
  import type { HistoryRow } from '../vm/stats-rows';

  let { rows }: { rows: HistoryRow[] } = $props();

  const STATUS: Record<HistoryRow['status'], string> = { active: 'идёт', done: 'завершён', lost: 'потерян' };
  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#if rows.length === 0}
  <p class="empty">Рейсов пока нет</p>
{:else}
  <div class="table" role="table" aria-label="История рейсов">
    <div class="grid head sc-label" role="row">
      <span role="columnheader">Когда</span>
      <span role="columnheader">Рейс</span>
      <span role="columnheader" class="r">Прибыль</span>
      <span role="columnheader" class="r">ROI</span>
      <span role="columnheader" class="r">Время</span>
      <span role="columnheader" class="r">UEC/ч</span>
    </div>
    {#each rows as row (row.runId)}
      <div class="grid line" role="row" title={STATUS[row.status]}>
        <span class="when sc-num">{row.when}</span>
        <span class="title {row.status}" title="{row.title} · {STATUS[row.status]}">{row.title}</span>
        <span class="sc-num profit" class:loss={isLoss(row.profit)} title="Прибыль">{row.profit}</span>
        <span class="sc-num" title="ROI">{row.roi}</span>
        <span class="sc-num" title="Длительность">{row.duration}</span>
        <span class="sc-num" title="UEC в час">{row.rate}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 62px 52px 46px 54px;
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

  .when {
    color: var(--sc-muted);
    text-align: left;
  }

  .title.active {
    color: var(--sc-accent);
  }

  .title.lost {
    color: var(--sc-bad);
  }

  .profit {
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
