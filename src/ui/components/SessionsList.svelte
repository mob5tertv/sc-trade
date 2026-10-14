<script lang="ts">
  import type { SessionRow } from '../vm/stats-rows';

  let { rows }: { rows: SessionRow[] } = $props();

  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#if rows.length === 0}
  <p class="empty">Сессий пока нет</p>
{:else}
  <div class="table" role="table" aria-label="Сессии">
    <div class="row header sc-label" role="row">
      <span role="columnheader">Начало</span>
      <span role="columnheader" class="r">Длит.</span>
      <span role="columnheader" class="r">Рейсов</span>
      <span role="columnheader" class="r">Прибыль</span>
    </div>
    {#each rows as row}
      <div class="row line" role="row">
        <span role="cell" class="sc-num when">{row.when}</span>
        <span role="cell" class="sc-num r">{row.duration}</span>
        <span role="cell" class="sc-num r">{row.runs}</span>
        <span role="cell" class="sc-num r profit" class:loss={isLoss(row.profit)}>{row.profit}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 64px 56px 92px;
    align-items: center;
    column-gap: var(--sc-gap);
    padding: 0 var(--sc-pad-x);
  }

  .row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* the line of heads stays at the top of the body while the rows scroll under it; the solid twin of the glass hides them */
  .header {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-bg-solid);
    color: var(--sc-muted);
  }

  .line {
    height: var(--sc-row-h);
    border-bottom: 1px solid var(--sc-surface-2);
  }

  .r {
    text-align: right;
  }

  .when {
    text-align: left;
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
