<script lang="ts">
  import HistoryList from '../components/HistoryList.svelte';
  import RoutesTable from '../components/RoutesTable.svelte';
  import Section from '../components/Section.svelte';
  import SessionsList from '../components/SessionsList.svelte';
  import { app } from '../state.svelte';
  import { stats } from '../stats.svelte';
  import { STATS_VIEWS } from '../vm/stats-view';

  const SECTION = 'routes';

  const open = $derived(app.sectionOpen(SECTION));
  const view = $derived(stats.view);
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

<Section title="Мои маршруты" summary={stats.summary} {open} onToggle={() => void app.toggleSection(SECTION)} {actions} scroll>
  {#if view === 'routes'}
    <RoutesTable rows={stats.routes} />
  {:else if view === 'history'}
    <HistoryList rows={stats.historyList} />
  {:else}
    <SessionsList rows={stats.sessionList} />
  {/if}
</Section>
