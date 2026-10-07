<script lang="ts">
  import { formatUec } from '../../core/format';
  import type { Side } from '../../core/types';
  import { resolveTrade } from '../vm/inputs';

  interface Props {
    /** What is being written, for the screen reader and the tooltip: 'Купил MEDS'. */
    title: string;
    side: Side;
    /** The quantity and the price the form starts with; `null` leaves the field empty. */
    defaultScu: number | null;
    defaultPrice: number | null;
    /**
     * Why the trade could not be written, shown under the fields. The form confirms once and then waits: it takes a new
     * confirmation after `error` changes (the owner sets it back to `null` when it starts a write, so that the same
     * text twice in a row still counts as a change) or after a field is edited. On success the owner closes the form.
     */
    error: string | null;
    onConfirm: (trade: { scu: number; price: number }) => void;
    onCancel: () => void;
  }
  let { title, side, defaultScu, defaultPrice, error, onConfirm, onCancel }: Props = $props();

  // Seeded from the defaults; they are plain numbers in the fields, easy to overtype.
  let scuText = $derived(defaultScu === null ? '' : String(defaultScu));
  let priceText = $derived(defaultPrice === null ? '' : String(defaultPrice));
  let badScu = $state(false);
  let badPrice = $state(false);

  // A double click on the button or a held Enter must not write the trade twice while the owner is still writing it.
  let confirmed = false;
  $effect(() => {
    void error;
    confirmed = false;
  });

  // What the two fields say now, in UEC: a check of the typing before it is written.
  const total = $derived.by(() => {
    const trade = resolveTrade(scuText, priceText);
    return trade.ok ? formatUec(trade.scu * trade.price) : null;
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

  // Esc takes the form back and is left to go on: the window hands the keyboard back to the game (it never closes by Esc).
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onCancel();
  }
</script>

<!--
  The form of a trade under the row it belongs to: in the flow of the window, never over it (the window is as big as its
  content, whatever sticks out is cut). The fields take the keyboard when they are clicked, like every field of the window;
  the button writes the trade, Enter in a field does the same.
-->
<form class="trade sc-reveal" aria-label={title} novalidate onsubmit={submit}>
  <div class="line">
    <input
      class="sc-input sc-num in-scu"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      aria-label="Количество, SCU"
      title="Количество, SCU"
      placeholder="SCU"
      aria-invalid={badScu ? 'true' : undefined}
      value={scuText}
      oninput={(e) => { scuText = e.currentTarget.value; badScu = false; confirmed = false; }}
      onkeydown={onKeydown}
    />
    <span class="unit">SCU ×</span>
    <input
      class="sc-input sc-num in-price"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      aria-label="Цена за SCU, UEC"
      title="Цена за SCU, UEC"
      placeholder="UEC"
      aria-invalid={badPrice ? 'true' : undefined}
      value={priceText}
      oninput={(e) => { priceText = e.currentTarget.value; badPrice = false; confirmed = false; }}
      onkeydown={onKeydown}
    />
    <span class="unit">UEC</span>
    <span class="total sc-num" title="Сумма сделки, UEC">{total === null ? '' : `= ${total}`}</span>
    <button type="submit" class="sc-btn sc-btn--primary" title="Записать сделку (Enter)">{side === 'buy' ? 'Купил' : 'Продал'}</button>
    <button type="button" class="sc-btn" title="Не записывать (Esc)" onclick={() => onCancel()}>Отмена</button>
  </div>
  {#if badScu || badPrice}
    <p class="hint bad">Нужны целые числа: количество от 1, цена больше нуля.</p>
  {/if}
  {#if error}
    <p class="hint bad" role="alert">{error}</p>
  {/if}
</form>

<style>
  .trade {
    padding: 4px var(--sc-pad-x);
    border-top: 1px solid var(--sc-border);
    background: var(--sc-surface);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--sc-ctl-h);
  }

  .in-scu {
    flex: none;
    width: 48px;
  }

  .in-price {
    flex: none;
    width: 58px;
  }

  .unit {
    flex: none;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    white-space: nowrap;
  }

  .total {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    color: var(--sc-label);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    margin: 4px 0 0;
    font-size: var(--sc-font-sm);
  }

  .bad {
    color: var(--sc-bad);
  }
</style>
