<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Settings } from '../core/settings';
  import type { TriggerName } from '../platform/triggers';
  import Icon from './components/Icon.svelte';
  import Section from './components/Section.svelte';
  import { app } from './state.svelte';
  import { headerModel } from './vm/header';
  import { parseNumberText } from './vm/settings-validation';
  import WindowGrip from './WindowGrip.svelte';

  type NumberKey =
    | 'scuCapacity' | 'budget' | 'hotMin' | 'warmMin' | 'coolingMin' | 'quantumSpeedKkms'
    | 'overheadMin' | 'overheadEmptyMin' | 'topN' | 'refillFullMin' | 'roiHighlightPct' | 'panelWidth' | 'idleCollapseSec';
  type TriggerKey = 'hotkeyPanel' | 'hotkeyDepart' | 'hotkeyArrive';

  const TRIGGERS: ReadonlyArray<{ key: TriggerKey; name: TriggerName; label: string }> = [
    { key: 'hotkeyPanel', name: 'panel', label: 'Развернуть и свернуть окно' },
    { key: 'hotkeyDepart', name: 'depart', label: 'Отметка «Взлетел»' },
    { key: 'hotkeyArrive', name: 'arrive', label: 'Отметка «Прилетел»' },
  ];

  const CORNERS: ReadonlyArray<{ id: Settings['stripCorner']; label: string }> = [
    { id: 'top-left', label: 'Сверху слева' },
    { id: 'top-right', label: 'Сверху справа' },
    { id: 'bottom-left', label: 'Снизу слева' },
    { id: 'bottom-right', label: 'Снизу справа' },
  ];

  const LOG_LEVELS: ReadonlyArray<Settings['logLevel']> = ['debug', 'info', 'warn', 'error'];

  // What the player has typed and not saved yet, and why a value was not saved, by setting.
  let drafts = $state<Record<string, string>>({});
  let errors = $state<Record<string, string | null>>({});

  const vehicles = $derived([...app.reference.vehicles].sort((a, b) => a.name.localeCompare(b.name)));
  // Systems the game runs; the chosen one stays in the list even if UEX dropped it.
  const systems = $derived(
    app.reference.starSystems.filter((s) => s.isAvailableLive || s.id === app.settings.starSystemId),
  );

  const saved = (key: NumberKey): string => {
    const value = app.settings[key];
    return value === null ? '' : String(value);
  };

  /** Settles a field: the saved value (or the error) replaces what was typed. */
  async function settle(key: string, save: () => Promise<string | null>): Promise<void> {
    const error = await save();
    errors[key] = error;
    if (error === null) delete drafts[key];
  }

  async function commitNumber(key: NumberKey): Promise<void> {
    const text = drafts[key];
    if (text === undefined) return;
    // an empty budget means "no budget"; an empty text anywhere else is not a number
    const value = key === 'budget' && text.trim() === '' ? null : parseNumberText(text);
    await settle(key, () => app.updateSetting(key, value));
  }

  async function commitTrigger(key: TriggerKey): Promise<void> {
    const text = drafts[key];
    if (text === undefined) return;
    await settle(key, () => app.updateSetting(key, text.trim()));
  }

  async function chooseVehicle(value: string): Promise<void> {
    const id = value === '' ? null : Number(value);
    await settle('vehicleId', () => app.updateSetting('vehicleId', id));
    const vehicle = id === null ? undefined : app.reference.vehicles.find((v) => v.id === id);
    // the SCU of the ship is a starting point: the field stays editable
    if (vehicle !== undefined && vehicle.scu > 0) {
      await settle('scuCapacity', () => app.updateSetting('scuCapacity', vehicle.scu));
    }
  }

  async function chooseSystem(value: string): Promise<void> {
    await settle('starSystemId', () => app.updateSetting('starSystemId', value === '' ? null : Number(value)));
  }

  const typed = (key: string, event: Event): void => {
    drafts[key] = (event.currentTarget as HTMLInputElement).value;
  };

  // What a closed group says about itself, so that a group need not be opened to read its main numbers.
  const s = $derived(app.settings);
  const summaries = $derived({
    ship: headerModel(app.reference, s, app.pricesSyncedAt, app.uexOk, app.now).ship,
    fresh: `${s.hotMin} / ${s.warmMin} / ${s.coolingMin} мин`,
    routes: `вариантов: ${s.topN} · ROI от ${s.roiHighlightPct}%`,
    keys: [s.hotkeyPanel, s.hotkeyDepart, s.hotkeyArrive].filter((key) => key !== '').join(', ') || 'не назначены',
    window: `${s.panelWidth} px · ${Math.round(s.opacity * 100)}%`,
    data: `журнал: ${s.logLevel}`,
  });
