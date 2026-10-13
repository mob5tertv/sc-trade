<script lang="ts">
  import type { RouteOption } from '../../core/routes';
  import type { Reference, Vehicle } from '../../core/types';
  import { routeOptionRow } from '../vm/route-rows';
  import type { RouteMode, RouteOptionRow, UexRangeOf } from '../vm/route-rows';
  import { LEGEND, legendTitle } from '../vm/legend';
  import TempBadge from './TempBadge.svelte';
  import TrendMark from './TrendMark.svelte';

  interface Props {
    options: RouteOption[];
    reference: Reference;
    /** My finished runs per pair, keyed with `pairKey(originId, destId)`. */
    runCounts: Map<string, number>;
    /** Which end of a trip is named: `from` names the destination, `to` the origin. */
    mode: RouteMode;
    showCommodity: boolean;
    emptyText: string;
    /** Set: the expanded row has a "Цель" button that calls it. */
    onTarget?: (option: RouteOption) => void;
    /** Set: in the expanded row of the option that IS the target, the button says "Снять цель" and calls it. */
    onClearTarget?: () => void;
    /** A row was opened (`open`) or taken back, by a click on it. */
    onToggleRow?: (option: RouteOption, open: boolean) => void;
    /**
     * The viewed terminal. A trip whose own end is another terminal (bought elsewhere on the planet) shows both its
     * ends; without it every row shows both.
     */
    anchorTerminalId?: number | null;
    /** The terminal of the current target: the option that leads there carries the word "цель". */
    targetTerminalId?: number | null;
    /** The second step of a target in two steps (a purchase elsewhere, then the sale); `null` for a plain target. */
    targetThenId?: number | null;
    /** The ship of the settings: its boxes and how it is loaded stand in the rows; absent: nothing is said. */
    vehicle?: Vehicle;
    /** Set: the expanded row has a star that makes the trip a favourite route, or takes that back (`isFavourite` says which). */
    onFavourite?: (option: RouteOption) => void;
    isFavourite?: (option: RouteOption) => boolean;
    /**
     * The range UEX knows for a side of a terminal. It stands in «Мин–макс» beside a price of mine, as a reference;
     * without it such a price has no range.
     */
    uexRange?: UexRangeOf;
  }
  let {
    options, reference, runCounts, mode, showCommodity, emptyText, onTarget, onClearTarget, onToggleRow, anchorTerminalId = null, targetTerminalId = null,
    targetThenId = null, uexRange, vehicle, onFavourite, isFavourite,
  }: Props = $props();

  const rows = $derived(
    options.map(option => ({ option, row: routeOptionRow(option, reference, mode, runCounts, { anchorTerminalId, targetTerminalId, targetThenId, uexRange, vehicle }) })),
  );
  // the trips bought at another terminal follow the ones bought here (the core orders them so): a line says where they begin
  const firstElsewhere = $derived(rows.find(({ row }) => row.emptyLeg !== null)?.row.key ?? null);
  // the best rate is the one number of the list that is told apart by colour on its own, apart from the ROI tiers
  const bestRate = $derived.by(() => {
    let best: { key: string; rate: number } | null = null;
    for (const { option, row } of rows) {
      if (option.uecPerHour !== null && (best === null || option.uecPerHour > best.rate)) best = { key: row.key, rate: option.uecPerHour };
    }
    return best?.key ?? null;
  });

  // One row is expanded at a time; the click on it again takes it back.
  let expandedKey = $state<string | null>(null);
  const toggle = (key: string, option: RouteOption): void => {
    const open = expandedKey !== key;
    expandedKey = open ? key : null;
    onToggleRow?.(option, open);
  };
</script>

