<script lang="ts">
  import type { RouteOption } from '../../core/routes';
  import type { Reference, Vehicle } from '../../core/types';
  import { routeOptionRow } from '../vm/route-rows';
  import type { RouteMode, RouteOptionRow, UexRangeOf } from '../vm/route-rows';
  import { LEGEND, legendTitle } from '../vm/legend';
  import TempBadge from './TempBadge.svelte';
  import TrendMark from './TrendMark.svelte';
  import { tr } from '../../i18n';

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
    /** The budget and the free space of the hold the options were counted with: a row says when the budget limits «Взять». */
    budget?: number | null;
    freeScu?: number;
    /** Set: the expanded row has a star that makes the trip a favourite route, or takes that back (`isFavourite` says which). */
    onFavourite?: (option: RouteOption) => void;
    isFavourite?: (option: RouteOption) => boolean;
    /**
     * The range UEX knows for a side of a terminal. It stands in the hint of a price of mine and beside it in the opened row,
     * as a reference; without it such a price has no range.
     */
    uexRange?: UexRangeOf;
  }
  let {
    options, reference, runCounts, mode, showCommodity, emptyText, onTarget, onClearTarget, onToggleRow, anchorTerminalId = null, targetTerminalId = null,
    targetThenId = null, uexRange, vehicle, budget = null, freeScu, onFavourite, isFavourite,
  }: Props = $props();

  const rows = $derived(
    options.map(option => ({ option, row: routeOptionRow(option, reference, mode, runCounts, { anchorTerminalId, targetTerminalId, targetThenId, uexRange, vehicle, budget, freeScu }) })),
  );
  // the trips bought at another terminal follow the ones bought here (the core orders them so): a line says where they begin
  const firstElsewhere = $derived(rows.find(({ row }) => row.emptyLeg !== null)?.row.key ?? null);
  // the biggest profit is the one number of the list that is told apart by colour on its own, apart from the ROI tiers
  const bestGain = $derived.by(() => {
    let best: { key: string; profit: number } | null = null;
    for (const { option, row } of rows) {
      if (best === null || option.profit > best.profit) best = { key: row.key, profit: option.profit };
    }
    return best?.key ?? null;
  });
  // the hint of a price: its spread first, and under it what the two numbers are (the legend of «Мин–макс»)
  const priceTitle = (row: RouteOptionRow): string =>
    row.price.range.kind === 'spread' || row.price.range.kind === 'flat' ? `${row.priceTitle}\n${LEGEND.range}` : row.priceTitle;

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
      {#if view.range.kind === 'spread' || view.range.kind === 'flat'}<span class="muted sc-num" title={legendTitle(LEGEND.range, view.range.title)}>{view.range.text}</span>{/if}
      <TempBadge text={view.badge.text} kind={view.badge.kind} />
    </span>
  </div>
{/snippet}

{#if rows.length === 0}
  <p class="empty">{emptyText}</p>
{:else}
  <div class="list" role="table" aria-label={tr('Варианты')}>
    <div class="grid head sc-label" role="row">
      <span role="columnheader">{mode === 'to' ? tr('Откуда') : tr('Куда')}</span>
      <span role="columnheader" class="r price-head" title={tr('Наведи на цену — увидишь её минимум и максимум по UEX')}>{tr('Цена')}</span>
      <span role="columnheader" class="r" title={LEGEND.time}>{tr('Время')}</span>
      <span role="columnheader" class="r" title={LEGEND.profitTrip}>{tr('Прибыль')}</span>
      <span role="columnheader" class="r">ROI</span>
    </div>
    {#each rows as { option, row }, index (row.key)}
      {@const expanded = expandedKey === row.key}
      {#if row.key === firstElsewhere}
        <!-- the trips below start elsewhere: the line says what is done there (1.4, the author: «не понимаю, о каком грузе идёт речь») -->
        <p class="elsewhere" title={tr('Строка: товар, где его купить, сколько лететь туда пустым → где продать. Такой рейс приносит больше, чем отсюда. «Цель» ведёт сначала на закупку, потом на продажу')}>{tr('Выгоднее: слетать пустым и купить там')}</p>
      {/if}
      <div class="row tier-{row.tier}" class:expanded role="row">
        <button type="button" class="grid line" data-tour={index === 0 ? 'option-first' : undefined} aria-expanded={expanded} onclick={() => toggle(row.key, option)}>
          <span class="where" title={row.whereTitle}>
            {#if showCommodity}<span class="code">{row.commodity}</span>{/if}
            <span class="end">{row.bothEnds ? row.origin : row.terminal}</span>
            {#if row.emptyLeg !== null}<span class="leg" title={tr('Пустой перелёт до закупки')}>{row.emptyLeg}</span>{/if}
            {#if row.bothEnds}<span class="arrow">→</span><span class="end">{row.dest}</span>{/if}
            {#if row.isTarget}<span class="goal" title={tr('Цель рейса')}>{tr('цель')}</span>{/if}
            {#if row.stockNote}<span class="unsure" role="img" aria-label={row.stockNote} title={row.stockNote}>?</span>{/if}
            {#if row.soleNote}<span class="unsure" role="img" aria-label={row.soleNote} title={row.soleNote}>!</span>{/if}
            {#if row.loadBar}<span class="bar" title={tr('Твой корабль здесь не загрузится: в точке закупки {loadBar}', { loadBar: row.loadBar })}>{tr('док')}</span>{/if}
          </span>
          <span class="cell sc-num" class:hint={!row.priceIsOwn} title={priceTitle(row)}>
            <TrendMark trend={row.trend} />
            <span class="digits">{row.price.price}</span>
            <TempBadge compact text={row.price.badge.text} kind={row.price.badge.kind} />
          </span>
          <span class="time sc-num" title={legendTitle(LEGEND.time, row.timeTitle)}>{row.time}</span>
          <span class="gain sc-num" class:best={row.key === bestGain} class:loss={row.profitLoss} title={tr('Прибыль за рейс: {profit} · взять {qty}', { profit: row.profit, qty: row.qty })}>{row.gain}</span>
          <span class="roi sc-num" title={tr('Прибыль к вложенному')}>{row.roi}</span>
        </button>
        {#if expanded}
          <div class="detail sc-reveal">
            <div class="facts">
              <div class="fact" title={tr('Сколько взять: меньшее из свободного места в трюме, запаса на станции и бюджета')}>
                <span class="sc-label">{tr('Взять')}</span><span class="sc-num">{row.qty}</span>
              </div>
              <div class="fact"><span class="sc-label">{tr('Вложение')}</span><span class="sc-num">{row.invested}</span></div>
              <div class="fact"><span class="sc-label">{tr('Прибыль')}</span><span class="sc-num" class:loss={row.profitLoss}>{row.profit}</span></div>
              <div class="fact" title={LEGEND.worst}><span class="sc-label">{tr('Худший')}</span><span class="sc-num" class:loss={row.worstLoss}>{row.worst}</span></div>
            </div>
            {#if row.stockNote}<p class="stock-note"><span class="unsure" aria-hidden="true">?</span> {row.stockNote}</p>{/if}
            {#if row.stockLimit}<p class="stock-note">{row.stockLimit}</p>{/if}
            {#if row.soleNote}<p class="stock-note"><span class="unsure" aria-hidden="true">!</span> {row.soleNote}</p>{/if}
            {#if row.loadBar}<p class="stock-note bar-note">{tr('Твой корабль в точке закупки не загрузится: {loadBar}', { loadBar: row.loadBar })}</p>{/if}
            {#if row.boxes}<p class="stock-note" title={tr('По размерам ящиков, которые продаёт терминал закупки и которые берёт твой корабль')}>{row.boxes}</p>{/if}
            <div class="prices">
              {@render price(row.bothEnds ? tr('Купить · {place}', { place: row.origin }) : tr('Купить'), row.buy)}
              {@render price(row.bothEnds ? tr('Продать · {place}', { place: row.dest }) : tr('Продать'), row.sell)}
            </div>
            <div class="foot">
              <span class="inline" title={legendTitle(LEGEND.time, row.timeTitle)}><span class="sc-label">{tr('Время')}</span><span class="sc-num">{row.time}</span></span>
              <span class="inline" title={tr('Сколько раз ты уже возил это')}><span class="sc-label">{tr('Рейсов')}</span><span class="sc-num">{row.runs}</span></span>
              <span class="inline" title={tr('Расстояние')}><span class="sc-label">{tr('Путь')}</span><span class="sc-num">{row.distance}</span></span>
              <span class="spacer"></span>
              {#if onFavourite}
                {@const on = isFavourite?.(option) ?? false}
                <button
                  type="button"
                  class="sc-btn sc-btn--act"
                  aria-pressed={on}
                  title={on ? tr('Избранный маршрут. Клик — убрать из избранного') : tr('В избранное: окно скажет со звуком, когда запас в точке закупки дорастёт до полного трюма')}
                  onclick={() => onFavourite?.(option)}
                >{on ? '★' : '☆'}</button>
              {/if}
              {#if row.isTarget && onClearTarget}
                <button type="button" class="sc-btn sc-btn--act" title={tr('Это цель рейса: убрать её')} onclick={() => onClearTarget?.()}>{tr('Снять цель')}</button>
              {:else if onTarget}
                <button type="button" class="sc-btn sc-btn--act" data-tour="set-target" disabled={row.isTarget} title={row.isTarget ? tr('Уже цель рейса') : tr('Сделать целью рейса')} onclick={() => onTarget?.(option)}>{tr('Цель')}</button>
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
       the triangle with the gap before the number. After it: the time of the trip ('15:34', '1:04:32' is 40 px), what it brings
       in the short form ('438k', '-12,5M' is 34 px) and the ROI ('42%' is 22 px of 32). The column «Мин–макс» (64 px) is gone:
       the two numbers are the hint of the price, and stand in the opened row */
    grid-template-columns: minmax(0, 1fr) calc(62px + var(--sc-trend-w) + 4px) 42px 50px 32px;
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
  .time,
  .roi,
  .gain {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    color: var(--sc-muted);
  }

  /* the mark of the source is a part of the price: hovering it says what hovering the price says (the spread), not its own two words */
  .cell :global(.mark) {
    pointer-events: none;
  }

  .roi {
    color: var(--tier);
    font-weight: 600;
  }

  .gain {
    font-weight: 600;
  }

  .gain.best {
    color: var(--sc-good);
  }

  .gain.loss {
    color: var(--sc-bad);
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
