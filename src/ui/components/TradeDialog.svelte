<script lang="ts">
  import { onMount } from 'svelte';
  import type { Side } from '../../core/types';
  import { resolveTrade } from '../vm/inputs';

  interface Props {
    title: string;
    side: Side;
    defaultScu: number;
    defaultPrice: number;
    /**
     * Why the trade could not be written, shown under the inputs. The dialog confirms once and then waits: it
     * takes a new confirmation after `error` changes (the owner sets it back to `null` when it starts a write)
     * or after an input is edited. On success the owner closes the dialog.
     */
    error: string | null;
    onConfirm: (trade: { scu: number; price: number }) => void;
    onCancel: () => void;
  }
  let { title, side, defaultScu, defaultPrice, error, onConfirm, onCancel }: Props = $props();

  // Seeded from the defaults; they are plain numbers in the inputs, easy to overtype.
  let scuText = $derived(String(defaultScu));
  let priceText = $derived(String(defaultPrice));
  let badScu = $state(false);
  let badPrice = $state(false);
  let scuInput: HTMLInputElement | undefined = $state();

  // A double click on the button or a held Enter must not write the trade twice while the owner is still writing it.
  let confirmed = false;
  $effect(() => {
    void error;
    confirmed = false;
  });

  onMount(() => {
    scuInput?.focus();
    scuInput?.select();
  });

  function submit(e: Event): void {
    e.preventDefault();
    if (confirmed) return;
    const trade = resolveTrade(scuText, priceText);
    if (!trade.ok) {
      badScu = trade.scu;
      badPrice = trade.price;
      return;
    }
    confirmed = true;
    onConfirm({ scu: trade.scu, price: trade.price });
  }

  // Esc only closes the dialog: it must not go on and close the panel behind it.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  }
</script>

<div class="overlay">
  <button type="button" class="backdrop" tabindex="-1" aria-label="Отмена" onclick={() => onCancel()}></button>
  <div class="dialog" role="dialog" aria-label={title} tabindex="-1" onkeydown={onKeydown}>
    <form onsubmit={submit} novalidate>
      <h3 class="title" {title}>{title}</h3>

      <label class="field">
        <span class="sc-label">Количество, SCU</span>
        <input
          bind:this={scuInput}
          class="sc-input sc-num"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          aria-invalid={badScu ? 'true' : undefined}
          value={scuText}
          oninput={e => { scuText = e.currentTarget.value; badScu = false; confirmed = false; }}
        />
      </label>

      <label class="field">
        <span class="sc-label">Цена за SCU, UEC</span>
        <input
          class="sc-input sc-num"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          aria-invalid={badPrice ? 'true' : undefined}
          value={priceText}
          oninput={e => { priceText = e.currentTarget.value; badPrice = false; confirmed = false; }}
        />
      </label>

      {#if badScu || badPrice}
        <p class="hint bad">Нужны целые числа: количество от 1, цена больше нуля.</p>
      {/if}
      {#if error}
        <p class="hint bad" role="alert">{error}</p>
      {/if}

      <div class="buttons">
        <button type="submit" class="sc-btn sc-btn--primary" title="Enter">{side === 'buy' ? 'Купил' : 'Продал'}</button>
        <button type="button" class="sc-btn" title="Esc" onclick={() => onCancel()}>Отмена</button>
      </div>
    </form>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: color-mix(in srgb, var(--sc-bg-solid) 70%, transparent);
    cursor: default;
  }

  .dialog {
    position: relative;
    width: min(340px, 100%);
    padding: 6px var(--sc-pad-x) var(--sc-pad-x);
    border: 1px solid var(--sc-frame);
    background: var(--sc-surface);
    color: var(--sc-text);
  }

  .title {
    margin: 0 0 4px;
    overflow: hidden;
    font-size: var(--sc-font);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px;
    align-items: center;
    gap: var(--sc-gap);
    height: 26px;
  }

  .hint {
    margin: 4px 0 0;
    font-size: var(--sc-font-sm);
  }

  .bad {
    color: var(--sc-bad);
  }

  .buttons {
    display: flex;
    gap: var(--sc-gap);
    margin-top: var(--sc-gap);
  }
</style>
