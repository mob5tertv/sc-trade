<script lang="ts">
  import type { HistoryRow } from '../vm/stats-rows';

  let { rows }: { rows: HistoryRow[] } = $props();

  const STATUS: Record<HistoryRow['status'], string> = { active: 'идёт', done: 'завершён', lost: 'потерян' };
  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#if rows.length === 0}
  <p class="empty">Рейсов пока нет.</p>
{:else}
  <ul class="list">
    {#each rows as row (row.runId)}
      <li class="item">
        <div class="head">
          <span class="when num">{row.when}</span>
          <span class="title" title={row.title}>{row.title}</span>
          <span class="status {row.status}">{STATUS[row.status]}</span>
        </div>
        <div class="metrics num">
          <span class="profit" class:loss={isLoss(row.profit)} title="Прибыль">{row.profit}</span>
          <span title="ROI">{row.roi}</span>
          <span title="Длительность">{row.duration}</span>
          <span title="UEC в час">{row.rate}</span>
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
    grid-template-columns: 84px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sc-gap);
    min-height: 26px;
  }

  .when {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-size: var(--sc-font-sm);
    color: var(--sc-muted);
  }

  .status.active {
    color: var(--sc-accent);
  }

  .status.lost {
    color: var(--sc-bad);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sc-gap);
    min-height: 22px;
    padding-left: 92px;
    font-size: var(--sc-font-sm);
    text-align: right;
  }

  .metrics span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profit {
    font-weight: 600;
  }

  .loss {
    color: var(--sc-bad);
  }

  .num {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: var(--sc-gap);
    color: var(--sc-muted);
  }
</style>
