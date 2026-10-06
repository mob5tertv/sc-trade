<script lang="ts">
  import { onMount } from 'svelte';
  import type { Side } from '../../core/types';
  import { resolveTrade } from '../vm/inputs';

  interface Props {
    title: string;
    side: Side;
    defaultScu: number;
    defaultPrice: number;
    /** Why the trade could not be written, shown under the inputs. */
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

  onMount(() => {
    scuInput?.focus();
    scuInput?.select();
  });

  function submit(e: Event): void {
    e.preventDefault();
    const trade = resolveTrade(scuText, priceText);
    if (!trade.ok) {
      badScu = trade.scu;
      badPrice = trade.price;
      return;
    }
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
  <button type="button" class="backdrop" tabindex="-1" aria-label="Отмена" onclick={onCancel}></button>
  <div class="dialog" role="dialog" aria-label={title} tabindex="-1" onkeydown={onKeydown}>
    <form onsubmit={submit} novalidate>
      <h3 class="title">{title}</h3>

      <label class="field">
        <span>Количество, SCU</span>
        <input
          bind:this={scuInput}
          class:invalid={badScu}
          type="text"
          inputmode="numeric"
          autocomplete="off"
          aria-invalid={badScu ? 'true' : undefined}
          value={scuText}
          oninput={e => { scuText = e.currentTarget.value; badScu = false; }}
        />
      </label>

      <label class="field">
        <span>Цена за SCU, UEC</span>
        <input
          class:invalid={badPrice}
          type="text"
          inputmode="numeric"
          autocomplete="off"
          aria-invalid={badPrice ? 'true' : undefined}
          value={priceText}
          oninput={e => { priceText = e.currentTarget.value; badPrice = false; }}
        />
      </label>

      {#if badScu || badPrice}
        <p class="hint bad">Нужны целые числа: количество от 1, цена больше нуля.</p>
      {/if}
      {#if error}
        <p class="hint bad" role="alert">{error}</p>
      {/if}

      <div class="buttons">
        <button type="submit" class="primary">{side === 'buy' ? 'Купил' : 'Продал'}</button>
        <button type="button" onclick={onCancel}>Отмена</button>
        <span class="hint keys">Enter — записать, Esc — отмена</span>
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
    background: color-mix(in srgb, var(--sc-bg) 70%, transparent);
    cursor: default;
  }

  .dialog {
    position: relative;
    box-sizing: border-box;
    width: min(340px, 100%);
    padding: 10px 12px 12px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-surface);
    color: var(--sc-text);
    font-size: var(--sc-font);
  }

  .title {
    margin: 0 0 6px;
    font-size: var(--sc-font);
    font-weight: 600;
  }

  .field {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 110px;
    align-items: center;
    gap: var(--sc-gap);
    min-height: 32px;
  }

  input {
    box-sizing: border-box;
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-bg);
    color: var(--sc-text);
    font: inherit;
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  input.invalid {
    border-color: var(--sc-bad);
  }

  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--sc-accent);
    outline-offset: 1px;
  }

  .hint {
    margin: 4px 0 0;
    font-size: var(--sc-font-sm);
    color: var(--sc-muted);
  }

  .bad {
    color: var(--sc-bad);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }

  .buttons button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    font-size: var(--sc-font-sm);
    cursor: pointer;
  }

  .buttons button:hover {
    background: var(--sc-surface-2);
  }

  .primary {
    border-color: var(--sc-accent);
  }

  .keys {
    margin: 0 0 0 auto;
  }
</style>
