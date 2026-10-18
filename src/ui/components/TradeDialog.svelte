<script lang="ts">
  import { untrack } from 'svelte';
  import { formatUec } from '../../core/format';
  import { parseScu } from '../../core/input';
  import type { Side } from '../../core/types';
  import { resolveTrade } from '../vm/inputs';
  import { confirmStep, PRICE_CHECK_NOTE, STOCK_UNKNOWN_NOTE } from '../vm/trade-form';
  import { tr } from '../../i18n';

  interface Props {
    /** What is being written, for the screen reader and the tooltip: 'Купил MEDS'. */
    title: string;
    side: Side;
    /** The quantity and the price the form starts with; `null` leaves the field empty. */
    defaultScu: number | null;
    defaultPrice: number | null;
    /**
     * The price the form starts with is mine (a price I saw, not cold). `false`: it is the one of UEX, or mine gone cold, that the
     * row shows: it stands in the field muted, as in the field of the expanded row, until the player touches it. The row above
     * already says whose it is and how old (its plaque). Untouched, such a price is not written by the first confirmation: the form
     * asks the player to check it, and the next confirmation writes (`confirmStep`). Default: mine, nothing is marked or asked.
     */
    defaultPriceIsOwn?: boolean;
    /**
     * The largest quantity the service takes (`tradeLimit`): what the hold has for a sale, its free space for a purchase; `null` when
     * nothing limits it. The form refuses nothing by it: a larger quantity goes to the service, which says why, and that refusal
     * comes before anything is asked about the price. Default: no limit.
     */
    maxScu?: number | null;
    /** One muted line under the fields: what the trade is (an income says that the goods are not in the hold); `null` for none. */
    note?: string | null;
    /**
     * Why the trade could not be written, shown under the fields. The form confirms once and then waits: it takes a new
     * confirmation after `error` changes (the owner sets it back to `null` when it starts a write, so that the same
     * text twice in a row still counts as a change) or after a field is edited. On success the owner closes the form.
     */
    error: string | null;
    /** `toStorage`: of a purchase, how much of `scu` is left at the storage (version 1.4); absent or 0: everything goes into the hold. */
    onConfirm: (trade: { scu: number; price: number; toStorage?: number }) => void;
    onCancel: () => void;
    /** The form was confirmed with a number that cannot be a trade (nothing was written): which of the two fields was marked. */
    onReject?: (fields: { scu: boolean; price: boolean }) => void;
    /** The form was confirmed with a price that is not mine and that nobody touched: nothing was written, the player was asked to check it. */
    onPriceCheck?: () => void;
    /**
     * A purchase whose stock at the seller is unknown (`TradeDefaults.stockUnknown`): a «?» stands by the quantity and one line under the form says
     * that the quantity rests on the hold and the budget alone. Default: the stock is known, nothing is said.
     */
    stockUnknown?: boolean;
    /**
     * A purchase (version 1.4): the free space of the hold, and the place whose storage takes what does not fit. A quantity above the free
     * space is no refusal then: a line under the fields says how much goes into the hold (a number the player may change) and how much is
     * left at the storage. `null`: the hold is not known (no ship chosen), everything goes into it as before.
     */
    free?: number | null;
    storagePlace?: string;
    /** A button after the line `note` (a sale guessed to come from a storage offers «не со склада»). */
    noteAction?: { label: string; title: string; run: () => void } | null;
    /** The stock the seller is known to have: a purchase above it is probably a typo, and the line of the storage says so. */
    stockScu?: number | null;
  }
  let {
    title, side, defaultScu, defaultPrice, defaultPriceIsOwn = true, maxScu = null, note = null, error, onConfirm, onCancel, onReject, onPriceCheck,
    stockUnknown = false, free = null, storagePlace = '', stockScu = null, noteAction = null,
  }: Props = $props();

  // Seeded from the defaults once, when the form opens: they are plain numbers in the fields, easy to overtype. What the
  // player typed stays when the owner hands in a new `error` (a derived text would start again from the defaults).
  let scuText = $state(untrack(() => (defaultScu === null ? '' : String(defaultScu))));
  let priceText = $state(untrack(() => (defaultPrice === null ? '' : String(defaultPrice))));
  let badScu = $state(false);
  let badPrice = $state(false);
  // The price of somebody else stays muted until the player puts his hand to the field: from then on it is his number.
  let priceTouched = $state(false);
  const foreign = $derived(!defaultPriceIsOwn && !priceTouched && defaultPrice !== null);
  const priceHint = $derived(foreign ? tr('Цена за SCU, UEC: не твоя (UEX или давняя), поправь её, если видишь другую') : tr('Цена за SCU, UEC'));

  // A double click on the button or a held Enter must not write the trade twice while the owner is still writing it. The
  // form takes a new confirmation when the owner says the write failed (`error` is a text again: after the `null` the owner
  // sets when the write starts, so that the same text twice in a row is a change too) or when a field is edited. The `null`
  // itself is the write starting: it must NOT open the form again for a second press while the write is in flight.
  let confirmed = false;
  $effect(() => {
    if (error !== null) confirmed = false;
  });

  // What the two fields say now, in UEC: a check of the typing before it is written.
  const total = $derived.by(() => {
    const trade = resolveTrade(scuText, priceText);
    return trade.ok ? formatUec(trade.scu * trade.price) : null;
  });

  // A price that is not mine and that nobody touched is not written by one press of Enter (`confirmStep`): the first confirmation
  // writes nothing and asks, the next one writes. `checkShown`: the question stands under the fields, until the price is touched or
  // the form is confirmed again.
  let priceAsked = $state(false);
  let checkShown = $state(false);
  let priceInput = $state<HTMLInputElement | null>();

  // A purchase over the free space of the hold (version 1.4): the rest is left at the storage of the place. The number that goes into the
  // hold is the free space until the player types his own (he may load less, or nothing at all).
  const typedScu = $derived.by(() => {
    const scu = parseScu(scuText);
    return scu === null || scu === 0 ? null : scu;
  });
  let holdText = $state('');
  let holdTouched = $state(false);
  const splits = $derived(side === 'buy' && free !== null && typedScu !== null && (typedScu > free || holdTouched));
  const holdDefault = $derived(typedScu === null || free === null ? 0 : Math.max(0, Math.min(typedScu, free)));
  const hold = $derived.by(() => {
    if (!splits) return typedScu;
    if (!holdTouched) return holdDefault;
    return parseScu(holdText);
  });
  const stored = $derived(splits && typedScu !== null && hold !== null ? typedScu - hold : 0);
  const badHold = $derived(splits && (hold === null || typedScu === null || hold > typedScu || (free !== null && hold > free)));
  const aboveStock = $derived(splits && typedScu !== null && stockScu !== null && typedScu > stockScu);

  const stepFor = (scu: number) => confirmStep({
    priceIsOwn: defaultPriceIsOwn || defaultPrice === null, priceTouched, asked: priceAsked,
    fits: splits ? !badHold : maxScu === null || scu <= maxScu,
  });
  // The next press on the button of the form asks about the price. For the keyboard the button is then one that opens an entry
  // (ui/keyboard.ts): the press on it brings the keyboard to the window, and the cursor goes into the price.
  const asksNext = $derived.by(() => {
    const trade = resolveTrade(scuText, priceText);
    return trade.ok && stepFor(trade.scu) === 'check-price';
  });

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }): void {
    e.preventDefault();
    if (confirmed) return;
    const trade = resolveTrade(scuText, priceText);
    if (!trade.ok) {
      // the same refusal again (a held Enter) is one refusal: typing clears the marks, so a new one is a new report
      const again = badScu === trade.scu && badPrice === trade.price;
      badScu = trade.scu;
      badPrice = trade.price;
      if (!again) onReject?.({ scu: trade.scu, price: trade.price });
      return;
    }
    if (stepFor(trade.scu) === 'check-price') {
      priceAsked = true;
      checkShown = true;
      onPriceCheck?.();
      // Enter in a field of the form: the keyboard is with the window, and the cursor goes into the price, its number selected. After a
      // press on the button the keyboard rules put it there, and only when the window got the keyboard: with the keyboard at the game
      // no field may look as if it were being edited.
      if (document.activeElement instanceof HTMLInputElement && e.currentTarget.contains(document.activeElement)) {
        priceInput?.focus();
        priceInput?.select();
      }
      return;
    }
    if (splits && badHold) return; // the line of the storage says what is wrong with the number of the hold
    checkShown = false;
    confirmed = true;
    onConfirm(stored > 0 ? { scu: trade.scu, price: trade.price, toStorage: stored } : { scu: trade.scu, price: trade.price });
  }

  // Esc takes the form back and is left to go on: the window hands the keyboard back to the game (it never closes by Esc).
  // A held Enter is one confirmation: its repeats submit nothing, so the confirmation that follows a question is a press of its own.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'Enter' && e.repeat) e.preventDefault();
  }

  // ...and so is a double click on the button: its second click confirms nothing.
  function onSubmitClick(e: MouseEvent): void {
    if (e.detail > 1) e.preventDefault();
  }
