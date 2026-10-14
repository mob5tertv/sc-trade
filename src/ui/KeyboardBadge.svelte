<script lang="ts">
  import { app } from './state.svelte';
  import { BADGE_HINT, BADGE_TEXT, GONE_HINT, GONE_TEXT, keyboardSign } from './vm/keyboard-badge';
  import { tr } from '../i18n';

  const sign = $derived(keyboardSign(app.keyboardHeld, app.keyboardGoneSign));
</script>

<!--
  The signs of the keyboard as a badge of its own, for a header that has room to spare (the settings); the header of the main screen shows
  the same signs in the place of its UEX indicator. No place is reserved for the badge.
  «Esc — в игру» is there while the window holds the keyboard (`app.keyboardHeld`). It is a button: a click does what Esc in a field does.
  It never takes the keyboard (it is no field) and never puts the focus anywhere.
  «Клавиатура у игры» stands in the same place for a few seconds after the keyboard went back to the game by itself (`app.keyboardGoneSign`):
  muted, and no button, it only tells. A press on a field takes it away at once.
-->
{#if sign === 'held'}
  <button class="badge" type="button" aria-label={tr('{badge}: вернуть клавиатуру игре', { badge: BADGE_TEXT() })} title={BADGE_HINT()} onclick={() => void app.giveKeyboardBack()}>
    {BADGE_TEXT()}
  </button>
{:else if sign === 'gone'}
  <span class="badge gone" role="status" title={GONE_HINT()}>{GONE_TEXT()}</span>
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

  /* the keyboard is with the game again: nothing to press, so no accent and no hand */
  .badge.gone,
  .badge.gone:hover {
    border-color: var(--sc-border);
    background: transparent;
    color: var(--sc-muted);
    cursor: default;
  }
</style>
