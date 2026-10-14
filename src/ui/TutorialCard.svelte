<script lang="ts">
  import { tr } from '../i18n';
  import { app } from './state.svelte';
  import { nextTutorialStep, TUTORIAL_STEPS, tutorialCounter } from './vm/tutorial';

  // The card of the tutorial (version 1.3), at the top of the window, over the part it speaks of. The element of the window the
  // step names is marked while the step is on the screen (`data-tour`, the class `sc-tour-target` of the theme).
  const index = $derived(app.tutorialStep ?? 0);
  const step = $derived(TUTORIAL_STEPS[index]);
  const last = $derived(nextTutorialStep(index) === null);
  const vehicles = $derived([...app.reference.vehicles].filter((v) => v.scu > 0).sort((a, b) => a.name.localeCompare(b.name)));
  let error = $state<string | null>(null);

  $effect(() => {
    const target = step.target === null ? null : document.querySelector(`[data-tour="${step.target}"]`);
    target?.classList.add('sc-tour-target');
    return () => target?.classList.remove('sc-tour-target');
  });

  async function chooseVehicle(value: string): Promise<void> {
    const vehicle = app.reference.vehicles.find((v) => v.id === Number(value));
    if (vehicle === undefined) return;
    error = (await app.updateSetting('vehicleId', vehicle.id)) ?? (await app.updateSetting('scuCapacity', vehicle.scu));
  }

  async function typeCapacity(value: string): Promise<void> {
    const scu = Number(value);
    error = await app.updateSetting('scuCapacity', Number.isInteger(scu) ? scu : Number.NaN);
  }
</script>

<section class="tour sc-reveal" aria-labelledby="tour-title">
  <div class="head">
    <strong id="tour-title" class="title">{step.title()}</strong>
    <span class="count sc-label">{tutorialCounter(index)}</span>
  </div>
  <p class="text">{step.text()}</p>
  {#if step.id === 'ship'}
    <div class="ship">
      {#if vehicles.length > 0}
        <select class="sc-input" aria-label={tr('Корабль')} value={app.settings.vehicleId ?? ''} onchange={(event) => void chooseVehicle(event.currentTarget.value)}>
          <option value="">{tr('не выбран')}</option>
          {#each vehicles as vehicle (vehicle.id)}
            <option value={vehicle.id}>{vehicle.name} · {vehicle.scu} SCU</option>
          {/each}
        </select>
      {:else}
        <span class="wait">{tr('Список кораблей ещё не загружен — впиши вместимость трюма:')}</span>
        <input
          class="sc-input scu"
          type="text"
          inputmode="numeric"
          aria-label={tr('Вместимость, SCU')}
          value={app.settings.scuCapacity > 0 ? String(app.settings.scuCapacity) : ''}
          data-select-on-focus
          onchange={(event) => void typeCapacity(event.currentTarget.value)}
        />
      {/if}
      {#if app.settings.scuCapacity > 0}<span class="sc-num got">{app.settings.scuCapacity} SCU</span>{/if}
    </div>
    {#if error !== null}<p class="error" role="alert">{error}</p>{/if}
  {/if}
  <div class="actions">
    <button type="button" class="sc-btn sc-btn--ghost" onclick={() => void app.endTutorial('skipped')}>{tr('Пропустить')}</button>
    <button type="button" class="sc-btn sc-btn--primary" onclick={() => (last ? void app.endTutorial('done') : app.nextTutorialStep())}>
      {last ? tr('Готово') : tr('Далее')}
    </button>
  </div>
</section>

<style>
  .tour {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 6px;
    margin: 6px var(--sc-pad-x);
    padding: 8px 10px;
    border: 1px solid var(--sc-accent);
    background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sc-gap);
  }

  .title {
    color: var(--sc-text);
  }

  .count {
    flex: none;
  }

  .text {
    margin: 0;
    color: var(--sc-text);
  }

  .ship {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sc-gap);
  }

  .ship select {
    flex: 1;
    min-width: 0;
  }

  .scu {
    width: 80px;
    text-align: right;
  }

  .wait {
    color: var(--sc-muted);
  }

  .got {
    color: var(--sc-muted);
  }

  .error {
    margin: 0;
    color: var(--sc-bad);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sc-gap);
  }
</style>
