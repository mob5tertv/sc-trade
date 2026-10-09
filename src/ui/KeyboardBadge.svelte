<script lang="ts">
  import Icon from './components/Icon.svelte';
  import { app } from './state.svelte';
  import { BADGE_HINT, BADGE_TEXT } from './vm/keyboard-badge';

  /** The keyboard icon alone, for a header that has no room for the plaque (`badgeForm`); its tooltip says the same. */
  let { compact = false }: { compact?: boolean } = $props();
</script>

<!--
  The window holds the keyboard while the player types into a field, and nothing on the screen said how to give it back. The badge
  is in the header of the window and of the settings only while it does (`app.keyboardHeld`), and the header has no place reserved
  for it. It is a button: a click does what Esc in a field does. It never takes the keyboard (it is no field) and never puts the
  focus anywhere.
-->
{#if app.keyboardHeld}
  <button
    class="badge"
    class:compact
    type="button"
    aria-label="{BADGE_TEXT}: вернуть клавиатуру игре"
    title={BADGE_HINT}
    onclick={() => void app.giveKeyboardBack()}
  >
    {#if compact}<Icon name="keyboard" />{:else}{BADGE_TEXT}{/if}
  </button>
{/if}

<style>
  .badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    height: var(--sc-ctl-h);
    padding: 0 6px;
    border: 1px solid var(--sc-accent);
    border-radius: var(--sc-radius);
    background: transparent;
    color: var(--sc-accent);
    font: inherit;
    font-size: var(--sc-font-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .badge.compact {
    padding: 0 3px;
  }

  .badge:hover {
    background: var(--sc-surface-2);
  }
</style>
