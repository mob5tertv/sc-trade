<script lang="ts">
  import type { Settings } from '../../core/settings';
  import type { TriggerName } from '../../platform/triggers';
  import { app } from '../state.svelte';
  import { parseNumberText } from '../vm/settings-validation';

  type NumberKey =
    | 'scuCapacity' | 'budget' | 'hotMin' | 'warmMin' | 'coolingMin' | 'quantumSpeedKkms'
    | 'overheadMin' | 'overheadEmptyMin' | 'topN' | 'refillFullMin' | 'panelWidth' | 'idleCollapseSec';
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
</script>

{#snippet numberField(key: NumberKey, label: string, options: { placeholder?: string } = {})}
  <div class="row">
    <label for="set-{key}">{label}</label>
    <div class="control">
      <input
        id="set-{key}"
        class="sc-input sc-num"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder={options.placeholder}
        value={drafts[key] ?? saved(key)}
        aria-invalid={errors[key] ? 'true' : undefined}
        oninput={(event) => typed(key, event)}
        onchange={() => commitNumber(key)}
      />
      {#if errors[key]}<small class="error">{errors[key]}</small>{/if}
    </div>
  </div>
{/snippet}

<div class="settings">
  <h3>Корабль и поиск</h3>
  {#if vehicles.length > 0}
    <div class="row">
      <label for="set-vehicle">Корабль</label>
      <div class="control">
        <select
          id="set-vehicle"
          class="sc-input"
          value={app.settings.vehicleId ?? ''}
          onchange={(event) => chooseVehicle(event.currentTarget.value)}
        >
          <option value="">не выбран</option>
          {#each vehicles as vehicle (vehicle.id)}
            <option value={vehicle.id}>{vehicle.name}{vehicle.scu > 0 ? ` · ${vehicle.scu} SCU` : ''}</option>
          {/each}
        </select>
      </div>
    </div>
  {:else}
    <p class="hint">Список кораблей не загружен. Введите вместимость вручную.</p>
  {/if}
  {@render numberField('scuCapacity', 'Вместимость, SCU')}
  <div class="row">
    <label for="set-system">Система</label>
    <div class="control">
      <select id="set-system" class="sc-input" value={app.settings.starSystemId ?? ''} onchange={(event) => chooseSystem(event.currentTarget.value)}>
        <option value="">Все системы</option>
        {#each systems as system (system.id)}
          <option value={system.id}>{system.name}</option>
        {/each}
      </select>
    </div>
  </div>
  {@render numberField('budget', 'Бюджет, UEC', { placeholder: 'не ограничен' })}

  <h3>Температура цен, минуты</h3>
  {@render numberField('hotMin', 'Горячая до')}
  {@render numberField('warmMin', 'Тёплая до')}
  {@render numberField('coolingMin', 'Остывает до')}
  <p class="hint">Дальше своя цена считается холодной.</p>

  <h3>Расчёт маршрутов</h3>
  {@render numberField('quantumSpeedKkms', 'Скорость квантума, тыс. км/с')}
  {@render numberField('overheadMin', 'Накладные на рейс, мин')}
  {@render numberField('overheadEmptyMin', 'Накладные на пустой перелёт, мин')}
  {@render numberField('topN', 'Число подсказок')}
  {@render numberField('refillFullMin', 'Полное пополнение склада, мин')}

  <h3>Клавиши (необязательно)</h3>
  {#each TRIGGERS as trigger (trigger.key)}
    {@const error = errors[trigger.key] ?? app.triggerErrors[trigger.name]}
    <div class="row">
      <label for="set-{trigger.key}">{trigger.label}</label>
      <div class="control">
        <input
          id="set-{trigger.key}"
          class="sc-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="не назначена"
          value={drafts[trigger.key] ?? app.settings[trigger.key]}
          aria-invalid={error ? 'true' : undefined}
          oninput={(event) => typed(trigger.key, event)}
          onchange={() => commitTrigger(trigger.key)}
        />
        {#if error}<small class="error">{error}</small>{/if}
      </div>
    </div>
  {/each}
  <p class="hint">Например F8 или Ctrl+Alt+T. Пустое поле: клавиша не назначена, окно разворачивается кликом по мини-строке.</p>

  <h3>Окно</h3>
  <div class="row">
    <label for="set-corner">Угол экрана</label>
    <div class="control">
      <select
        id="set-corner"
        class="sc-input"
        value={app.settings.stripCorner}
        onchange={(event) => settle('stripCorner', () => app.setCorner(event.currentTarget.value as Settings['stripCorner']))}
      >
        {#each CORNERS as corner (corner.id)}
          <option value={corner.id}>{corner.label}</option>
        {/each}
      </select>
    </div>
  </div>
  {@render numberField('panelWidth', 'Ширина окна, px (380–640)')}
  {@render numberField('idleCollapseSec', 'Сворачивать через, с', { placeholder: '0 — не сворачивать' })}
  <p class="hint">Окно само сворачивается в мини-строку, когда курсор ушёл с него и прошло это время. 0 — не сворачивать.</p>
  <div class="row">
    <label for="set-opacity">Прозрачность: {Math.round(app.settings.opacity * 100)}%</label>
    <div class="control">
      <input
        id="set-opacity"
        type="range"
        min="0.3"
        max="1"
        step="0.05"
        value={app.settings.opacity}
        onchange={(event) => settle('opacity', () => app.updateSetting('opacity', Number(event.currentTarget.value)))}
      />
    </div>
  </div>
  <div class="row">
    <label for="set-show-strip">Показывать мини-строку</label>
    <div class="control">
      <input
        id="set-show-strip"
        type="checkbox"
        checked={app.settings.showStrip}
        onchange={(event) => settle('showStrip', () => app.updateSetting('showStrip', event.currentTarget.checked))}
      />
    </div>
  </div>
  {#if !app.settings.showStrip}
    <p class="hint">Без мини-строки свёрнутое окно скрыто: оно открывается через значок в трее или назначенную клавишу.</p>
  {/if}

  <h3>Журнал</h3>
  <div class="row">
    <label for="set-log-level">Уровень журнала</label>
    <div class="control">
      <select
        id="set-log-level"
        class="sc-input"
        value={app.settings.logLevel}
        onchange={(event) => settle('logLevel', () => app.updateSetting('logLevel', event.currentTarget.value as Settings['logLevel']))}
      >
        {#each LOG_LEVELS as level (level)}
          <option value={level}>{level}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="buttons">
    <button class="sc-btn" type="button" onclick={() => app.openLogs()}>Открыть папку логов</button>
    <button class="sc-btn" type="button" disabled={app.referenceBusy} onclick={() => app.refreshReference()}>
      {app.referenceBusy ? 'Обновление…' : 'Обновить справочник'}
    </button>
    <button class="sc-btn quit" type="button" onclick={() => app.quit()}>Выход</button>
  </div>
</div>

<style>
  .settings {
    padding: 0 calc(var(--sc-gap) * 1.5) calc(var(--sc-gap) * 2);
  }

  h3 {
    margin: calc(var(--sc-gap) * 2) 0 var(--sc-gap);
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 170px;
    align-items: start;
    gap: var(--sc-gap);
    min-height: 32px;
    padding: 2px 0;
  }

  .row > label {
    padding-top: 5px;
  }

  .control {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .control input[type='range'] {
    width: 100%;
    height: 28px;
    margin: 0;
    accent-color: var(--sc-accent);
  }

  .control input[type='checkbox'] {
    width: 16px;
    height: 16px;
    margin: 6px 0 0;
    accent-color: var(--sc-accent);
  }

  .error {
    color: var(--sc-bad);
    font-size: var(--sc-font-sm);
  }

  .hint {
    margin: 2px 0;
    color: var(--sc-muted);
    font-size: var(--sc-font-sm);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sc-gap);
    margin-top: calc(var(--sc-gap) * 2);
  }

  .quit {
    margin-left: auto;
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }
</style>
