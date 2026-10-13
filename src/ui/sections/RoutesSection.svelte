<script lang="ts" module>
  import { DEFAULT_ROUTE_SORT, type RouteSort } from '../vm/route-sort';

  // The column the table of routes is sorted by. It is kept here, in the module and not in the component: the section is gone from
  // the screen whenever the window folds to the mini line, and the choice lives until the program is closed (it is not a setting).
  const routeSort = $state<RouteSort>({ ...DEFAULT_ROUTE_SORT });
</script>

<script lang="ts">
  import ConfirmButton from '../components/ConfirmButton.svelte';
  import HistoryList from '../components/HistoryList.svelte';
  import RoutesTable from '../components/RoutesTable.svelte';
  import Section from '../components/Section.svelte';
  import SessionsList from '../components/SessionsList.svelte';
  import { app } from '../state.svelte';
  import { stats } from '../stats.svelte';
  import { clickedSort, sortRoutes, type RouteSortKey } from '../vm/route-sort';
  import { LIST_MAX_HEIGHT, STATS_VIEWS, routesSinceLine } from '../vm/stats-view';

  const SECTION = 'routes';
  // When the window has no height to spare, this section gives way before the terminal table does: the table is what
  // the player works in, the lists here are read. A larger factor takes more of the missing height (the options use a
  // small one for the opposite reason, see `OptionsSection`).
  const STATS_SHRINK = 4;

  const open = $derived(app.sectionOpen(SECTION));
  const view = $derived(stats.view);

  // The summary of a folded section is about the best route of the core's order (`stats.summary`); the table is in the order that was clicked.
  const routes = $derived(sortRoutes(stats.routes, routeSort));

  function toggle(): void {
    const opening = !open;
    void app.toggleSection(SECTION);
    if (opening) stats.opened();
  }

  const since = $derived(app.settings.routesSince);

  function sortBy(key: RouteSortKey): void {
    const next = clickedSort(routeSort, key);
    app.log.info('ui', 'routes sort', { key: next.key, dir: next.dir });
    routeSort.key = next.key;
    routeSort.dir = next.dir;
  }
</script>

{#snippet actions()}
  {#if open}
    <div class="sc-seg" role="group" aria-label="Что показать">
      {#each STATS_VIEWS as item (item.id)}
        <button type="button" aria-pressed={view === item.id} title={item.title} onclick={() => stats.setView(item.id)}>{item.label}</button>
      {/each}
    </div>
  {/if}
{/snippet}

<!--
  The summary is what a folded section says. Open, the list under the header says it (its first row is the best route),
  and the switch takes the room the summary would be cut in.
  The body shows `LIST_ROWS` rows and scrolls beyond that, whichever list is on (the line of heads of each list stays in place),
  and goes back to its top when the list is switched; when the window has no height to spare it shrinks below that as before.
-->
<Section
  title="Мои маршруты"
  summary={open ? undefined : stats.summary}
  {open}
  onToggle={toggle}
  {actions}
  scroll
  shrink={STATS_SHRINK}
  bodyMaxHeight={LIST_MAX_HEIGHT}
  resetScrollOn={view}
>
  {#if view === 'routes'}
    <RoutesTable
      rows={routes}
      sort={routeSort}
      onSort={sortBy}
      favourites={app.settings.favouriteRoutes}
      onFavourite={(route) => void app.toggleFavourite(route)}
    />
    <!-- the reset of the rating: the history is not touched (it is cleared in «Настройки» → «Данные»), so it can be taken back -->
    {#if since !== null}
      <p class="reset">
        <span class="since">{routesSinceLine(since)}</span>
        <button type="button" class="sc-btn" title="Считать маршруты снова по всей истории рейсов" onclick={() => void stats.restoreRoutes()}>Вернуть прежние</button>
      </p>
    {:else if routes.length > 0}
      <p class="reset">
        <ConfirmButton
          label="Обнулить маршруты"
          sureLabel="Точно обнулить?"
          title="Начать рейтинг маршрутов, твои времена по парам и обычный темп заново. История рейсов и сессии останутся; обнуление можно вернуть"
          onConfirm={() => void stats.resetRoutes()}
        />
      </p>
    {/if}
  {:else if view === 'history'}
    <HistoryList
      rows={stats.historyList}
      tradesOf={(runId) => stats.tradesOf(runId)}
      onEditTrade={(edit) => app.editTrade(edit)}
      onRemoveRun={(runId) => void app.removeRun(runId)}
    />
  {:else}
    <SessionsList rows={stats.sessionList} />
  {/if}
</Section>

<style>
  .reset {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sc-gap);
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    /* stays at the bottom of the body while a long list scrolls above it, as the line of heads stays at its top */
    position: sticky;
    bottom: 0;
    background: var(--sc-bg-solid);
  }

  .since {
    margin-right: auto;
    overflow: hidden;
    color: var(--sc-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
