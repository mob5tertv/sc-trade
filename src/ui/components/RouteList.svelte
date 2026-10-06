<script lang="ts">
  import type { RouteOption } from '../../core/routes';
  import type { Reference } from '../../core/types';
  import { routeOptionRow } from '../vm/route-rows';
  import type { RouteMode } from '../vm/route-rows';
  import TempBadge from './TempBadge.svelte';

  interface Props {
    options: RouteOption[];
    reference: Reference;
    /** My finished runs per pair, keyed with `pairKey(originId, destId)`. */
    runCounts: Map<string, number>;
    /** Which end of a trip is named: `from` names the destination, `to` the origin. */
    mode: RouteMode;
    showCommodity: boolean;
    emptyText: string;
    onTarget?: (option: RouteOption) => void;
  }
  let { options, reference, runCounts, mode, showCommodity, emptyText, onTarget }: Props = $props();

  const rows = $derived(options.map(option => ({ option, row: routeOptionRow(option, reference, mode, runCounts) })));
</script>

{#if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <ul class="list">
    {#each rows as { option, row } (row.key)}
      <li class="item">
        <div class="head">
          <span class="terminal" title={row.terminal}>{row.terminal}</span>
          {#if showCommodity}<span class="code">{row.commodity}</span>{/if}
          {#if onTarget}
            <button type="button" title="Сделать целью рейса" onclick={() => onTarget?.(option)}>Цель</button>
          {/if}
        </div>
        <div class="price">
          <span class="num strong">{row.price.price}</span>
          {#if row.price.range}<span class="num muted" title="Диапазон цен">({row.price.range})</span>{/if}
          <TempBadge text={row.price.badge.text} kind={row.price.badge.kind} />
          <span class="muted trip" title={row.timeTitle ?? undefined}>{row.distance} · {row.time}</span>
        </div>
        <div class="metrics">
          <span><span class="muted">ROI</span> <span class="num">{row.roi}</span></span>
          <span title="UEC в час"><span class="num">{row.rate}</span></span>
          <span title="Прибыль при худшем исходе цен">
            <span class="muted">худш.</span> <span class="num" class:loss={row.worstLoss}>{row.worst}</span>
          </span>
          <span class="num">{row.qty}</span>
          {#if row.runs > 0}<span class="muted">твоих рейсов {row.runs}</span>{/if}
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
    padding: 4px 6px;
    border-bottom: 1px solid var(--sc-border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--sc-gap);
    min-height: 28px;
  }

  .terminal {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .code {
    flex: none;
    font-family: var(--sc-mono);
  }

  .head button {
    flex: none;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    font-size: var(--sc-font-sm);
    cursor: pointer;
  }

  .head button:hover {
    background: var(--sc-surface-2);
  }

  .head button:focus-visible {
    outline: 2px solid var(--sc-accent);
    outline-offset: 1px;
  }

  .price,
  .metrics {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-height: 22px;
  }

  .metrics {
    font-size: var(--sc-font-sm);
  }

  .trip {
    margin-left: auto;
    font-size: var(--sc-font-sm);
    white-space: nowrap;
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
