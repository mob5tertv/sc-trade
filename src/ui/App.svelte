<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import type { Logger } from '../data/logger';
  import { bindHotkeys, type HotkeyName } from '../platform/hotkeys';
  import { setMode, watchFocus, type WindowLayout, type WindowMode } from '../platform/window';

  let { log }: { log: Logger } = $props();

  // Placeholders until the settings task supplies the real values.
  const LAYOUT: WindowLayout = {
    panelSide: 'right',
    panelWidth: 470,
    stripCorner: 'top-left',
    showStrip: true,
    opacity: 0.92,
  };
  const HOTKEYS: Record<HotkeyName, string> = {
    panel: 'Ctrl+Alt+T',
    depart: 'Ctrl+Alt+1',
    arrive: 'Ctrl+Alt+2',
  };

  let mode = $state<WindowMode>('strip');
  // The mode being switched to. It leads `mode` while a switch is in progress, so that the focus
  // changes caused by the switch are logged with the mode they belong to.
  let requestedMode: WindowMode = 'strip';
  let input: HTMLInputElement | undefined = $state();

  // Mode changes come from hotkeys, the tray and Esc; running them one after another keeps
  // the window and `mode` consistent when they arrive in quick succession.
  let queue: Promise<void> = Promise.resolve();

  function changeMode(pick: (current: WindowMode) => WindowMode, reason: string): void {
    queue = queue.then(async () => {
      const next = pick(mode);
      log.info('app', 'mode change', { from: mode, to: next, reason });
      requestedMode = next;
      try {
        await setMode(next, LAYOUT, log);
        mode = next;
      } catch {
        // already logged by setMode; keep the previous mode
        requestedMode = mode;
      }
    });
  }

  const togglePanel = () => changeMode((current) => (current === 'panel' ? 'strip' : 'panel'), 'hotkey');

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && mode === 'panel') {
      changeMode(() => 'strip', 'escape');
    }
  }

  // Lets typing start right away when the panel opens.
  $effect(() => {
    if (mode === 'panel') input?.focus();
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    let unwatchFocus: (() => void) | undefined;
    let disposed = false;

    // Subscribed before the first mode change so that its focus changes are logged too.
    watchFocus(() => requestedMode, log)
      .then((stop) => {
        if (disposed) stop();
        else unwatchFocus = stop;
      })
      .catch((err) => log.error('app', 'cannot listen for focus changes', { err }));

    changeMode(() => 'strip', 'startup');

    void bindHotkeys(
      HOTKEYS,
      {
        panel: togglePanel,
        depart: () => log.info('app', 'depart hotkey pressed, not wired yet'),
        arrive: () => log.info('app', 'arrive hotkey pressed, not wired yet'),
      },
      log,
    );

    listen('tray://show-panel', () => {
      log.info('app', 'tray: show panel');
      changeMode(() => 'panel', 'tray');
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((err) => log.error('app', 'cannot listen for the tray event', { err }));

    return () => {
      disposed = true;
      unlisten?.();
      unwatchFocus?.();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if mode === 'panel'}
  <main class="panel">
    <h1>Панель</h1>
    <input bind:this={input} type="text" placeholder="Поле ввода" />
  </main>
{:else}
  <main class="strip">SC Trade</main>
{/if}

<style>
  :global(html),
  :global(body) {
    margin: 0;
    background: transparent;
    overflow: hidden;
    font-family: system-ui, sans-serif;
    color: #e8eaf0;
  }

  main {
    box-sizing: border-box;
    width: 100vw;
    height: 100vh;
    background: rgba(18, 20, 26, var(--overlay-opacity, 0.92));
  }

  .strip {
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 14px;
  }

  .panel {
    padding: 16px;
  }

  .panel h1 {
    margin: 0 0 12px;
    font-size: 18px;
  }

  .panel input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
  }
</style>
