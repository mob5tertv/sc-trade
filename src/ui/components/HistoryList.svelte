<script lang="ts">
  import { LEGEND } from '../vm/legend';
  import { routePieces } from '../vm/route-pieces';
  import type { TradeLine } from '../vm/run-trades';
  import type { HistoryRow } from '../vm/stats-rows';
  import PieceLine from './PieceLine.svelte';
  import RunTrades from './RunTrades.svelte';

  interface Props {
    rows: HistoryRow[];
    /** The trades of a run, for the row that is opened. Without it the rows do not open. */
    tradesOf?: (runId: number) => TradeLine[];
    /** Writes the correction of a trade (`RunTrades`). */
    onEditTrade?: (edit: { eventId: number; scu: number; price: number }) => Promise<string | null>;
    /** Takes a finished run out of the history. */
    onRemoveRun?: (runId: number) => void;
  }
  let { rows, tradesOf, onEditTrade, onRemoveRun }: Props = $props();

  // One run is opened at a time; a click on its row again closes it.
  let openId = $state<number | null>(null);
  const canOpen = $derived(tradesOf !== undefined && onEditTrade !== undefined);
  const toggleRow = (runId: number): void => { openId = openId === runId ? null : runId; };

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
      <span role="columnheader" class="r" title={LEGEND.rateRoutes}>UEC/ч</span>
    </div>
    {#each rows as row (row.runId)}
      <div
        class="grid line"
        class:opens={canOpen}
        class:open={openId === row.runId}
        role="row"
        tabindex={canOpen ? 0 : undefined}
        onkeydown={(e) => { if (canOpen && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleRow(row.runId); } }}
        title={canOpen ? `${STATUS[row.status]} · клик — сделки рейса: исправить цену или количество` : STATUS[row.status]}
        onclick={() => { if (canOpen) toggleRow(row.runId); }}
      >
        <span class="when sc-num">{row.when}</span>
        <!-- the ends of the route give way equally, each with its own ellipsis, and the arrow stays; a title without a route is cut at its end -->
        <span class="title {row.status}" title="{row.hint} · {STATUS[row.status]}"><PieceLine pieces={routePieces(row.title)} /></span>
        <span class="sc-num profit" class:loss={isLoss(row.profit)} title="Прибыль">{row.profit}</span>
        <span class="sc-num" title="ROI">{row.roi}</span>
        <span class="sc-num" title="Длительность">{row.duration}</span>
        <span class="sc-num" title="UEC в час">{row.rate}</span>
      </div>
      {#if openId === row.runId && tradesOf && onEditTrade}
        <RunTrades
          lines={tradesOf(row.runId)}
          onSave={onEditTrade}
          onRemove={row.status !== 'active' && onRemoveRun ? () => onRemoveRun?.(row.runId) : undefined}
        />
      {/if}
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: 60px minmax(0, 1fr) 58px 46px 44px 50px;
    column-gap: 4px;
    align-items: center;
    padding: 0 var(--sc-pad-x);
  }

  /* the line of heads stays at the top of the body while the rows scroll under it; the solid twin of the glass hides them */
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-bg-solid);
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

  /* a row that opens the trades of its run */
  .line.opens {
    cursor: pointer;
  }

  .line.opens:hover,
  .line.open {
    background: var(--sc-surface-2);
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
