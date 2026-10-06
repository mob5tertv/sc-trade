<script lang="ts">
  import type { SellAlternative, SellHere } from '../../core/sell';
  import type { Reference } from '../../core/types';
  import { sellAlternativeRow, sellHereRow } from '../vm/route-rows';
  import TempBadge from './TempBadge.svelte';

  interface Props {
    commodityCode: string;
    here: SellHere;
    /** The best other buyers; at most three are shown. */
    alternatives: SellAlternative[];
    reference: Reference;
  }
  let { commodityCode, here, alternatives, reference }: Props = $props();

  const MAX_ALTERNATIVES = 3;

  const hereRow = $derived(sellHereRow(here));
  const rows = $derived(alternatives.slice(0, MAX_ALTERNATIVES).map(a => sellAlternativeRow(a, reference)));
</script>

<section class="card" aria-label="Продать здесь или лететь дальше: {commodityCode}">
  <h3 class="title">Продать здесь или лететь дальше <span class="code">{commodityCode}</span></h3>

  <div class="here">
    <span class="caption">Здесь сейчас</span>
    <span class="num">{hereRow.qty}</span>
    <span class="num" class:good={!hereRow.loss} class:loss={hereRow.loss} title="Прибыль, если продать здесь">{hereRow.profit}</span>
    <span><span class="muted">ROI</span> <span class="num">{hereRow.roi}</span></span>
    <span class="num" title="UEC в час за время, что прошло с начала рейса">{hereRow.rate}</span>
  </div>

  {#if rows.length === 0}
    <p class="muted none">Других покупателей этого товара не нашлось.</p>
  {:else}
    <ul class="alts">
      {#each rows as row (row.key)}
        <li class="alt">
          <div class="line">
            <span class="terminal" title={row.terminal}>{row.terminal}</span>
            <span class="num strong">{row.price.price}</span>
            {#if row.price.range}<span class="num muted" title="Диапазон цен">({row.price.range})</span>{/if}
            <TempBadge text={row.price.badge.text} kind={row.price.badge.kind} />
          </div>
          <div class="line small">
            <span title="Ожидаемая прибыль всего рейса, если продать там">
              <span class="num" class:good={!row.loss} class:loss={row.loss}>{row.profit}</span>
            </span>
            <span title="UEC в час всего рейса при ожидаемой цене"><span class="muted">ждём</span> <span class="num">{row.expectedRate}</span></span>
            <span title="UEC в час всего рейса при худшей цене диапазона"><span class="muted">худш.</span> <span class="num">{row.worstRate}</span></span>
            <span class="flight" title="Сколько лететь отсюда"><span class="muted">лететь</span> <span class="num">{row.extra}</span></span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .card {
    padding: 4px 6px 6px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-surface);
  }

  .title {
    margin: 0;
    min-height: 24px;
    font-size: var(--sc-font);
    font-weight: 600;
    line-height: 24px;
  }

  .code {
    margin-left: 4px;
    font-family: var(--sc-mono);
  }

  .here,
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    min-height: 24px;
  }

  .here {
    border-bottom: 1px solid var(--sc-border);
  }

  .caption {
    font-weight: 600;
  }

  .alts {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .alt {
    padding: 2px 0;
    border-bottom: 1px solid var(--sc-border);
  }

  .alt:last-child {
    border-bottom: 0;
  }

  .terminal {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .small {
    font-size: var(--sc-font-sm);
  }

  .flight {
    margin-left: auto;
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

  .good {
    color: var(--sc-good);
  }

  .loss {
    color: var(--sc-bad);
  }

  .none {
    margin: 4px 0 0;
  }
</style>
