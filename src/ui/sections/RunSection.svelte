<script lang="ts">
  import { untrack } from 'svelte';
  import { runTotals } from '../../core/run';
  import RunCard from '../components/RunCard.svelte';
  import SellDecisionView from '../components/SellDecisionView.svelte';
  import Section from '../components/Section.svelte';
  import { app } from '../state.svelte';
  import { phaseLine, runPhases } from '../vm/run-phase';
  import { cargoRows, planSummary, runHeader, runSectionKind, sellDecisionKey, sellDecisions, sellLogContext } from '../vm/run-section';

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

  // the three phases of the leg and the money so far, on the clock of the window (once a second)
  const phases = $derived(active === null ? null : phaseLine(runPhases(active.run, active.events, app.now)));
  const totals = $derived(active === null ? null : runTotals(active.run, active.events, app.now));
  const cargo = $derived(active === null ? [] : cargoRows(active.events, app.reference));

  // "Sell here or fly on": for the commodities of the hold that have a price of my own at the viewed terminal. It is
  // counted only while the section is open, and written to the log once per decision, not once per second.
  const decisions = $derived(
    open && active !== null ? sellDecisions(active, app.market, app.reference, app.viewTerminalId, app.routeCtx()) : [],
  );
  const decisionKey = $derived(sellDecisionKey(decisions));
  $effect(() => {
    void decisionKey;
    void app.market;
    untrack(() => {
      for (const d of decisions) app.log.debug('sell', 'sell or continue', sellLogContext(d));
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
    <span class="target" class:none={!hasTarget} title={hasTarget ? 'Цель рейса' : 'Цель выбирается в списке вариантов'}>{header.target}</span>
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
    {:else if active !== null && phases !== null && totals !== null}
      <RunCard
        {cargo}
        {phases}
        {totals}
        onDepart={() => void app.mark('depart')}
        onArrive={() => void app.mark('arrive')}
        onLost={askLost}
      />
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

  .plan {
    margin: 0;
    padding: 0 var(--sc-pad-x);
    height: var(--sc-row-h);
    color: var(--sc-muted);
    line-height: var(--sc-row-h);
  }
</style>
