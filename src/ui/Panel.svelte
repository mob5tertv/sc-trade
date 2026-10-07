<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './Header.svelte';
  import { app, type Tab } from './state.svelte';
  import SettingsTab from './tabs/SettingsTab.svelte';
  import TerminalTab from './tabs/TerminalTab.svelte';
  import { createHeldKeyGuard } from './vm/held-keys';

  const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: 'terminal', label: 'Терминал' },
    { id: 'run', label: 'Рейс' },
    { id: 'routes', label: 'Маршруты' },
    { id: 'settings', label: 'Настройки' },
  ];

  let header = $state<ReturnType<typeof Header>>();

  // The player opens the panel with a click while still holding a key of the game (`F` shows its
  // cursor), and Windows keeps repeating that key into the panel. A key types only after it was
  // pressed again inside the window; `Esc` and the other keys pressed fresh work as usual.
  const heldKeys = createHeldKeyGuard();
  let heldKeyLogged = false;

  function forgetHeldKeys(): void {
    heldKeys.reset();
    heldKeyLogged = false;
  }

  // Capture phase on the window: it runs before the input, the search list and the Esc handler of the panel.
  function onKeydownCapture(event: KeyboardEvent): void {
    if (!heldKeys.shouldSwallow(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!heldKeyLogged) {
      heldKeyLogged = true;
      app.log.debug('ui', 'held key ignored');
    }
  }

  const onKeyupCapture = (event: KeyboardEvent): void => heldKeys.released(event.code);

  onMount(() => {
    forgetHeldKeys();
    window.addEventListener('keydown', onKeydownCapture, true);
    window.addEventListener('keyup', onKeyupCapture, true);
    // the window got the focus again (the player came back to it): keys held by then are not ours
    window.addEventListener('focus', forgetHeldKeys);

    // Lets typing start right away when the panel opens: the location search takes the cursor.
    header?.focusSearch();

    return () => {
      window.removeEventListener('keydown', onKeydownCapture, true);
      window.removeEventListener('keyup', onKeyupCapture, true);
      window.removeEventListener('focus', forgetHeldKeys);
    };
  });
</script>

<main>
  <Header bind:this={header} onClose={() => app.closePanel('close button')} />

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

  {#if app.notice !== null}
    <div class="notice" class:error={app.notice.kind === 'error'} role="status">
      <span>{app.notice.text}</span>
      <button class="sc-btn sc-btn--ghost sc-btn--icon" type="button" aria-label="Скрыть сообщение" onclick={() => app.dismissNotice()}>
        ×
      </button>
    </div>
  {/if}

  <div class="content" id="tabpanel" role="tabpanel" aria-labelledby="tab-{app.tab}">
    {#if app.tab === 'settings'}
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
  main {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    background: var(--sc-bg);
    border-left: 1px solid var(--sc-border);
    border-right: 1px solid var(--sc-border);
  }

  .tabs {
    display: flex;
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

  /* the content scrolls vertically inside the panel, never sideways */
  .content {
    flex: 1;
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
