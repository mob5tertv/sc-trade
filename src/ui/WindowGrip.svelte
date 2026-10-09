<script lang="ts">
  import { app } from './state.svelte';

  /** A hairline at its right edge: the mini line tells its parts apart by lines. */
  let { divider = false }: { divider?: boolean } = $props();

  // The handle for moving the window. `data-drag` is what `drag.ts` looks for; a locked window ignores it.
  const locked = $derived(app.windowLocked);
</script>

<span
  class="grip"
  class:divider
  data-drag
  data-locked={locked}
  role="img"
  aria-label={locked ? 'Окно закреплено' : 'Перетащить окно'}
  title={locked ? 'Окно закреплено: открой замок, чтобы переместить' : 'Перетащить окно'}
>
  <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true">
    <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" />
    <circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
    <circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" />
  </svg>
</span>

<style>
  .grip {
    display: flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    padding: 0 6px;
    color: var(--sc-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }

  .grip svg {
    fill: currentColor;
  }

  .grip.divider {
    border-right: 1px solid var(--sc-border);
  }

  .grip:hover {
    color: var(--sc-text);
  }

  .grip[data-locked='true'] {
    cursor: not-allowed;
    opacity: 0.4;
  }
</style>