{#snippet price(label: string, view: RouteOptionRow['buy'])}
  <div class="fact">
    <span class="sc-label">{label}</span>
    <span class="inline">
      <span class="sc-num">{view.price}</span>
      {#if view.range.kind === 'spread' || view.range.kind === 'flat'}<span class="muted sc-num" title={view.range.title}>{view.range.text}</span>{/if}
      <TempBadge text={view.badge.text} kind={view.badge.kind} />
    </span>
  </div>
{/snippet}

{#if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <div class="list" role="table" aria-label="Варианты">
    <div class="grid head sc-label" role="row">
      <span role="columnheader">{mode === 'to' ? 'Откуда' : 'Куда'}</span>
      <span role="columnheader" class="r price-head">Цена</span>
      <span role="columnheader" class="r" title={LEGEND.range}>Мин–макс</span>
      <span role="columnheader" class="r">ROI</span>
      <span role="columnheader" class="r" title={LEGEND.rateOptions}>UEC/ч</span>
    </div>
    {#each rows as { option, row } (row.key)}
      {@const expanded = expandedKey === row.key}
      {#if row.key === firstElsewhere}
        <p class="elsewhere" title="Закупка на другом терминале рядом: выгоднее по ROI, чем здесь. «Цель» у такого варианта ведёт сначала на закупку, потом на продажу">Выгоднее: закупка рядом</p>
      {/if}
      <div class="row tier-{row.tier}" class:expanded role="row">
        <button type="button" class="grid line" aria-expanded={expanded} onclick={() => toggle(row.key, option)}>
          <span class="where" title={row.whereTitle}>
            {#if showCommodity}<span class="code">{row.commodity}</span>{/if}
            <span class="end">{row.bothEnds ? row.origin : row.terminal}</span>
            {#if row.emptyLeg !== null}<span class="leg" title="Пустой перелёт до закупки">{row.emptyLeg}</span>{/if}
            {#if row.bothEnds}<span class="arrow">→</span><span class="end">{row.dest}</span>{/if}
            {#if row.isTarget}<span class="goal" title="Цель рейса">цель</span>{/if}
            {#if row.stockNote}<span class="unsure" role="img" aria-label={row.stockNote} title={row.stockNote}>?</span>{/if}
            {#if row.loadBar}<span class="bar" title="Твой корабль здесь не загрузится: в точке закупки {row.loadBar}">док</span>{/if}
          </span>
          <span class="cell sc-num" class:hint={!row.priceIsOwn}>
            <TrendMark trend={row.trend} />
            <span class="digits">{row.price.price}</span>
            <TempBadge compact text={row.price.badge.text} kind={row.price.badge.kind} />
          </span>
          <span class="range sc-num" data-range={row.price.range.kind} title={row.price.range.title}>{row.price.range.text}</span>
          <span class="roi sc-num" title="Прибыль к вложенному">{row.roi}</span>
          <span class="rate sc-num" class:best={row.key === bestRate} title="UEC в час">{row.rate}</span>
        </button>
        {#if expanded}
          <div class="detail sc-reveal">
            <div class="facts">
              <div class="fact" title="Сколько взять: меньшее из свободного места в трюме, запаса на станции и бюджета">
                <span class="sc-label">Взять</span><span class="sc-num">{row.qty}</span>
              </div>
              <div class="fact"><span class="sc-label">Вложение</span><span class="sc-num">{row.invested}</span></div>
              <div class="fact"><span class="sc-label">Прибыль</span><span class="sc-num" class:loss={row.profitLoss}>{row.profit}</span></div>
              <div class="fact" title={LEGEND.worst}><span class="sc-label">Худший</span><span class="sc-num" class:loss={row.worstLoss}>{row.worst}</span></div>
            </div>
            {#if row.stockNote}<p class="stock-note"><span class="unsure" aria-hidden="true">?</span> {row.stockNote}</p>{/if}
            {#if row.stockLimit}<p class="stock-note">{row.stockLimit}</p>{/if}
            {#if row.loadBar}<p class="stock-note bar-note">Твой корабль в точке закупки не загрузится: {row.loadBar}</p>{/if}
            {#if row.boxes}<p class="stock-note" title="По размерам ящиков, которые продаёт терминал закупки и которые берёт твой корабль">{row.boxes}</p>{/if}
            <div class="prices">
              {@render price('Купить', row.buy)}
              {@render price('Продать', row.sell)}
            </div>
            <div class="foot">
              <span class="inline" title={legendTitle(LEGEND.time, row.timeTitle)}><span class="sc-label">Время</span><span class="sc-num">{row.time}</span></span>
              <span class="inline" title="Сколько раз ты уже возил это"><span class="sc-label">Рейсов</span><span class="sc-num">{row.runs}</span></span>
              <span class="inline" title="Расстояние"><span class="sc-label">Путь</span><span class="sc-num">{row.distance}</span></span>
              <span class="spacer"></span>
              {#if onFavourite}
                {@const on = isFavourite?.(option) ?? false}
                <button
                  type="button"
                  class="sc-btn sc-btn--act"
                  aria-pressed={on}
                  title={on ? 'Избранный маршрут. Клик — убрать из избранного' : 'В избранное: окно скажет со звуком, когда запас в точке закупки дорастёт до полного трюма'}
                  onclick={() => onFavourite?.(option)}
                >{on ? '★' : '☆'}</button>
              {/if}
              {#if row.isTarget && onClearTarget}
                <button type="button" class="sc-btn sc-btn--act" title="Это цель рейса: убрать её" onclick={() => onClearTarget?.()}>Снять цель</button>
              {:else if onTarget}
                <button type="button" class="sc-btn sc-btn--act" disabled={row.isTarget} title={row.isTarget ? 'Уже цель рейса' : 'Сделать целью рейса'} onclick={() => onTarget?.(option)}>Цель</button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    /* the price column holds a seven-digit number and its 6 px mark (62 px, as in the table of the terminal) and the slot of
       the triangle with the gap before the number. The 14 px it needed come from the numbers that had room to spare (ROI
       `42%` is 22 px of 36, UEC/ч `2,33M` 28 px of 40) and from the gaps, so that the names keep the room they had */
    grid-template-columns: minmax(0, 1fr) calc(62px + var(--sc-trend-w) + 4px) 64px 32px 34px;
    column-gap: 3px;
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

  /* the number stands left of its 6 px mark: the caption stands over the number */
  .price-head {
    padding-right: 10px;
  }

  /* the bar at the edge of a row and its ROI number: how good the trip is, by one colour */
  .tier-great { --tier: var(--sc-roi-great); }
  .tier-good { --tier: var(--sc-roi-good); }
  .tier-ok { --tier: var(--sc-roi-ok); }
  .tier-poor { --tier: var(--sc-roi-poor); }
  .tier-loss { --tier: var(--sc-roi-loss); }

  .row {
    border-bottom: 1px solid var(--sc-surface-2);
    border-left: 3px solid var(--tier);
  }

  .row .grid {
    padding-left: calc(var(--sc-pad-x) - 3px);
  }

  .line {
    width: 100%;
    height: calc(var(--sc-row-h) - 1px);
    border: 0;
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .line:hover,
  .row.expanded .line {
    background: var(--sc-surface-2);
  }

  .where {
    display: flex;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .code {
    flex: none;
    color: var(--sc-label);
    font-weight: 600;
  }

  .end {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .arrow {
    flex: none;
    color: var(--sc-muted);
  }

  /* the empty flight to a purchase elsewhere: small and muted, between the two ends of the trip */
  .leg {
    flex: none;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  /* where the trips bought at another terminal begin */
  .elsewhere {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: 18px;
    border-bottom: 1px solid var(--sc-border);
    color: var(--sc-label);
    font-size: var(--sc-font-sm);
    line-height: 18px;
    letter-spacing: 0.04em;
  }

  .goal {
    flex: none;
    color: var(--sc-good);
    font-size: var(--sc-font-sm);
  }

  /* the ship of the settings cannot be loaded where this trip is bought: a mark, the trip stays in the list */
  .bar {
    flex: none;
    color: var(--sc-bad);
    font-size: var(--sc-font-sm);
  }

  .bar-note {
    color: var(--sc-bad);
  }

  /* the volume of the trip was counted with no stock to limit it: the mark stands at the end of the names, where it moves no number */
  .unsure {
    flex: none;
    color: var(--sc-warn);
    font-weight: 600;
  }

  .stock-note {
    margin: 0;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    min-width: 0;
  }

  /* a UEX price and my cold one are muted, as in the table; mine is normal text */
  .cell.hint {
    color: var(--sc-muted);
  }

  .digits,
  .range,
  .roi,
  .rate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .range {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .roi {
    color: var(--tier);
    font-weight: 600;
  }

  .rate.best {
    color: var(--sc-good);
  }

  /* what a click on a row opens under it */
  .detail {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px var(--sc-pad-x) 5px calc(var(--sc-pad-x) - 3px);
    background: var(--sc-surface);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sc-gap);
  }

  .fact {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .fact .sc-num {
    text-align: left;
  }

  .prices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sc-gap);
  }

  .prices .inline {
    height: 18px;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--sc-ctl-h);
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .muted {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
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
