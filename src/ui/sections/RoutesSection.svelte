<script lang="ts">
  import HistoryList from '../components/HistoryList.svelte';
  import RoutesTable from '../components/RoutesTable.svelte';
  import Section from '../components/Section.svelte';
  import SessionsList from '../components/SessionsList.svelte';
  import { app } from '../state.svelte';
  import { stats } from '../stats.svelte';
  import { STATS_VIEWS } from '../vm/stats-view';

  const SECTION = 'routes';
  // When the window has no height to spare, this section gives way before the terminal table does: the table is what
  // the player works in, the lists here are read. A larger factor takes more of the missing height (the options use a
  // small one for the opposite reason, see `OptionsSection`).
  const STATS_SHRINK = 4;

  const open = $derived(app.sectionOpen(SECTION));
  const view = $derived(stats.view);

  function toggle(): void {
    const opening = !open;
    void app.toggleSection(SECTION);
    if (opening) stats.opened();
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
-->
<Section title="Мои маршруты" summary={open ? undefined : stats.summary} {open} onToggle={toggle} {actions} scroll shrink={STATS_SHRINK}>
  {#if view === 'routes'}
    <RoutesTable rows={stats.routes} />
  {:else if view === 'history'}
    <HistoryList rows={stats.historyList} />
  {:else}
    <SessionsList rows={stats.sessionList} />
  {/if}
</Section>
