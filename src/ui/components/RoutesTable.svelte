<script lang="ts">
  import { routePieces } from '../vm/route-pieces';
  import { ariaSortOf, type RouteSort, type RouteSortKey } from '../vm/route-sort';
  import { favouriteKey, type FavouriteRoute } from '../vm/favourites';
  import { favouriteOf, type RouteRow } from '../vm/stats-rows';
  import PieceLine from './PieceLine.svelte';
  import { tr } from '../../i18n';

  interface Props {
    /** The rows in the order they are to be shown: the owner sorts them (`sortRoutes`). */
    rows: RouteRow[];
    /** The column the rows are sorted by and the direction; the header of that column carries the arrow. */
    sort: RouteSort;
    /** A numeric header was clicked. */
    onSort: (key: RouteSortKey) => void;
    /** The favourite routes; with `onFavourite` every row of one commodity has a star. */
    favourites?: readonly FavouriteRoute[];
    onFavourite?: (route: FavouriteRoute) => void;
    /** The favourites whose stock is full now (`favouriteKey` → what the alert said): their stars are lit. */
    ready?: ReadonlyMap<string, string>;
  }
  let { rows, sort, onSort, favourites = [], onFavourite, ready }: Props = $props();

  const starred = $derived(new Set(favourites.map(favouriteKey)));

  const isLoss = (profit: string): boolean => profit.startsWith('-');
</script>

{#snippet head(key: RouteSortKey, label: string, title: string)}
  <span role="columnheader" class="r" aria-sort={ariaSortOf(sort, key)}>
    <button type="button" class="sort" class:on={sort.key === key} {title} onclick={() => onSort(key)}>
      {#if sort.key === key}
        <svg class="arrow" viewBox="0 0 5 4" width="5" height="4" aria-hidden="true"><path d={sort.dir === 'asc' ? 'M2.5 0L5 4H0z' : 'M0 0H5L2.5 4z'} /></svg>
      {/if}
      {label}
    </button>
  </span>
{/snippet}

{#if rows.length === 0}
  <p class="empty">{tr('Заверши первый рейс — здесь появится рейтинг маршрутов')}</p>
{:else}
  <div class="table" role="table" aria-label={tr('Мои маршруты')}>
    <div class="grid head sc-label" role="row">
      <span role="columnheader">{tr('Маршрут')}</span>
      <!-- a column of 38 px for the code of the commodity: the English word of it is a short one ("Commodity" ran into the next head) -->
      <span role="columnheader">{tr('@code-column:Товар')}</span>
      {@render head('perRun', tr('За рейс'), tr('Сколько в среднем приносит один рейс по маршруту. Нажми, чтобы отсортировать'))}
      {@render head('runs', tr('Рейс'), tr('Сортировать по числу завершённых рейсов'))}
      {@render head('time', tr('Время'), tr('Сортировать по медианному времени: быстрые сверху'))}
      {@render head('profit', tr('Прибыль'), tr('Сортировать по суммарной прибыли'))}
      {@render head('roi', 'ROI', tr('Сортировать по среднему ROI'))}
    </div>
    {#each rows as row (row.key)}
      <div class="grid line" role="row">
        <!-- both ends of the route give way equally, each with its own ellipsis, and the arrow stays: 'Port Tre… → TDD Are…' (the full name is the tooltip) -->
        <span class="route" title={row.route}>
          {#if onFavourite}
            {@const fav = favouriteOf(row)}
            {#if fav !== null}
              {@const on = starred.has(favouriteKey(fav))}
              {@const full = on ? ready?.get(favouriteKey(fav)) : undefined}
              <button
                type="button"
                class="star"
                class:on
                class:ready={full !== undefined}
                aria-pressed={on}
                aria-label={tr('Избранный маршрут')}
                title={full !== undefined ? tr('{full}\nКлик — убрать из избранного', { full }) : on ? tr('Избранный маршрут: окно скажет, когда запас в точке закупки дорастёт до полного трюма. Клик — убрать') : tr('В избранное: окно скажет со звуком, когда запас в точке закупки дорастёт до полного трюма')}
                onclick={() => onFavourite?.(fav)}
              >{on ? '★' : '☆'}</button>
            {:else}
              <span class="star none" title={tr('Маршрут со смешанным грузом в избранное не ставится')}>☆</span>
            {/if}
          {/if}
          <PieceLine pieces={routePieces(row.route)} />
        </span>
        <span class="code" title={row.commodityHint ?? undefined}>{row.commodity}</span>
        <span class="sc-num strong" class:loss={row.perRunValue < 0} title={row.perRunTitle}>{row.perRun}</span>
        <span class="sc-num" title={row.runsTitle}>{row.runsText}</span>
        <span class="sc-num" title={row.phases ? tr('Медианное время: погрузка · полёт · разгрузка {phases}', { phases: row.phases }) : tr('Медианное время рейса')}>{row.time}</span>
        <span class="sc-num" class:loss={isLoss(row.profit)} title={row.profitTitle}>{row.profit}</span>
        <span class="sc-num" title={tr('Средний ROI')}>{row.roi}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 38px 54px 32px 46px 62px 46px;
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

  /* the star of a favourite route: before the name of the route, as wide as one letter */
  .route {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .star {
    flex: none;
    width: 14px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--sc-muted);
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }

  .star.on {
    color: var(--sc-warn);
  }

  /* the stock of the route is full now: the star says so for as long as it is true, whether or not the alert was seen */
  .star.ready {
    color: var(--sc-good);
  }

  .star:hover:not(.none) {
    color: var(--sc-accent);
  }

  .star.none {
    opacity: 0.35;
    cursor: default;
  }

  /* A header of a number is a button as tall as the head, so the head keeps its height; the column keeps its width: the
     label stays at the right edge, where the numbers are, and the arrow of the sorted column takes the room to its left. */
  .head .r {
    display: flex;
    align-self: stretch;
    justify-content: flex-end;
    min-width: 0;
  }

  /* The negative margin takes back the letter-spacing that follows the last letter, so that the label ends where the numbers do; "Рейс" is
     in a column of 32 px and its arrow has to fit in it too. */
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    height: 100%;
    margin-right: -0.08em;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .sort:hover {
    color: var(--sc-text);
  }

  .sort.on {
    color: var(--sc-accent);
  }

  .arrow {
    flex: none;
    fill: currentColor;
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

  .code {
    color: var(--sc-label);
    font-weight: 600;
  }

  .strong {
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
