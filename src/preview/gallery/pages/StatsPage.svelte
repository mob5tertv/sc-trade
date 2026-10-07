<script lang="ts">
  import HistoryList from '../../../ui/components/HistoryList.svelte';
  import RoutesTable from '../../../ui/components/RoutesTable.svelte';
  import SessionsList from '../../../ui/components/SessionsList.svelte';
  import { historyRows } from '../../../ui/vm/stats-rows';
  import { useGallery } from '../context';
  import Frame from '../Frame.svelte';

  const { data } = useGallery();
  // the run in progress is a row of the history too (the list shows the newest run first)
  const none = historyRows([], data.reference, data.now);
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
<Frame name="routes" caption="my routes: best rate first; the phases are in the title of the time">
  <RoutesTable rows={data.routeStats} />
</Frame>
<Frame name="routes-empty" caption="no finished run yet">
  <RoutesTable rows={[]} />
</Frame>
