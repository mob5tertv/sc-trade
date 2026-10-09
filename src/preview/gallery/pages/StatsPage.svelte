<script lang="ts">
  import HistoryList from '../../../ui/components/HistoryList.svelte';
  import RoutesTable from '../../../ui/components/RoutesTable.svelte';
  import SessionsList from '../../../ui/components/SessionsList.svelte';
  import { clickedSort, DEFAULT_ROUTE_SORT, sortRoutes, type RouteSort } from '../../../ui/vm/route-sort';
  import { historyRows } from '../../../ui/vm/stats-rows';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  // the run in progress is a row of the history too (the list shows the newest run first)
  const none = historyRows([], data.reference, data.now);

  // the table of the section, with the choice it keeps (the first state is clickable: the headers of the numbers sort it)
  let live = $state<RouteSort>({ ...DEFAULT_ROUTE_SORT });
  const nothing = (): void => {};
  const byRoi: RouteSort = { key: 'roi', dir: 'desc' };
  const byTime: RouteSort = { key: 'time', dir: 'asc' };
  const byTimeSlowest: RouteSort = { key: 'time', dir: 'desc' };
</script>

<Frame name="history" caption="history: one line per run">
  <HistoryList rows={data.history} />
</Frame>
<Frame name="history-empty" caption="no runs yet: one muted line">
  <HistoryList rows={none} />
</Frame>
<Frame name="sessions" caption="sessions">
  <SessionsList rows={data.sessions} />
</Frame>
<Frame name="sessions-empty" caption="no sessions">
  <SessionsList rows={[]} />
</Frame>
<Frame name="routes" caption="my routes: best rate first (the arrow is on UEC/ч); the headers of the numbers are buttons; the phases are in the title of the time">
  <RoutesTable rows={sortRoutes(data.routeStats, live)} sort={live} onSort={(key) => (live = clickedSort(live, key))} />
</Frame>
<Frame name="routes-roi" caption="my routes sorted by the ROI: the best on top, the arrow on the header of the column">
  <RoutesTable rows={sortRoutes(data.routeStats, byRoi)} sort={byRoi} onSort={nothing} />
</Frame>
<Frame name="routes-time" caption="my routes sorted by the time: the fastest on top; a route without a time would stay at the end">
  <RoutesTable rows={sortRoutes(data.routeStats, byTime)} sort={byTime} onSort={nothing} />
</Frame>
<Frame name="routes-time-slowest" caption="the second click on the time turns the order round: the slowest on top">
  <RoutesTable rows={sortRoutes(data.routeStats, byTimeSlowest)} sort={byTimeSlowest} onSort={nothing} />
</Frame>
<Frame name="routes-empty" caption="no finished run yet">
  <RoutesTable rows={[]} sort={DEFAULT_ROUTE_SORT} onSort={nothing} />
</Frame>
