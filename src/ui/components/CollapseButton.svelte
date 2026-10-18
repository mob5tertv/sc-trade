<script lang="ts">
  import Icon from './Icon.svelte';
  import { app } from '../state.svelte';
  import { tr } from '../../i18n';

  // «Свернуть» of every view of the unfolded window. A click folds it into the mini line; held for `HOLD_MS` it puts the window away
  // completely (version 1.4, the author: «с помощью долгого нажатия на свёртывание сворачивать окно полностью»), back with the tray or the
  // key of the panel. While it is held a line fills under the icon, so the player sees the press is counted.

  interface Props {
    /** More classes of the button (a view places it by its own class). */
    extra?: string;
    /** The mark the demo trip points at. */
    tour?: string;
  }
  let { extra = '', tour }: Props = $props();

  const HOLD_MS = 600;

  let holding = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  // the hold put the window away: the click that comes with the release must not fold it once more
  let held = false;

  function press(event: PointerEvent): void {
    if (event.button !== 0) return;
    held = false;
    holding = true;
    timer = setTimeout(() => {
      timer = null;
      holding = false;
      held = true;
      void app.hideAway('collapse button held');
    }, HOLD_MS);
  }

  function letGo(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    holding = false;
  }

  function click(): void {
    if (held) {
      held = false;
      return;
    }
    void app.collapse('close button');
  }

  $effect(() => () => letGo());
</script>

<button
  class="sc-btn sc-btn--ghost sc-btn--icon hold {extra}"
  class:holding
  type="button"
  data-tour={tour}
  aria-label={tr('Свернуть')}
  title={tr('Свернуть. Удерживай — спрятать окно совсем; вернуть его — значок в трее или клавиша окна')}
  style:--hold-ms="{HOLD_MS}ms"
  onpointerdown={press}
  onpointerup={letGo}
  onpointerleave={letGo}
  onpointercancel={letGo}
  onclick={click}
>
  <Icon name="minus" />
</button>

<style>
  .hold {
    position: relative;
  }

  /* the line that fills while the button is held */
  .hold::after {
    content: '';
    position: absolute;
    left: 3px;
    bottom: 2px;
    width: 0;
    height: 2px;
    background: var(--sc-accent);
  }

  .hold.holding::after {
    width: calc(100% - 6px);
    transition: width var(--hold-ms) linear;
  }
</style>