</script>

{#snippet numberField(key: NumberKey, label: string, options: { placeholder?: string; title?: string } = {})}
  <div class="row" title={options.title}>
    <label for="set-{key}">{label}</label>
    <input
      id="set-{key}"
      class="sc-input sc-num field"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      placeholder={options.placeholder}
      value={drafts[key] ?? saved(key)}
      aria-invalid={errors[key] ? 'true' : undefined}
      oninput={(event) => typed(key, event)}
      onchange={() => commitNumber(key)}
    />
  </div>
  {#if errors[key]}<p class="error" role="alert">{errors[key]}</p>{/if}
{/snippet}

{#snippet group(id: string, title: string, summary: string, body: Snippet)}
  <Section {title} {summary} open={app.sectionOpen(id)} onToggle={() => void app.toggleSection(id)}>
    {@render body()}
  </Section>
{/snippet}

{#snippet ship()}
  {#if vehicles.length > 0}
    <div class="row">
      <label for="set-vehicle">Корабль</label>
      <select id="set-vehicle" class="sc-input field" value={app.settings.vehicleId ?? ''} onchange={(event) => chooseVehicle(event.currentTarget.value)}>
        <option value="">не выбран</option>
        {#each vehicles as vehicle (vehicle.id)}
          <option value={vehicle.id}>{vehicle.name}{vehicle.scu > 0 ? ` · ${vehicle.scu} SCU` : ''}</option>
        {/each}
      </select>
    </div>
  {:else}
    <p class="line">Список кораблей не загружен: введи вместимость вручную.</p>
  {/if}
  {@render numberField('scuCapacity', 'Вместимость, SCU')}
  <div class="row">
    <label for="set-system">Система</label>
    <select id="set-system" class="sc-input field" value={app.settings.starSystemId ?? ''} onchange={(event) => chooseSystem(event.currentTarget.value)}>
      <option value="">Все системы</option>
      {#each systems as system (system.id)}
        <option value={system.id}>{system.name}</option>
      {/each}
    </select>
  </div>
  {@render numberField('budget', 'Бюджет, UEC', { placeholder: 'не ограничен' })}
{/snippet}

{#snippet fresh()}
  {@render numberField('hotMin', 'Горячая до, мин')}
  {@render numberField('warmMin', 'Тёплая до, мин')}
  {@render numberField('coolingMin', 'Остывает до, мин', { title: 'Дальше своя цена считается холодной' })}
{/snippet}

{#snippet routes()}
  {@render numberField('quantumSpeedKkms', 'Скорость квантума, тыс. км/с')}
  {@render numberField('overheadMin', 'Накладные на рейс, мин')}
  {@render numberField('overheadEmptyMin', 'Накладные на пустой перелёт, мин')}
  {@render numberField('topN', 'Число вариантов')}
  {@render numberField('refillFullMin', 'Полное пополнение склада, мин')}
  {@render numberField('roiHighlightPct', 'Выделять ROI от, %', {
    title: 'Строка таблицы с таким ROI и выше выделяется цветной полосой. 0 — выделять всё, что в плюсе.',
  })}
{/snippet}

{#snippet keys()}
  {#each TRIGGERS as trigger (trigger.key)}
    {@const error = errors[trigger.key] ?? app.triggerErrors[trigger.name]}
    <div class="row" title="Например F8 или Ctrl+Alt+T. Пустое поле: клавиша не назначена, окно разворачивается кликом по мини-строке.">
      <label for="set-{trigger.key}">{trigger.label}</label>
      <input
        id="set-{trigger.key}"
        class="sc-input field"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder="не назначена"
        value={drafts[trigger.key] ?? app.settings[trigger.key]}
        aria-invalid={error ? 'true' : undefined}
        oninput={(event) => typed(trigger.key, event)}
        onchange={() => commitTrigger(trigger.key)}
      />
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/each}
{/snippet}

{#snippet windowGroup()}
  <div class="row">
    <label for="set-corner">Угол экрана</label>
    <select
      id="set-corner"
      class="sc-input field"
      value={app.settings.stripCorner}
      onchange={(event) => settle('stripCorner', () => app.setCorner(event.currentTarget.value as Settings['stripCorner']))}
    >
      {#each CORNERS as corner (corner.id)}
        <option value={corner.id}>{corner.label}</option>
      {/each}
    </select>
  </div>
  {@render numberField('panelWidth', 'Ширина окна, px (380–640)')}
  {@render numberField('idleCollapseSec', 'Сворачивать через, с', {
    placeholder: '0 — не сворачивать',
    title: 'Окно само сворачивается в мини-строку, когда курсор ушёл с него и прошло это время. 0 — не сворачивать.',
  })}
  <div class="row">
    <label for="set-opacity">Прозрачность</label>
    <span class="slider">
      <input
        id="set-opacity"
        type="range"
        min="0.5"
        max="1"
        step="0.05"
        value={app.settings.opacity}
        onchange={(event) => settle('opacity', () => app.updateSetting('opacity', Number(event.currentTarget.value)))}
      />
      <span class="percent sc-num">{Math.round(app.settings.opacity * 100)}%</span>
    </span>
  </div>
  {#if errors.opacity}<p class="error" role="alert">{errors.opacity}</p>{/if}
  <div class="row" title="Без мини-строки свёрнутое окно скрыто: оно открывается через значок в трее или назначенную клавишу.">
    <label for="set-show-strip">Показывать мини-строку</label>
    <input
      id="set-show-strip"
      class="check"
      type="checkbox"
      checked={app.settings.showStrip}
      onchange={(event) => settle('showStrip', () => app.updateSetting('showStrip', event.currentTarget.checked))}
    />
  </div>
{/snippet}

{#snippet data()}
  <div class="row">
    <label for="set-log-level">Уровень журнала</label>
    <select
      id="set-log-level"
      class="sc-input field"
      value={app.settings.logLevel}
      onchange={(event) => settle('logLevel', () => app.updateSetting('logLevel', event.currentTarget.value as Settings['logLevel']))}
    >
      {#each LOG_LEVELS as level (level)}
        <option value={level}>{level}</option>
      {/each}
    </select>
  </div>
  <div class="buttons">
    <button class="sc-btn" type="button" onclick={() => app.openLogs()}>Открыть папку логов</button>
    <button class="sc-btn" type="button" disabled={app.referenceBusy} onclick={() => app.refreshReference()}>
      {app.referenceBusy ? 'Обновление…' : 'Обновить справочник'}
    </button>
    <button class="sc-btn quit" type="button" onclick={() => app.quit()}>Выход</button>
  </div>
{/snippet}

<header class="bar">
  <WindowGrip />
  <button class="sc-btn sc-btn--ghost sc-btn--icon back" type="button" aria-label="Назад" title="Назад" onclick={() => app.closeSettings()}>
    <Icon name="back" />
  </button>
  <strong class="title">Настройки</strong>
  <button class="sc-btn sc-btn--ghost sc-btn--icon collapse" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
    <Icon name="minus" />
  </button>
</header>

<!-- the header stands still; when the groups are taller than the window allows, this area scrolls -->
<div class="groups">
  {@render group('settings:ship', 'Корабль и поиск', summaries.ship, ship)}
  {@render group('settings:fresh', 'Свежесть цен', summaries.fresh, fresh)}
  {@render group('settings:routes', 'Расчёт маршрутов', summaries.routes, routes)}
  {@render group('settings:keys', 'Клавиши', summaries.keys, keys)}
  {@render group('settings:window', 'Окно', summaries.window, windowGroup)}
  {@render group('settings:data', 'Данные', summaries.data, data)}
</div>

<style>
  .bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    height: var(--sc-bar-h);
    padding-right: 3px;
    border-bottom: 1px solid var(--sc-border);
  }

  .bar .sc-btn {
    color: var(--sc-label);
  }

  .bar .sc-btn:hover {
    color: var(--sc-accent);
  }

  .title {
    flex: 1;
  }

  .groups {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  /* one line: the label, and the field at the right */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sc-gap);
    height: calc(var(--sc-ctl-h) + 4px);
    padding: 0 var(--sc-pad-x);
    border-bottom: 1px solid var(--sc-surface-2);
  }

  .row > label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .field {
    flex: none;
    width: var(--sc-field-w);
  }

  .slider {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--sc-gap);
    width: var(--sc-field-w);
  }

  .slider input {
    flex: 1;
    min-width: 0;
    height: var(--sc-ctl-h);
    margin: 0;
    accent-color: var(--sc-accent);
  }

  .percent {
    flex: none;
    width: 32px;
  }

  .check {
    flex: none;
    width: 14px;
    height: 14px;
    margin: 0 4px;
    accent-color: var(--sc-accent);
  }

  .error,
  .line {
    margin: 0;
    padding: 2px var(--sc-pad-x);
    font-size: var(--sc-font-sm);
  }

  .error {
    color: var(--sc-bad);
  }

  .line {
    color: var(--sc-muted);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px var(--sc-pad-x);
  }

  .quit {
    margin-left: auto;
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }
</style>
