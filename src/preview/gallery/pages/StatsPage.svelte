<script lang="ts">
  import HistoryList from '../../../ui/components/HistoryList.svelte';
  import RoutesTable from '../../../ui/components/RoutesTable.svelte';
  import Section from '../../../ui/components/Section.svelte';
  import SessionsList from '../../../ui/components/SessionsList.svelte';
  import { clickedSort, DEFAULT_ROUTE_SORT, sortRoutes, type RouteSort } from '../../../ui/vm/route-sort';
  import { historyRows } from '../../../ui/vm/stats-rows';
  import { LIST_MAX_HEIGHT, LIST_ROWS } from '../../../ui/vm/stats-view';
  import { find } from '../acts';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  // the run in progress is a row of the history too (the list shows the newest run first)
  const none = historyRows([], data.reference, data.now);

  // The lists of the "Мои маршруты" section at its real size: `n` rows made of the rows of the dataset (the finished runs, over and
  // over), in a section whose body is no taller than `LIST_ROWS` rows (the owner is `RoutesSection`).
  const finished = data.history.filter((row) => row.status !== 'active');
  const history = (n: number) => Array.from({ length: n }, (_, i) => ({ ...finished[i % finished.length], runId: 5000 + i }));
  const routes = (n: number) => Array.from({ length: n }, (_, i) => {
    const row = data.routeStats[i % data.routeStats.length];
    return { ...row, key: `${row.key}#${i}` };
  });
  const sessionList = (n: number) => Array.from({ length: n }, (_, i) => data.sessions[i % data.sessions.length]);
  const noop = (): void => {};
  /** Scrolls the body of the section half-way down: the line of heads stays, the rows go under it. */
  const scrolled = (frame: HTMLElement): void => {
    find(frame, '.body').scrollTop = 80;
  };

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
<Frame name="history-eight" caption="the history of exactly eight runs in the section: it is as tall as its rows and has no scrollbar">
  <Section title="Мои маршруты" open onToggle={noop} scroll bodyMaxHeight={LIST_MAX_HEIGHT}>
    <HistoryList rows={history(LIST_ROWS)} />
  </Section>
</Frame>
<Frame name="history-long" caption="the history of twelve runs: the body is eight rows tall and scrolls, scrolled half-way here; the line of heads stays at the top" act={scrolled}>
  <Section title="Мои маршруты" open onToggle={noop} scroll bodyMaxHeight={LIST_MAX_HEIGHT}>
    <HistoryList rows={history(12)} />
  </Section>
</Frame>
<Frame name="routes-long" caption="twelve routes: eight rows and a scroll, scrolled half-way; the heads (the buttons of the sort) stay" act={scrolled}>
  <Section title="Мои маршруты" open onToggle={noop} scroll bodyMaxHeight={LIST_MAX_HEIGHT}>
    <RoutesTable rows={routes(12)} sort={DEFAULT_ROUTE_SORT} onSort={nothing} />
  </Section>
</Frame>
<Frame name="sessions-long" caption="twelve sessions: eight rows and a scroll, scrolled half-way" act={scrolled}>
  <Section title="Мои маршруты" open onToggle={noop} scroll bodyMaxHeight={LIST_MAX_HEIGHT}>
    <SessionsList rows={sessionList(12)} />
  </Section>
</Frame>
