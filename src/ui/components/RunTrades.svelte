<script lang="ts">
  import { resolveTrade } from '../vm/inputs';
  import type { TradeLine } from '../vm/run-trades';

  interface Props {
    /** The trades of one run, in the order they were made. */
    lines: TradeLine[];
    /** Writes the correction of one trade; the answer is the sentence to show when it was refused, `null` when it was written. */
    onSave: (edit: { eventId: number; scu: number; price: number }) => Promise<string | null>;
    /** Set for a run that is over: a button that takes the whole run out of the history. */
    onRemove?: () => void;
  }
  let { lines, onSave, onRemove }: Props = $props();

  // What is typed, per trade; a trade that was not touched has no entry and shows what is recorded.
  let typed = $state<Record<number, { scu: string; price: string }>>({});
  let failure = $state<{ eventId: number; text: string } | null>(null);
  let busy = $state<number | null>(null);

  const textOf = (line: TradeLine): { scu: string; price: string } => typed[line.eventId] ?? { scu: line.scuText, price: line.priceText };
  const set = (line: TradeLine, field: 'scu' | 'price', value: string): void => {
    typed[line.eventId] = { ...textOf(line), [field]: value };
    if (failure?.eventId === line.eventId) failure = null;
  };
  /** The numbers typed for a trade when they are numbers and differ from what is recorded; `null` otherwise. */
  function changed(line: TradeLine): { scu: number; price: number } | null {
    const text = typed[line.eventId];
    if (text === undefined) return null;
    const parsed = resolveTrade(text.scu, text.price);
    if (!parsed.ok || (parsed.scu === line.scu && parsed.price === line.price)) return null;
    return { scu: parsed.scu, price: parsed.price };
  }

  async function save(event: SubmitEvent, line: TradeLine): Promise<void> {
    event.preventDefault();
    const next = changed(line);
    if (next === null || busy !== null) return;
    busy = line.eventId;
    try {
      const refused = await onSave({ eventId: line.eventId, ...next });
      if (refused === null) delete typed[line.eventId];
      else failure = { eventId: line.eventId, text: refused };
    } finally {
      busy = null;
    }
  }
</script>

<div class="trades sc-reveal" role="group" aria-label="Сделки рейса">
  {#each lines as line (line.eventId)}
    {@const text = textOf(line)}
    <form class="trade" novalidate onsubmit={(e) => void save(e, line)}>
      <span class="what" title="{line.label}: {line.code}, {line.terminal}">
        <span class="label {line.type}">{line.label}</span><span class="code">{line.code}</span><span class="where">{line.terminal}</span>
      </span>
      <input
        class="sc-input sc-num in-scu"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        data-select-on-focus
        aria-label="Количество, SCU"
        title="Количество, SCU"
        value={text.scu}
        oninput={(e) => set(line, 'scu', e.currentTarget.value)}
      />
      <span class="unit">SCU ×</span>
      <input
        class="sc-input sc-num in-price"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        data-select-on-focus
        aria-label="Цена за SCU, UEC"
        title="Цена за SCU, UEC"
        value={text.price}
        oninput={(e) => set(line, 'price', e.currentTarget.value)}
      />
      <button type="submit" class="sc-btn sc-btn--act" disabled={changed(line) === null || busy !== null} title="Записать исправленную сделку">Исправить</button>
    </form>
    {#if failure?.eventId === line.eventId}<p class="failure" role="alert">{failure.text}</p>{/if}
  {/each}
  {#if lines.length === 0}<p class="none">В этом рейсе нет сделок</p>{/if}
  {#if onRemove}
    <p class="foot">
      <button type="button" class="sc-btn" title="Убрать этот рейс из истории. Цены в дневнике останутся" onclick={() => onRemove?.()}>Удалить рейс</button>
    </p>
  {/if}
</div>

<style>
  .trades {
    background: var(--sc-surface);
    border-bottom: 1px solid var(--sc-border);
  }

  .trade {
    display: flex;
    align-items: center;
    gap: var(--sc-gap);
    height: calc(var(--sc-row-h) + 4px);
    padding: 0 var(--sc-pad-x);
  }

  .what {
    display: flex;
    flex: 1 1 auto;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .label {
    flex: none;
    color: var(--sc-label);
    font-size: var(--sc-font-sm);
  }

  .code {
    flex: none;
    font-weight: 600;
  }

  .where {
    overflow: hidden;
    color: var(--sc-muted);
    text-overflow: ellipsis;
  }

  .in-scu {
    flex: none;
    width: 52px;
    text-align: right;
  }

  .in-price {
    flex: none;
    width: 72px;
    text-align: right;
  }

  .unit {
    flex: none;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .failure,
  .none,
  .foot {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    min-height: var(--sc-row-h);
    line-height: var(--sc-row-h);
  }

  .failure {
    color: var(--sc-bad);
  }

  .none {
    color: var(--sc-muted);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: calc(var(--sc-row-h) + 4px);
  }
</style>