</script>

<!--
  The form of a trade under the row it belongs to: in the flow of the window, never over it (the window is as big as its
  content, whatever sticks out is cut). The fields take the keyboard when they are clicked, like every field of the window;
  the button writes the trade, Enter in a field does the same. `data-select-on-focus`: a field that gets the cursor has its whole
  number selected, so that typing replaces it (ui/keyboard.ts). `data-entry-field`: the names by which the buttons that open the
  form («Купил», «Продал» of the row) say which field the cursor goes into. The button of the form itself is such a button
  (`data-opens-entry`) while its next press only asks about the price: the cursor goes into the price then.
-->
<form class="trade sc-reveal" aria-label={title} novalidate onsubmit={submit}>
  <div class="line">
    <input
      class="sc-input sc-num in-scu"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      data-select-on-focus
      data-entry-field="trade-scu"
      aria-label={tr('Количество, SCU')}
      title={tr('Количество, SCU')}
      placeholder="SCU"
      aria-invalid={badScu ? 'true' : undefined}
      value={scuText}
      oninput={(e) => { scuText = e.currentTarget.value; badScu = false; confirmed = false; }}
      onkeydown={onKeydown}
    />
    {#if stockUnknown}<span class="unsure" role="img" aria-label={STOCK_UNKNOWN_NOTE()} title={STOCK_UNKNOWN_NOTE()}>?</span>{/if}
    <span class="unit">SCU ×</span>
    <input
      bind:this={priceInput}
      class="sc-input sc-num in-price"
      class:foreign
      type="text"
      inputmode="numeric"
      autocomplete="off"
      data-select-on-focus
      data-entry-field="trade-price"
      aria-label={tr('Цена за SCU, UEC')}
      title={priceHint}
      placeholder="UEC"
      aria-invalid={badPrice ? 'true' : undefined}
      value={priceText}
      oninput={(e) => { priceText = e.currentTarget.value; priceTouched = true; checkShown = false; badPrice = false; confirmed = false; }}
      onkeydown={onKeydown}
    />
    <span class="unit">UEC</span>
    <span class="total sc-num" title={tr('Сумма сделки, UEC')}>{total === null ? '' : `= ${total}`}</span>
    <button
      type="submit"
      class="sc-btn sc-btn--primary"
      title={tr('Записать сделку (Enter)')}
      data-opens-entry={asksNext ? 'trade-price' : undefined}
      onclick={onSubmitClick}
    >{side === 'buy' ? tr('Купил') : tr('Продал')}</button>
    <button type="button" class="sc-btn" title={tr('Не записывать (Esc)')} onclick={() => onCancel()}>{tr('Отмена')}</button>
  </div>
  {#if splits}
    <!-- version 1.4: bought over the hold, the rest is left at the storage of the place; the number of the hold may be changed -->
    <p class="split" class:above={aboveStock}>
      <span>{tr('В трюм')}</span>
      <input
        class="sc-input sc-num in-hold"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        data-select-on-focus
        aria-label={tr('Сколько погрузить в трюм, SCU')}
        title={tr('Сколько погрузить в трюм, SCU: остальное останется на складе')}
        aria-invalid={badHold ? 'true' : undefined}
        value={holdTouched ? holdText : String(holdDefault)}
        oninput={(e) => { holdText = e.currentTarget.value; holdTouched = true; confirmed = false; }}
        onkeydown={onKeydown}
      />
      <span class="sc-num">· {tr('на склад {place}: {scu} SCU', { place: storagePlace, scu: Math.max(0, stored) })}</span>
    </p>
    {#if badHold}<p class="hint bad">{tr('В трюм — от нуля до свободного места ({free} SCU) и не больше купленного', { free: free ?? 0 })}</p>{/if}
    {#if aboveStock}<p class="hint check">{tr('Больше, чем запас станции ({stock} SCU) — проверь цифру', { stock: stockScu ?? 0 })}</p>{/if}
  {/if}
  {#if note}
    <p class="hint note">{note}{#if noteAction}<button type="button" class="link" title={noteAction.title} onclick={() => noteAction?.run()}>{noteAction.label}</button>{/if}</p>
  {/if}
  {#if stockUnknown}
    <p class="hint note"><span class="unsure" aria-hidden="true">?</span> {STOCK_UNKNOWN_NOTE()}</p>
  {/if}
  {#if badScu || badPrice}
    <p class="hint bad">{tr('Нужны целые числа: количество от 1, цена больше нуля.')}</p>
  {/if}
  {#if checkShown}
    <p class="hint check" role="status">{PRICE_CHECK_NOTE()}</p>
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

  /* a price that is not mine (UEX, or mine gone cold) reads as what the row says: muted, as in the field of the expanded row */
  .in-price.foreign {
    color: var(--sc-muted);
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

  .note {
    color: var(--sc-muted);
  }

  /* the stock at the seller is unknown: the same «?» as after the name of an option of the list, by the quantity that rests on no stock */
  .unsure {
    flex: none;
    color: var(--sc-warn);
    font-weight: 600;
  }

  /* the question about a price that is not mine: a caution, not a refusal */
  .check {
    color: var(--sc-warn);
  }

  .bad {
    color: var(--sc-bad);
  }

  /* bought over the hold (version 1.4): how much goes into the hold, and what the storage of the place keeps; in the colour of a
     caution, so that a typo (5120 for 512) does not go to the storage unseen */
  .split {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px 0 0;
    color: var(--sc-warn);
    font-size: var(--sc-font-sm);
    white-space: nowrap;
  }

  .split.above {
    color: var(--sc-bad);
  }

  .in-hold {
    flex: none;
    width: 48px;
  }

  .link {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--sc-accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
