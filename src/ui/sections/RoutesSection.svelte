<script lang="ts" module>
  import { DEFAULT_ROUTE_SORT, type RouteSort } from '../vm/route-sort';

  // The column the table of routes is sorted by. It is kept here, in the module and not in the component: the section is gone from
  // the screen whenever the window folds to the mini line, and the choice lives until the program is closed (it is not a setting).
  const routeSort = $state<RouteSort>({ ...DEFAULT_ROUTE_SORT });
</script>

<script lang="ts">
  import HistoryList from '../components/HistoryList.svelte';
  import RoutesTable from '../components/RoutesTable.svelte';
  import Section from '../components/Section.svelte';
  import SessionsList from '../components/SessionsList.svelte';
  import { app } from '../state.svelte';
  import { stats } from '../stats.svelte';
  import { clickedSort, sortRoutes, type RouteSortKey } from '../vm/route-sort';
  import { LIST_MAX_HEIGHT, STATS_VIEWS } from '../vm/stats-view';

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
    <RoutesTable rows={routes} sort={routeSort} onSort={sortBy} />
  {:else if view === 'history'}
    <HistoryList rows={stats.historyList} />
  {:else}
    <SessionsList rows={stats.sessionList} />
  {/if}
</Section>
