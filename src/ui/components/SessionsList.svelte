<script lang="ts">
  import type { SessionRow } from '../vm/stats-rows';

  let { rows }: { rows: SessionRow[] } = $props();

  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#if rows.length === 0}
  <p class="empty">Сессий пока нет.</p>
{:else}
  <div class="table" role="table" aria-label="Сессии">
    <div class="row header" role="row">
      <span role="columnheader">Начало</span>
      <span role="columnheader" class="r">Длит.</span>
      <span role="columnheader" class="r">Рейсов</span>
      <span role="columnheader" class="r">Прибыль</span>
      <span role="columnheader" class="r">UEC/ч</span>
    </div>
    {#each rows as row}
      <div class="row" role="row">
        <span role="cell" class="num when">{row.when}</span>
        <span role="cell" class="num r">{row.duration}</span>
        <span role="cell" class="num r">{row.runs}</span>
        <span role="cell" class="num r profit" class:loss={isLoss(row.profit)}>{row.profit}</span>
        <span role="cell" class="num r">{row.rate}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px 48px 84px 64px;
    align-items: center;
    gap: var(--sc-gap);
    min-height: 28px;
    padding: 0 6px;
    border-bottom: 1px solid var(--sc-border);
  }

  .row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .header {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .r {
    text-align: right;
  }

  .num {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
  }

  .profit {
    font-weight: 600;
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
