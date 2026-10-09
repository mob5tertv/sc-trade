<script lang="ts">
  import { untrack } from 'svelte';
  import RunCard from '../components/RunCard.svelte';
  import SellDecisionView from '../components/SellDecisionView.svelte';
  import Section from '../components/Section.svelte';
  import { app } from '../state.svelte';
  import { runOutlook } from '../vm/run-outlook';
  import { cardMarks, phaseLine, runPhases } from '../vm/run-phase';
  import {
    cargoRows, decisionAtClock, planSummary, runHeader, runSectionKind, sellDecisionKey, sellDecisions, sellLogContext, targetOffer,
  } from '../vm/run-section';

  const SECTION = 'run';
  // The window gives up the length of this section after the table (shrink 1) and before the options (0.2): it is short
  // while the hold is small, and a long cargo scrolls inside it.
  const SHRINK = 0.4;

  // The section is drawn by the window only while a run goes on or a target is set (`runSectionKind`); the model is the
  // one the mini line reads, so both say the same.
  const model = $derived(app.strip);
  const kind = $derived(runSectionKind(model));
  const open = $derived(app.sectionOpen(SECTION));
  const active = $derived(app.activeRun);

  const header = $derived(model.kind === 'run' ? runHeader(model) : null);
  const summary = $derived(header !== null ? header.summary : model.kind === 'idle' && model.target !== null ? planSummary(model.target) : '');
  const hasTarget = $derived(model.target !== null);
  // a run without a target can take the terminal that is viewed as its target, from the header of the section
  const offer = $derived(targetOffer(active, app.settings.targetTerminalId, app.viewTerminalId, app.reference));

  // the three phases of the leg and the money, on the clock of the window (once a second); the money of a run that goes on
  // is its EXPECTED result (a run that is not finished is not a loss)
  const phases = $derived(active === null ? null : phaseLine(runPhases(active.run, active.events, app.now)));
  const outlook = $derived(active === null ? null : runOutlook(active, app.market, app.reference, app.settings, app.routeCtx()));
  const cargo = $derived(active === null ? [] : cargoRows(active.events, app.reference));
  // the header offers the mark that comes next; the body only what the header does not
  const marks = $derived(model.kind === 'run' ? cardMarks(model.phase) : []);

  // "Sell here or fly on": for the commodities of the hold that have a price of my own at the viewed terminal. The
  // alternatives (every terminal that buys the commodity) are counted when their inputs change (the market, the viewed
  // terminal, the cargo, the price, the settings), and again every 15 seconds on the slow clock of the table, which moves
  // the temperatures of the prices; they do not depend on the one-second clock. Only the rates follow it (`decisionAtClock`).
  // Counted only while the section is open.
  const counted = $derived(
    open && active !== null
      ? sellDecisions(active, app.market, app.reference, app.viewTerminalId, app.routeCtx(undefined, app.rowsNow))
      : [],
  );
  const decisions = $derived(
    active === null ? [] : counted.map((d) => decisionAtClock(d, app.now - active.run.startedAt)),
  );
  // and written to the log once per decision (what is decided, not the clock)
  const decisionKey = $derived(sellDecisionKey(counted));
  $effect(() => {
    void decisionKey;
    void app.market;
    untrack(() => {
      for (const d of counted) app.log.debug('sell', 'sell or continue', sellLogContext(d));
    });
  });

  function askLost(): void {
    app.ask(
      { text: 'Рейс закроется как потерянный, груз спишется. Продолжить?', yes: 'Да, груз потерян' },
      async () => {
        await app.loseCargo();
      },
    );
  }
</script>

{#snippet actions()}
  {#if header !== null}
    {@const next = model.kind === 'run' ? model.next : null}
    {#if offer !== null && !hasTarget}
      <button type="button" class="sc-btn sc-btn--act offer" title={offer.title} onclick={() => void app.setTarget(offer.terminalId)}>{offer.label}</button>
    {:else}
      <span class="target" class:none={!hasTarget} title={hasTarget ? 'Цель рейса' : 'Цель выбирается в списке вариантов'}>{header.target}</span>
    {/if}
    {#if next !== null}
      <button type="button" class="sc-btn sc-btn--act" onclick={() => void app.mark(next)}>{next === 'depart' ? 'Взлетел' : 'Прилетел'}</button>
    {/if}
  {/if}
{/snippet}

{#if kind !== null}
  <Section
    title="Рейс"
    {summary}
    {open}
    onToggle={() => void app.toggleSection(SECTION)}
    onClose={hasTarget ? () => void app.setTarget(null) : undefined}
    closeTitle="Снять цель"
    actions={kind === 'run' ? actions : undefined}
    scroll
    shrink={SHRINK}
  >
    {#if kind === 'plan'}
      <p class="plan">Таймер пойдёт с первой покупки</p>
    {:else if active !== null && phases !== null && outlook !== null}
      <RunCard {cargo} {phases} {outlook} {marks} onMark={(type) => void app.mark(type)} onLost={askLost} />
      {#each decisions as d (d.commodityId)}
        <SellDecisionView commodityCode={d.code} here={d.here} alternatives={d.alternatives} reference={app.reference} />
      {/each}
    {/if}
  </Section>
{/if}

<style>
  .target {
    max-width: 150px;
    overflow: hidden;
    color: var(--sc-accent);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target.none {
    color: var(--sc-muted);
  }

  /* the name of the terminal is cut like the name of the target is: a long one must not push the mark button out of the header */
  .offer {
    min-width: 0;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }
</style>
