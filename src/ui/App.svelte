<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { DEFAULT_SETTINGS } from '../core/settings';
  import type { Logger } from '../data/logger';
  import { bindTriggers, type TriggerName } from '../platform/triggers';
  import {
    setMode,
    watchFocus,
    type SetModeOptions,
    type WindowLayout,
    type WindowMode,
  } from '../platform/window';

  let { log }: { log: Logger } = $props();

  // Placeholders until the settings task supplies the real values: the defaults.
  const LAYOUT: WindowLayout = {
    panelWidth: DEFAULT_SETTINGS.panelWidth,
    stripCorner: DEFAULT_SETTINGS.stripCorner,
    showStrip: DEFAULT_SETTINGS.showStrip,
    opacity: DEFAULT_SETTINGS.opacity,
  };
  // Every key is empty by default: nothing is assigned and no keyboard hook is installed.
  // To try the keys by hand, put e.g. 'F8' into `panel` here for a moment.
  const TRIGGER_KEYS: Record<TriggerName, string> = {
    panel: DEFAULT_SETTINGS.hotkeyPanel,
    depart: DEFAULT_SETTINGS.hotkeyDepart,
    arrive: DEFAULT_SETTINGS.hotkeyArrive,
  };

  let mode = $state<WindowMode>('strip');
  // The mode being switched to. It leads `mode` while a switch is in progress, so that the focus
  // changes caused by the switch are logged with the mode they belong to.
  let requestedMode: WindowMode = 'strip';
  let input: HTMLInputElement | undefined = $state();

  // Mode changes come from the strip, the keys, the tray, Esc and the focus; running them one
  // after another keeps the window and `mode` consistent when they arrive in quick succession.
  let queue: Promise<void> = Promise.resolve();

  function changeMode(
    pick: (current: WindowMode) => WindowMode,
    reason: string,
    options: SetModeOptions = {},
  ): void {
    queue = queue.then(async () => {
      const next = pick(mode);
      log.info('app', 'mode change', { from: mode, to: next, reason });
      requestedMode = next;
      try {
        await setMode(next, LAYOUT, log, options);
        mode = next;
      } catch {
        // already logged by setMode; keep the previous mode
        requestedMode = mode;
      }
    });
  }

  const openPanel = () => changeMode(() => 'panel', 'strip click');
  const closePanel = () => changeMode(() => 'strip', 'close button');
  const togglePanel = () => changeMode((current) => (current === 'panel' ? 'strip' : 'panel'), 'trigger');

  // The panel collapses by itself when the player clicks the game. Only a settled panel does:
  // while a switch is in progress, the focus changes belong to the switch. The game already has
  // the focus then, so it is not pulled back by force.
  function onFocusLost(): void {
    if (mode === 'panel' && requestedMode === 'panel') {
      changeMode(() => 'strip', 'focus lost', { restoreFocus: false });
    }
  }

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
    watchFocus(() => requestedMode, log, onFocusLost)
      .then((stop) => {
        if (disposed) stop();
        else unwatchFocus = stop;
      })
      .catch((err) => log.error('app', 'cannot listen for focus changes', { err }));

    changeMode(() => 'strip', 'startup');

    // Called even when no key is assigned: it also removes a hook left over from before a reload.
    void bindTriggers(
      TRIGGER_KEYS,
      {
        panel: togglePanel,
        depart: () => log.info('app', 'depart trigger, not wired yet'),
        arrive: () => log.info('app', 'arrive trigger, not wired yet'),
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
    <header>
      <h1>Панель</h1>
      <button class="close" type="button" aria-label="Закрыть" title="Закрыть (Esc)" onclick={closePanel}>
        ×
      </button>
    </header>
    <input bind:this={input} type="text" placeholder="Поле ввода" />
  </main>
{:else}
  <button class="strip" type="button" onclick={openPanel}>SC Trade</button>
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

  main,
  .strip {
    box-sizing: border-box;
    width: 100vw;
    height: 100vh;
    background: rgba(18, 20, 26, var(--overlay-opacity, 0.92));
  }

  /* The strip is a button: the whole badge takes the click. */
  .strip {
    display: block;
    margin: 0;
    padding: 0 12px;
    border: 0;
    color: inherit;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }

  .strip:hover {
    background: rgba(40, 44, 56, var(--overlay-opacity, 0.92));
  }

  .panel {
    padding: 16px;
  }

  .panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0 0 12px;
  }

  .panel h1 {
    margin: 0;
    font-size: 18px;
  }

  .close {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .close:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .panel input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
  }
</style>
