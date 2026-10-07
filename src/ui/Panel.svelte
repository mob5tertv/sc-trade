<script lang="ts">
  import Header from './Header.svelte';
  import { app, type Tab } from './state.svelte';
  import SettingsTab from './tabs/SettingsTab.svelte';
  import TerminalTab from './tabs/TerminalTab.svelte';

  const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: 'terminal', label: 'Терминал' },
    { id: 'run', label: 'Рейс' },
    { id: 'routes', label: 'Маршруты' },
  ];
</script>

<main>
  {#if app.view === 'settings'}
    <div class="settings-head">
      <button class="sc-btn" type="button" onclick={() => app.closeSettings()}>← Назад</button>
      <strong>Настройки</strong>
      <button class="sc-btn sc-btn--ghost sc-btn--icon close" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
        ×
      </button>
    </div>
  {:else}
    <Header onClose={() => app.collapse('close button')} />

    <div class="tabs" role="tablist" aria-label="Вкладки">
      {#each TABS as tab (tab.id)}
        <button
          class="tab"
          class:selected={app.tab === tab.id}
          type="button"
          role="tab"
          id="tab-{tab.id}"
          aria-selected={app.tab === tab.id}
          aria-controls="tabpanel"
          onclick={() => app.setTab(tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if app.notice !== null}
    <div class="notice" class:error={app.notice.kind === 'error'} role="status">
      <span>{app.notice.text}</span>
      <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Скрыть сообщение" onclick={() => app.dismissNotice()}>
        ×
      </button>
    </div>
  {/if}

  <!-- the header stands still; when the content is taller than the window allows, this area scrolls -->
  <div class="content" id="tabpanel" role={app.view === 'settings' ? undefined : 'tabpanel'} aria-labelledby={app.view === 'settings' ? undefined : `tab-${app.tab}`}>
    {#if app.view === 'settings'}
      <SettingsTab />
    {:else if app.tab === 'terminal'}
      <TerminalTab />
    {:else if app.tab === 'run'}
      <p class="placeholder">Содержимое вкладки «Рейс» подключается отдельной задачей.</p>
    {:else}
      <p class="placeholder">Содержимое вкладки «Маршруты» подключается отдельной задачей.</p>
    {/if}
  </div>
</main>

<style>
  /* As tall as its content, but never taller than the root allows: then only `.content` shrinks and scrolls. */
  main {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    background: var(--sc-bg);
    border-left: 1px solid var(--sc-border);
    border-right: 1px solid var(--sc-border);
  }

  .settings-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--sc-gap);
    padding: var(--sc-gap) calc(var(--sc-gap) * 1.5);
    border-bottom: 1px solid var(--sc-border);
  }

  .settings-head .close {
    margin-left: auto;
  }

  .tabs {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 0 var(--sc-gap);
    border-bottom: 1px solid var(--sc-border);
  }

  .tab {
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--sc-muted);
    font: inherit;
    cursor: pointer;
  }

  .tab:hover {
    color: var(--sc-text);
  }

  .tab.selected {
    border-bottom-color: var(--sc-accent);
    color: var(--sc-text);
  }

  .notice {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    padding: 4px 4px 4px calc(var(--sc-gap) * 1.5);
    border-bottom: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }

  .notice.error {
    color: var(--sc-bad);
  }

  /* the content scrolls vertically inside the window, never sideways */
  .content {
    flex: 0 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .placeholder {
    margin: 0;
    padding: calc(var(--sc-gap) * 1.5);
    color: var(--sc-muted);
  }
</style>
