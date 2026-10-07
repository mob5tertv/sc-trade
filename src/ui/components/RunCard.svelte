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
  let cancelButton: HTMLButtonElement | null | undefined = $state(); // `bind:this`: `null` once the element has gone

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
  {#if confirming}
    <div class="confirm" role="alertdialog" aria-label="Груз потерян?" tabindex="-1" onkeydown={onKeydown}>
      <p class="ask">Рейс будет закрыт как потерянный, груз спишется. Продолжить?</p>
      <div class="buttons">
        <button type="button" class="sc-btn sc-btn--act danger" onclick={confirmLost}>Да, груз потерян</button>
        <button type="button" class="sc-btn sc-btn--act" bind:this={cancelButton} onclick={() => (confirming = false)}>Отмена</button>
      </div>
    </div>
  {:else}
    <div class="top">
      <span class="timer" title="Время с начала рейса">{timer}</span>
      <span class="spacer"></span>
      <button type="button" class="sc-btn sc-btn--act" onclick={() => onDepart()}>Взлетел</button>
      <button type="button" class="sc-btn sc-btn--act" onclick={() => onArrive()}>Прилетел</button>
      <button type="button" class="sc-btn sc-btn--act danger" onclick={() => (confirming = true)}>Груз потерян</button>
    </div>
  {/if}

  {#if cargo.length === 0}
    <p class="empty">В трюме пусто</p>
  {:else}
    <ul class="cargo">
      {#each cargo as line}
        <li class="line">
          <span class="code">{line.code}</span>
          <span class="sc-num">{line.scu} SCU</span>
          <span class="muted sc-num" title="Средневзвешенная цена закупки">по {formatUec(line.avgBuyPrice)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <dl class="totals">
    <div><dt class="sc-label">Вложено</dt><dd class="sc-num">{formatUec(totals.invested)}</dd></div>
    <div><dt class="sc-label">Выручка</dt><dd class="sc-num">{formatUec(totals.revenue)}</dd></div>
    <div>
      <dt class="sc-label">Прибыль</dt>
      <dd class="sc-num" class:good={totals.profit > 0} class:loss={totals.profit < 0}>{formatUec(totals.profit)}</dd>
    </div>
    <div><dt class="sc-label">ROI</dt><dd class="sc-num">{roi}</dd></div>
    <div><dt class="sc-label">UEC/ч</dt><dd class="sc-num">{rate}</dd></div>
  </dl>
</section>

<style>
  .card {
    padding: 0 var(--sc-pad-x);
  }

  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    height: calc(var(--sc-ctl-h) + 6px);
  }

  .timer {
    color: var(--sc-accent);
    font-size: 15px;
    font-weight: 600;
  }

  .spacer {
    flex: 1;
  }

  .cargo {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .line {
    display: grid;
    grid-template-columns: 52px 84px minmax(0, 1fr);
    align-items: center;
    gap: var(--sc-gap);
    height: var(--sc-row-h);
    border-top: 1px solid var(--sc-surface-2);
  }

  .code {
    font-weight: 600;
  }

  .line .sc-num {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--sc-gap);
    margin: 0;
    padding: 3px 0 4px;
    border-top: 1px solid var(--sc-border);
  }

  .totals div {
    min-width: 0;
  }

  dt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  dd {
    margin: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--sc-muted);
    text-align: left;
  }

  .empty {
    margin: 0;
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }

  .good {
    color: var(--sc-good);
  }

  .loss {
    color: var(--sc-bad);
  }

  .danger {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  .confirm {
    padding: 6px 0;
  }

  .ask {
    margin: 0 0 6px;
  }

  .buttons {
    display: flex;
    gap: 4px;
  }
</style>
