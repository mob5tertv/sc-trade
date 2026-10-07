<script lang="ts">
  import { app } from './state.svelte';

  // The handle for moving the window. `data-drag` is what `drag.ts` looks for; a locked window ignores it.
  const locked = $derived(app.windowLocked);
</script>

<span
  class="grip"
  data-drag
  data-locked={locked}
  role="img"
  aria-label={locked ? 'Окно закреплено' : 'Перетащить окно'}
  title={locked ? 'Окно закреплено: откройте замок, чтобы переместить' : 'Перетащить окно'}
>
  ⋮⋮
</span>

<style>
  .grip {
    flex: none;
    padding: 0 6px;
    color: var(--sc-muted);
    cursor: grab;
    line-height: 1;
    letter-spacing: -2px;
    touch-action: none;
    user-select: none;
  }

  .grip:hover {
    color: var(--sc-text);
  }

  .grip[data-locked='true'] {
    cursor: not-allowed;
    opacity: 0.4;
  }
</style>
