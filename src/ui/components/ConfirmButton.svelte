<script lang="ts">
  // A button for a thing that must not happen by a misclick, which asks IN ITS OWN PLACE (the author's word of 13.10.2026: "put the
  // confirmation into the same button, so as not to carry the cursor across the whole application"). The first click turns it into
  // the question, the second one on the same button does the thing; left alone, it goes back by itself.
  interface Props {
    label: string;
    /** What the button reads after the first click: the question. */
    sureLabel: string;
    /** The tooltip before the first click: what the button does. */
    title?: string;
    onConfirm: () => void;
    /** How long the question waits for the second click, ms. */
    ms?: number;
    /** The button is one of the quiet ones of a card (`sc-btn--act`), in the colour of a thing that cannot be taken back. */
    danger?: boolean;
  }
  let { label, sureLabel, title, onConfirm, ms = 4000, danger = false }: Props = $props();

  let sure = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function click(): void {
    clearTimeout(timer);
    if (sure) {
      sure = false;
      onConfirm();
      return;
    }
    sure = true;
    timer = setTimeout(() => { sure = false; }, ms);
  }
</script>

<button
  type="button"
  class="sc-btn"
  class:sc-btn--act={danger}
  class:danger
  class:sure
  title={sure ? 'Нажми ещё раз, чтобы подтвердить. Не нажмёшь — кнопка вернётся сама' : title}
  onclick={click}
>{sure ? sureLabel : label}</button>

<style>
  /* asked once more: the colour of a thing that cannot be taken back */
  .sure {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  .danger {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }
</style>
