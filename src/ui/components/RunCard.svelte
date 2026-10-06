<script lang="ts">
  import { formatCompact, formatPct, formatUec } from '../../core/format';
  import type { RunTotals } from '../../core/run';

  interface Props {
    cargo: Array<{ code: string; scu: number; avgBuyPrice: number }>;
    timer: string;
    totals: RunTotals;
    onDepart: () => void;
    onArrive: () => void;
    /** Called only after the player has confirmed inside the card. */
    onLost: () => void;
  }
  let { cargo, timer, totals, onDepart, onArrive, onLost }: Props = $props();

  const NONE = '—';

  let confirming = $state(false);
  let cancelButton: HTMLButtonElement | undefined = $state();

  // The safe answer gets the focus: a stray Enter must not lose the cargo.
  $effect(() => {
    if (confirming) cancelButton?.focus();
  });

  function confirmLost(): void {
    confirming = false;
    onLost();
  }

  // Esc takes the question back; with no question asked it goes on and closes the panel.
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && confirming) {
      e.stopPropagation();
      confirming = false;
    }
  }

  const roi = $derived(totals.roi === null ? NONE : formatPct(totals.roi));
  const rate = $derived(totals.uecPerHour === null ? NONE : `${formatCompact(totals.uecPerHour)}/ч`);
</script>

<section class="card" aria-label="Текущий рейс">
  <div class="top">
    <h3 class="title">Текущий рейс</h3>
    <span class="timer" title="Время с начала рейса">{timer}</span>
  </div>

  {#if cargo.length === 0}
    <p class="muted empty">В трюме пусто.</p>
  {:else}
    <ul class="cargo">
      {#each cargo as line}
        <li class="line">
          <span class="code">{line.code}</span>
          <span class="num">{line.scu} SCU</span>
          <span class="muted" title="Средневзвешенная цена закупки">по <span class="num">{formatUec(line.avgBuyPrice)}</span></span>
        </li>
      {/each}
    </ul>
  {/if}

  <dl class="totals">
    <div><dt>Вложено</dt><dd class="num">{formatUec(totals.invested)}</dd></div>
    <div><dt>Выручка</dt><dd class="num">{formatUec(totals.revenue)}</dd></div>
    <div>
      <dt>Прибыль</dt>
      <dd class="num" class:good={totals.profit > 0} class:loss={totals.profit < 0}>{formatUec(totals.profit)}</dd>
    </div>
    <div><dt>ROI</dt><dd class="num">{roi}</dd></div>
    <div><dt>UEC/ч</dt><dd class="num">{rate}</dd></div>
  </dl>

  {#if confirming}
    <div class="confirm" role="alertdialog" aria-label="Груз потерян?" tabindex="-1" onkeydown={onKeydown}>
      <p class="ask">Рейс будет закрыт как потерянный, груз спишется. Продолжить?</p>
      <div class="buttons">
        <button type="button" class="danger" onclick={confirmLost}>Да, груз потерян</button>
        <button type="button" bind:this={cancelButton} onclick={() => (confirming = false)}>Отмена</button>
      </div>
    </div>
  {:else}
    <div class="buttons">
      <button type="button" onclick={onDepart}>Взлетел</button>
      <button type="button" onclick={onArrive}>Прилетел</button>
      <button type="button" class="danger lost" onclick={() => (confirming = true)}>Груз потерян</button>
    </div>
  {/if}
</section>

<style>
  .card {
    padding: 4px 8px 8px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: var(--sc-surface);
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
  }

  .title {
    margin: 0;
    font-size: var(--sc-font);
    font-weight: 600;
  }

  .timer {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
    font-size: calc(var(--sc-font) * 1.4);
    font-weight: 600;
  }

  .cargo {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .line {
    display: flex;
    align-items: baseline;
    gap: var(--sc-gap);
    min-height: 24px;
  }

  .code {
    min-width: 48px;
    font-family: var(--sc-mono);
    font-weight: 600;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(84px, 1fr));
    gap: 4px var(--sc-gap);
    margin: 6px 0;
  }

  .totals div {
    min-width: 0;
  }

  dt {
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num {
    font-family: var(--sc-mono);
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--sc-muted);
  }

  .empty {
    margin: 0;
    min-height: 24px;
  }

  .good {
    color: var(--sc-good);
  }

  .loss {
    color: var(--sc-bad);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  button {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--sc-border);
    border-radius: var(--sc-radius);
    background: transparent;
    color: var(--sc-text);
    font: inherit;
    font-size: var(--sc-font-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  button:hover {
    background: var(--sc-surface-2);
  }

  button:focus-visible {
    outline: 2px solid var(--sc-accent);
    outline-offset: 1px;
  }

  .danger {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  .lost {
    margin-left: auto;
  }

  .confirm {
    padding: 6px;
    border: 1px solid var(--sc-bad);
    border-radius: var(--sc-radius);
  }

  .ask {
    margin: 0 0 6px;
  }
</style>
