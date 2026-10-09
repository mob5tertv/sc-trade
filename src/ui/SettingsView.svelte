<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import type { Settings } from '../core/settings';
  import type { TriggerName } from '../platform/triggers';
  import Icon from './components/Icon.svelte';
  import Section from './components/Section.svelte';
  import KeyboardBadge from './KeyboardBadge.svelte';
  import MessageLines from './MessageLines.svelte';
  import { app } from './state.svelte';
  import { stats } from './stats.svelte';
  import { headerModel } from './vm/header';
  import { CLEAR_BUTTONS, historyStatus } from './vm/history-clearing';
  import { captureKey } from './vm/key-capture';
  import { SETTING_HINTS } from './vm/settings-hints';
  import { triggerSuspension } from './vm/trigger-suspension';
  import { parseNumberText } from './vm/settings-validation';
  import { UI_SCALES, uiScaleChoice, uiScaleHint, uiScaleLabel } from './vm/ui-scale';
  import WindowGrip from './WindowGrip.svelte';

  type NumberKey =
    | 'scuCapacity' | 'budget' | 'hotMin' | 'warmMin' | 'coolingMin' | 'quantumSpeedKkms'
    | 'overheadMin' | 'overheadEmptyMin' | 'topN' | 'refillFullMin' | 'roiHighlightPct' | 'panelWidth' | 'idleCollapseSec';
  type TriggerKey = 'hotkeyPanel' | 'hotkeyDepart' | 'hotkeyArrive';

  // What the field says in its tooltip: how it is filled, what the key does, and that the press still reaches the game (the hook that
  // catches the keys never swallows one).
  const HOW_TO_FILL = 'Нажми клавишу в этом поле — она запишется. Подходят F1–F24, кроме F5, F11 и F12, ScrollLock, Pause, Insert, Home, End, PageUp, PageDown и буква или цифра с Ctrl или Alt; Backspace или Delete снимают клавишу. Пока курсор в поле, назначенные клавиши не срабатывают.';
  const TRIGGERS: ReadonlyArray<{ key: TriggerKey; name: TriggerName; label: string; title: string }> = [
    {
      key: 'hotkeyPanel', name: 'panel', label: 'Развернуть и свернуть окно',
      title: `${HOW_TO_FILL} Например F8 или Ctrl+Alt+T. Клавиша разворачивает и сворачивает окно, игра её тоже получает. Без клавиши окно разворачивается кликом по мини-строке.`,
    },
    {
      key: 'hotkeyDepart', name: 'depart', label: 'Отметка «Взлетел»',
      title: `${HOW_TO_FILL} Клавиша ставит в идущем рейсе отметку «Взлетел», как одноимённая кнопка; игра её тоже получает.`,
    },
    {
      key: 'hotkeyArrive', name: 'arrive', label: 'Отметка «Прилетел»',
      title: `${HOW_TO_FILL} Клавиша ставит в идущем рейсе отметку «Прилетел», как одноимённая кнопка (с целью окно покажет её терминал); игра её тоже получает.`,
    },
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

  /**
   * Settles a field: the saved value (or the error) replaces what was typed. Only what was typed when the saving began: a text typed
   * meanwhile (a second key pressed at once) is the next change's and stays until that one has settled.
   */
  async function settle(key: string, save: () => Promise<string | null>): Promise<void> {
    const typedThen = drafts[key];
    const error = await save();
    errors[key] = error;
    if (error === null && drafts[key] === typedThen) delete drafts[key];
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

  // The assigned keys are global: pressing one in a key field would fire its action. So they are suspended while a key field has the
  // focus (from one key field to the next they stay so) and applied again when it has gone. A field that goes away with the screen (the
  // settings closed, the window folded) gives no blur: the screen lets go of the keys when it is destroyed. The focus of the window
  // itself leaving gives a blur, as Esc and Tab do.
  const suspension = triggerSuspension({ suspend: () => void app.suspendTriggers(), resume: () => void app.resumeTriggers() });
  onDestroy(() => suspension.release());
  // The window itself losing the focus (the player went to the game) is the same: the field is left, and a field that still is the
  // active element of a window that came back is a key field in hand again.
  onMount(() => {
    const left = (): void => suspension.blur();
    const back = (): void => {
      if (document.activeElement instanceof HTMLElement && document.activeElement.dataset.triggerKey !== undefined) suspension.focus();
    };
    window.addEventListener('blur', left);
    window.addEventListener('focus', back);
    return () => {
      window.removeEventListener('blur', left);
      window.removeEventListener('focus', back);
    };
  });

  // What a key field says for a moment about a key it did not write, by field.
  const HINT_MS = 5000;
  let hints = $state<Record<string, string | null>>({});
  const hintTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function say(key: string, text: string | null): void {
    clearTimeout(hintTimers[key]);
    hints[key] = text;
    if (text !== null) hintTimers[key] = setTimeout(() => (hints[key] = null), HINT_MS);
  }
  onDestroy(() => Object.values(hintTimers).forEach(clearTimeout));

  /**
   * A key field takes the key that is pressed in it (`captureKey`) and saves it as an ordinary change of the field. It writes only
   * a key that can be assigned: a key that cannot is not written, the saved one stays, and the field says why for a moment. What the
   * field does not take (Enter, Esc, Tab, a modifier alone, Alt+F4) it neither writes nor stops: Enter does what it does in the other
   * fields, Esc still gives the keyboard back to the game and Tab still goes on. A held key repeats the press: one press, one assignment.
   */
  function captureTrigger(event: KeyboardEvent, key: TriggerKey): void {
    const taken = captureKey(event);
    if (taken.kind === 'pass') return;
    event.preventDefault();
    if (event.repeat) return;
    if (taken.kind === 'refuse') {
      say(key, taken.reason);
      return;
    }
    say(key, null);
    drafts[key] = taken.kind === 'clear' ? '' : taken.text;
    void commitTrigger(key);
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
    window: `${uiScaleLabel(s.uiScale, app.scaleMonitor)} · ${s.panelWidth} px · ${Math.round(s.opacity * 100)}%`,
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
  {@render numberField('scuCapacity', 'Вместимость, SCU', { title: SETTING_HINTS.scuCapacity })}
  <div class="row">
    <label for="set-system">Система</label>
    <select id="set-system" class="sc-input field" value={app.settings.starSystemId ?? ''} onchange={(event) => chooseSystem(event.currentTarget.value)}>
      <option value="">Все системы</option>
      {#each systems as system (system.id)}
        <option value={system.id}>{system.name}</option>
      {/each}
    </select>
  </div>
  {@render numberField('budget', 'Бюджет, UEC', { placeholder: 'не ограничен', title: SETTING_HINTS.budget })}
{/snippet}

{#snippet fresh()}
  {@render numberField('hotMin', 'Горячая до, мин')}
  {@render numberField('warmMin', 'Тёплая до, мин')}
  {@render numberField('coolingMin', 'Остывает до, мин', { title: 'Дальше своя цена считается холодной' })}
{/snippet}

{#snippet routes()}
  {@render numberField('quantumSpeedKkms', 'Скорость квантума, тыс. км/с', { title: SETTING_HINTS.quantumSpeedKkms })}
  {@render numberField('overheadMin', 'Накладные на рейс, мин', { title: SETTING_HINTS.overheadMin })}
  {@render numberField('overheadEmptyMin', 'Накладные на пустой перелёт, мин', { title: SETTING_HINTS.overheadEmptyMin })}
  {@render numberField('topN', 'Число вариантов', { title: SETTING_HINTS.topN })}
  {@render numberField('refillFullMin', 'Полное пополнение склада, мин', { title: SETTING_HINTS.refillFullMin })}
  {@render numberField('roiHighlightPct', 'Выделять ROI от, %', {
    title: 'Строка таблицы с таким ROI и выше выделяется цветной полосой. 0 — выделять всё, что в плюсе.',
  })}
{/snippet}

{#snippet keys()}
  {#each TRIGGERS as trigger (trigger.key)}
    {@const error = errors[trigger.key] ?? app.triggerErrors[trigger.name]}
    <div class="row" title={trigger.title}>
      <label for="set-{trigger.key}">{trigger.label}</label>
      <input
        id="set-{trigger.key}"
        class="sc-input field"
        type="text"
        autocomplete="off"
        spellcheck="false"
        data-trigger-key
        placeholder="нажми клавишу"
        value={drafts[trigger.key] ?? app.settings[trigger.key]}
        aria-invalid={error ? 'true' : undefined}
        onfocus={() => suspension.focus()}
        onblur={() => suspension.blur()}
        onkeydown={(event) => captureTrigger(event, trigger.key)}
        oninput={(event) => typed(trigger.key, event)}
        onchange={() => commitTrigger(trigger.key)}
      />
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if hints[trigger.key]}<p class="line note" role="status">{hints[trigger.key]}</p>{/if}
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
  <div class="row" title={uiScaleHint(app.settings.uiScale, app.scaleMonitor)}>
    <label for="set-ui-scale">Масштаб</label>
    <select
      id="set-ui-scale"
      class="sc-input field"
      value={uiScaleChoice(app.settings.uiScale)}
      onchange={(event) => settle('uiScale', () => app.updateSetting('uiScale', Number(event.currentTarget.value)))}
    >
      {#each UI_SCALES as value (value)}
        <option {value}>{uiScaleLabel(value, app.scaleMonitor)}</option>
      {/each}
    </select>
  </div>
  {#if errors.uiScale}<p class="error" role="alert">{errors.uiScale}</p>{/if}
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
  <!-- the history of the runs (spec 14.14): how many, since when, and what can be cleared; each button asks first, under the header -->
  {@const history = stats.historyCounts}
  <p class="line" data-history>{historyStatus(history)}</p>
  {#if history.finished > 0}
    <div class="buttons">
      {#if history.old > 0}
        <button class="sc-btn" type="button" data-clear="old" title={CLEAR_BUTTONS.old.title} onclick={() => app.askClearHistory('old')}>{CLEAR_BUTTONS.old.label}</button>
      {/if}
      <button class="sc-btn wipe" type="button" data-clear="all" title={CLEAR_BUTTONS.all.title} onclick={() => app.askClearHistory('all')}>{CLEAR_BUTTONS.all.label}</button>
    </div>
  {/if}
  <div class="buttons">
    <button class="sc-btn" type="button" onclick={() => app.openLogs()}>Открыть папку логов</button>
    <button class="sc-btn" type="button" disabled={app.referenceBusy} onclick={() => app.refreshReference()}>
      {app.referenceBusy ? 'Обновление…' : 'Обновить справочник'}
    </button>
  </div>
  <!-- leaving stands apart, in a row of its own at the right: with a run going it asks first (the question is under the header) -->
  <div class="buttons leave">
    <button class="sc-btn quit" type="button" title="Закрыть программу. Идущий рейс сохранится" onclick={() => app.askQuit()}>Выход</button>
  </div>
{/snippet}

<header class="bar">
  <WindowGrip />
  <button class="sc-btn sc-btn--ghost sc-btn--icon back" type="button" aria-label="Назад" title="Назад" onclick={() => app.closeSettings()}>
    <Icon name="back" />
  </button>
  <strong class="title">Настройки</strong>
  <KeyboardBadge />
  <button class="sc-btn sc-btn--ghost sc-btn--icon collapse" type="button" aria-label="Свернуть" title="Свернуть" onclick={() => app.collapse('close button')}>
    <Icon name="minus" />
  </button>
</header>

<!-- the question of a button (the clearing of the history) and the message after it, under the header that stands still -->
<MessageLines />

<!-- the header stands still; when the groups are taller than the window allows, this area scrolls -->
<!-- `data-saves-on-leave`: every field in here is saved at Enter and when it is left; the keyboard rules read it (ui/keyboard.ts) -->
<div class="groups" data-saves-on-leave>
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

  /* a key the field did not write: not an error of the field (the key that was saved is fine), so the colour of a warning */
  .line.note {
    color: var(--sc-warn);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px var(--sc-pad-x);
  }

  /* the row of the leaving button: the button at the right, apart from the others */
  .leave {
    justify-content: flex-end;
  }

  .quit {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }

  /* the button that deletes the whole history looks like the other one that ends something */
  .wipe {
    border-color: var(--sc-bad);
    color: var(--sc-bad);
  }
</style>
