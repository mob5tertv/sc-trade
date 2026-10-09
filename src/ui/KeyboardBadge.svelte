<script lang="ts">
  import { app } from './state.svelte';
  import { BADGE_HINT, BADGE_TEXT } from './vm/keyboard-badge';
</script>

<!--
  The sign «Esc — в игру» as a badge of its own, for a header that has room to spare (the settings); the header of the main screen shows the
  same sign in the place of its UEX indicator. It is there only while the window holds the keyboard (`app.keyboardHeld`), and no place is
  reserved for it. It is a button: a click does what Esc in a field does. It never takes the keyboard (it is no field) and never puts the
  focus anywhere.
-->
{#if app.keyboardHeld}
  <button class="badge" type="button" aria-label="{BADGE_TEXT}: вернуть клавиатуру игре" title={BADGE_HINT} onclick={() => void app.giveKeyboardBack()}>
    {BADGE_TEXT}
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

  .badge:hover {
    background: var(--sc-surface-2);
  }
</style>
