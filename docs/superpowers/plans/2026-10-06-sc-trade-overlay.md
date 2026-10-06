# SC Trade Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оверлей для Star Citizen: дневник своих цен, подсказки маршрутов с ROI и UEC/час, таймер рейсов и статистика.

**Architecture:** Tauri 2. Rust — тонкая оболочка (окно, трей, фокус, логи, резервная копия). Вся логика на TypeScript: `core` — чистые функции, `data` — SQLite и UEX, `platform` — обёртки Tauri, `ui` — Svelte 5. Свои наблюдения дописываются в дневник и имеют приоритет над кэшем UEX, пока не остыли.

**Tech Stack:** Tauri 2, Rust, TypeScript, Svelte 5, Vite, SQLite (`tauri-plugin-sql`), `tauri-plugin-http`, `tauri-plugin-global-shortcut`, `tauri-plugin-log`, `tauri-plugin-os`, `tauri-plugin-opener`, vitest, `better-sqlite3`.

**Spec:** `docs/superpowers/specs/2026-10-06-sc-trade-overlay-design.md`

## Global Constraints

- Windows 10/11, игра в borderless. В процесс игры ничего не внедряется.
- `src/core` не импортирует ничего из `data`, `platform`, `ui` и ничего не логирует. Всё, что зависит от времени, принимает `now` параметром.
- Время везде — Unix-секунды. Активный рейс только один.
- Интерфейс на русском; названия товаров и локаций — как в UEX (английские).
- UEX: база `https://api.uexcorp.uk/2.0`, без токена, не больше 120 запросов в минуту, цены пачками по 10 терминалов. `commodities_prices_all` не используется.
- Значения по умолчанию: пороги температуры 60 / 180 / 240 мин; скорость квантума 200 тыс. км/с; накладные 12 мин, пустой перелёт 5 мин; подсказок 5; хоткеи `Ctrl+Alt+T`, `Ctrl+Alt+1`, `Ctrl+Alt+2`; панель 470 px справа; полоска 520×32.
- Справочник устаревает через 24 ч, цены — через 60 мин. Разрыв сессии — 2 ч. Резервных копий — 5.
- Логи: уровень по умолчанию `debug`, файл 5 МБ, хранится 5 файлов, медленный запрос — от 200 мс. Ошибка записи лога не ломает приложение.
- Предупреждение о цене: меньше `0.5 × min` или больше `2 × max` по истории UEX. Сохранение не блокируется.
- SQL: плейсхолдеры `?`, без явных транзакций (`tauri-plugin-sql` работает через пул соединений), миграции — по одному выражению на вызов.
- Каждое действие пользователя, запрос к UEX и запись в базу логируются (раздел 11 спеки).

## Review Focus

1. Своё наблюдение остыло, а строки UEX по этой паре нет — направление не должно исчезать: используется своя цена с пометкой «холодная». Тест в задаче 7.
2. UEX отдаёт числа строками (`"distance":"59"`) и `null` вместо нуля — клиент приводит типы, а не роняет синхронизацию. Тест в задаче 5.
3. Игрок продаёт больше, чем в трюме, или покупает больше свободного места — сделка отклоняется с понятной ошибкой, груз не уходит в минус. Тесты в задачах 13 и 14.
4. Рейс нулевой или отрицательной длительности (сделки в одну секунду, перевод часов) — без деления на ноль, UEC/час не показывается. Тест в задаче 13.
5. После патча терминал или товар исчез из справочника UEX, а в дневнике записи остались — подсказки и таблица точки пропускают такие записи без падения. Тесты в задачах 10 и 12.

---

## File Structure

```
src-tauri/src/lib.rs          сборка приложения: плагины, команды
src-tauri/src/logging.rs      плагин логов, set_log_level, перехват паник
src-tauri/src/focus.rs        remember_foreground / restore_foreground (Win32)
src-tauri/src/tray.rs         иконка в трее
src-tauri/src/backup.rs       копия файла базы, хранение пяти последних
src/core/types.ts             общие типы
src/core/settings.ts          тип Settings и значения по умолчанию
src/core/layout.ts            геометрия полоски и панели
src/core/temperature.ts       температура наблюдения
src/core/market.ts            сборка индекса цен
src/core/estimate.ts          оценка цены
src/core/routes.ts            объём, время, routesFrom, routesTo
src/core/sell.ts              sellOrContinue
src/core/run.ts               груз, итоги рейса, фазы
src/core/stats.ts             маршруты, медианы, сессии
src/core/search.ts            поиск по первым буквам
src/core/input.ts             разбор цены и SCU, проверка на опечатку
src/core/format.ts            формат чисел, возраста, длительности
src/data/logger.ts            интерфейс Logger, логгер в памяти
src/data/db.ts                интерфейс Db
src/data/migrations.ts        схема
src/data/slow-query.ts        обёртка Db с логом медленных запросов
src/data/uex-client.ts        клиент UEX
src/data/sync.ts              синхронизация справочника, цен, расстояний
src/data/suggest.ts           подсказки: рынок + расстояния + core + лог
src/data/trade.ts             сделки и отметки рейса
src/data/repo/settings.ts     настройки
src/data/repo/uex-cache.ts    кэш UEX
src/data/repo/diary.ts        наблюдения
src/data/repo/runs.ts         рейсы
src/platform/tauri-logger.ts  Logger поверх tauri-plugin-log
src/platform/crash.ts         перехват необработанных ошибок
src/platform/tauri-db.ts      Db поверх tauri-plugin-sql
src/platform/tauri-http.ts    FetchJson поверх tauri-plugin-http
src/platform/window.ts        переключение полоска/панель
src/platform/hotkeys.ts       глобальные хоткеи
src/ui/boot.ts                последовательность запуска
src/ui/state.svelte.ts        состояние приложения и действия
src/ui/vm/*.ts                чистые модели для компонентов
src/ui/*.svelte, src/ui/tabs/*.svelte, src/ui/components/*.svelte
tests/helpers/test-db.ts      Db на better-sqlite3
tests/fixtures/uex/*.json     сохранённые ответы UEX
tests/{core,data,ui}/*.test.ts
```

## Shared Types

Создаются в задачах 4, 5 и 7; здесь — единый источник имён.

```ts
// src/core/types.ts
export type Side = 'buy' | 'sell';
export type Temp = 'hot' | 'warm' | 'cooling' | 'cold';
export interface TempThresholds { hotMin: number; warmMin: number; coolingMin: number }

export interface StarSystem { id: number; name: string; code: string; isAvailableLive: boolean }
export interface Terminal {
  id: number; starSystemId: number; planetId: number; orbitId: number;
  name: string; nickname: string; displayname: string; code: string;
  starSystemName: string | null; planetName: string | null; orbitName: string | null;
  moonName: string | null; spaceStationName: string | null; outpostName: string | null; cityName: string | null;
  hasFreightElevator: boolean; hasLoadingDock: boolean; isAutoLoad: boolean; isAvailableLive: boolean;
}
export interface Commodity { id: number; name: string; code: string; isIllegal: boolean; isBuyable: boolean; isSellable: boolean; isAvailableLive: boolean }
export interface Vehicle { id: number; name: string; nameFull: string; scu: number }
export interface Reference { starSystems: StarSystem[]; terminals: Map<number, Terminal>; commodities: Map<number, Commodity>; vehicles: Vehicle[] }

export interface UexSideStats {
  last: number;
  minWeek: number; maxWeek: number; avgWeek: number;
  minMonth: number; maxMonth: number; avgMonth: number;
  min: number; max: number; avg: number;
}
export interface UexPrice { terminalId: number; commodityId: number; buy: UexSideStats; sell: UexSideStats; scuBuy: number; scuSell: number; dateModified: number }
export interface Observation { id: number; ts: number; terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }

export interface Market {
  uex: Map<string, UexPrice>;          // priceKey
  own: Map<string, Observation>;       // obsKey, только последнее наблюдение
  byTerminal: Map<number, Set<number>>;   // терминал → товары
  byCommodity: Map<number, Set<number>>;  // товар → терминалы
}
export const priceKey = (terminalId: number, commodityId: number) => `${terminalId}:${commodityId}`;
export const obsKey = (terminalId: number, commodityId: number, side: Side) => `${terminalId}:${commodityId}:${side}`;
export const distKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
export const pairKey = (originId: number, destId: number) => `${originId}>${destId}`;

export interface Estimate {
  price: number; low: number; high: number;
  source: 'own' | 'uex'; temp: Temp | null; ageSec: number;
  ownLast: { price: number; ageSec: number } | null;   // своё холодное, справочно
  uexRange: { low: number; high: number } | null;      // рядом с «остывает»
  scu: number | null;
}

export type RunEventType = 'buy' | 'sell' | 'depart' | 'arrive';
export interface Run { id: number; vehicleId: number | null; scuCapacity: number; startedAt: number; endedAt: number | null; status: 'active' | 'done' | 'lost' }
export interface RunEvent { id: number; runId: number; ts: number; type: RunEventType; terminalId: number | null; commodityId: number | null; scu: number | null; price: number | null }
export interface RunWithEvents { run: Run; events: RunEvent[] }
export interface CargoLine { commodityId: number; scu: number; avgBuyPrice: number }
```

```ts
// src/core/settings.ts
export interface Settings {
  vehicleId: number | null; scuCapacity: number; starSystemId: number | null; budget: number | null;
  hotMin: number; warmMin: number; coolingMin: number;
  quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number; topN: number;
  sort: 'uecPerHour' | 'roi'; nearby: boolean;
  hotkeyPanel: string; hotkeyDepart: string; hotkeyArrive: string;
  panelSide: 'left' | 'right'; panelWidth: number;
  stripCorner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  opacity: number; showStrip: boolean; logLevel: 'debug' | 'info' | 'warn' | 'error';
  serverChangedAt: number | null; currentTerminalId: number | null; targetTerminalId: number | null;
}
export const DEFAULT_SETTINGS: Settings = {
  vehicleId: null, scuCapacity: 0, starSystemId: null, budget: null,
  hotMin: 60, warmMin: 180, coolingMin: 240,
  quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 5,
  sort: 'uecPerHour', nearby: false,
  hotkeyPanel: 'Ctrl+Alt+T', hotkeyDepart: 'Ctrl+Alt+1', hotkeyArrive: 'Ctrl+Alt+2',
  panelSide: 'right', panelWidth: 470, stripCorner: 'top-left',
  opacity: 0.92, showStrip: true, logLevel: 'debug',
  serverChangedAt: null, currentTerminalId: null, targetTerminalId: null,
};
```

## Test Fixtures

`tests/helpers/factories.ts` создаётся в задаче 6 и дополняется по мере надобности. Общий справочник `ref` для всех тестов:

| Вид | id | Значения |
|---|---|---|
| Система | 68, 99 | Stanton, Pyro |
| Терминал | 1 | nickname `ARC-L1`, displayname `ARC-L1 Wide Forest Station`, система 68, планета 10 |
| Терминал | 2 | nickname и displayname `TDD Area 18`, система 68, планета 20 |
| Терминал | 3 | nickname `CRU-L1`, система 68, планета 20 |
| Терминал | 4 | nickname `Ruin Station`, система 99, планета 30 |
| Терминал | 5 | nickname `Baijini Point`, система 68, планета 10 |
| Терминал | 6 | nickname `HUR-L2`, система 68, планета 40 |
| Товар | 10, 20, 30 | `GOLD` Gold, `TITA` Titanium, `TUNG` Tungsten |
| Корабль | 7 | name `C2 Hercules`, scu 696 |

Фабрики: `px(terminalId, commodityId, partial?)` — `UexPrice` с нулями по умолчанию; `obs(partial)` — `Observation`; `term(id)`, `veh(id)`, `run(partial)`, `ev(partial)`; `seedTerminals(db, n)` — n доступных терминалов с id от 1. Помощники вида `withSell`, `withBuy`, `withOwnBuy`, `withOwnSell`, `withUexRange`, `withMarks`, `withManySellers` возвращают копию рынка или рейса с добавленной записью; каждый пишется в той задаче, где впервые нужен.

Команды проверки, общие для всех задач: `npm test` (vitest), `npm run check` (svelte-check), `cargo test --manifest-path src-tauri/Cargo.toml`.

---

# Этап 1. Каркас и риск

### Task 1: Каркас проекта и логирование

**Files:**
- Create: `.gitignore`, `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `svelte.config.js`, `index.html`, `src/main.ts`, `src/ui/App.svelte`, `src-tauri/` (через `tauri init`), `src-tauri/src/logging.rs`, `src/data/logger.ts`, `src/platform/tauri-logger.ts`, `src/platform/crash.ts`
- Test: `tests/data/logger.test.ts`

**Interfaces:**
- Produces:
```ts
// src/data/logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogSink { write(level: LogLevel, line: string): void }
export interface Logger {
  debug(module: string, msg: string, ctx?: unknown): void;
  info(module: string, msg: string, ctx?: unknown): void;
  warn(module: string, msg: string, ctx?: unknown): void;
  error(module: string, msg: string, ctx?: unknown): void;
  setLevel(level: LogLevel): void;
}
export function createLogger(sink: LogSink, level?: LogLevel): Logger;   // по умолчанию 'debug'
export function memorySink(): LogSink & { lines: Array<{ level: LogLevel; line: string }> };
// src/platform/tauri-logger.ts
export function tauriSink(): LogSink;
export function applyLogLevel(log: Logger, level: LogLevel): Promise<void>;  // и Rust, и TS
// src/platform/crash.ts
export function installCrashHandlers(log: Logger): void;
```
- Rust-команда: `set_log_level(level: String)`.

- [ ] **Step 1: Создать проект**

```bash
git init
npm create vite@latest scaffold-tmp -- --template svelte-ts
```
Перенести содержимое `scaffold-tmp` в корень, удалить `scaffold-tmp`. Затем:
```bash
npm install
npm install -D @tauri-apps/cli vitest better-sqlite3 @types/better-sqlite3
npm install @tauri-apps/api @tauri-apps/plugin-sql @tauri-apps/plugin-http @tauri-apps/plugin-global-shortcut @tauri-apps/plugin-log @tauri-apps/plugin-os @tauri-apps/plugin-opener
npx tauri init --ci --app-name "SC Trade" --window-title "SC Trade" --frontend-dist ../dist --dev-url http://localhost:1420 --before-dev-command "npm run dev" --before-build-command "npm run build"
```
В `src-tauri/tauri.conf.json`: `identifier` = `com.sctrade.app`. В `vite.config.ts`: порт 1420, `strictPort: true`. В `package.json` скрипты: `"test": "vitest run"`, `"check": "svelte-check --tsconfig ./tsconfig.json"`, `"tauri": "tauri"`. `vitest.config.ts`: `include: ['tests/**/*.test.ts']`, окружение `node`. В `src-tauri/Cargo.toml` добавить крейты плагинов `tauri-plugin-sql` (feature `sqlite`), `-http`, `-global-shortcut`, `-log`, `-os`, `-opener`, а также `log`. `.gitignore`: `node_modules`, `dist`, `src-tauri/target`, `src-tauri/gen`.

- [ ] **Step 2: Написать падающий тест**

```ts
// tests/data/logger.test.ts
it('formats module, message and context', () => {
  const sink = memorySink(); const log = createLogger(sink);
  log.info('uex', 'request', { url: 'u', ms: 12 });
  expect(sink.lines).toEqual([{ level: 'info', line: '[uex] request {"url":"u","ms":12}' }]);
});
it('omits context when absent', () => {
  const sink = memorySink(); createLogger(sink).warn('db', 'slow');
  expect(sink.lines[0].line).toBe('[db] slow');
});
it('drops entries below the level and honours setLevel', () => {
  const sink = memorySink(); const log = createLogger(sink, 'warn');
  log.debug('a', 'x'); log.info('a', 'x'); log.warn('a', 'y');
  expect(sink.lines.map(l => l.level)).toEqual(['warn']);
  log.setLevel('debug'); log.debug('a', 'z');
  expect(sink.lines).toHaveLength(2);
});
it('serialises Error with message and stack', () => {
  const sink = memorySink(); createLogger(sink).error('crash', 'boom', new Error('bad'));
  expect(sink.lines[0].line).toContain('"message":"bad"');
  expect(sink.lines[0].line).toContain('"stack"');
});
it('never throws when the sink throws or context is circular', () => {
  const log = createLogger({ write() { throw new Error('disk full'); } });
  const circ: any = {}; circ.self = circ;
  expect(() => log.info('a', 'b', circ)).not.toThrow();
});
```

- [ ] **Step 3: Запустить тест, убедиться, что падает**

Run: `npm test -- logger` — Expected: FAIL, `createLogger` не определён.

- [ ] **Step 4: Реализовать `src/data/logger.ts`**

Круговые ссылки и несериализуемый контекст заменяются на `"[unserializable]"`.

- [ ] **Step 5: Запустить тест** — Run: `npm test -- logger` — Expected: PASS.

- [ ] **Step 6: Реализовать Rust-логирование в `src-tauri/src/logging.rs`**

`pub fn plugin() -> TauriPlugin<Wry>`: цели `LogDir { file_name: Some("sctrade") }` и `Stdout`; `max_file_size(5_000_000)`; `RotationStrategy::KeepSome(5)`; уровень `Debug`; локальное время; формат строки `{время с миллисекундами} [{уровень}] {сообщение}`. Команда `set_log_level` вызывает `log::set_max_level`. `pub fn install_panic_hook()` пишет панику со стеком через `log::error!`. Подключить в `lib.rs` вместе с плагинами `os` и `opener`.

- [ ] **Step 7: Реализовать `tauri-logger.ts`, `crash.ts` и подключить в `src/main.ts`**

`installCrashHandlers` подписывается на `error` и `unhandledrejection` и пишет `log.error('crash', …)` со стеком. В `main.ts`: создать логгер, поставить обработчики, записать `log.info('app', 'start', { version })`, смонтировать `App.svelte` с текстом «SC Trade».

- [ ] **Step 8: Проверить запуск**

Run: `npm run tauri dev`. Expected: окно открывается; в `%LOCALAPPDATA%\com.sctrade.app\logs\sctrade.log` есть строка `[app] start`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: project scaffold with full logging"
```

### Task 2: Окно-оверлей

**Files:**
- Create: `src/core/layout.ts`, `src/platform/window.ts`, `src/platform/hotkeys.ts`, `src-tauri/src/focus.rs`, `src-tauri/src/tray.rs`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (крейт `windows`, feature `tray-icon` у `tauri`), `src/ui/App.svelte`
- Test: `tests/core/layout.test.ts`

**Interfaces:**
- Consumes: `Logger` (задача 1).
- Produces:
```ts
// src/core/layout.ts
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const STRIP_SIZE: Size = { width: 520, height: 32 };
export function stripRect(monitor: Size, corner: Corner, margin?: number): Rect;   // margin = 16
export function panelRect(monitor: Size, side: 'left' | 'right', width: number): Rect;
// src/platform/window.ts
export type WindowMode = 'strip' | 'panel';
export interface WindowLayout { panelSide: 'left' | 'right'; panelWidth: number; stripCorner: Corner; showStrip: boolean; opacity: number }
export function setMode(mode: WindowMode, layout: WindowLayout, log: Logger): Promise<void>;
// src/platform/hotkeys.ts
export type HotkeyName = 'panel' | 'depart' | 'arrive';
export function bindHotkeys(keys: Record<HotkeyName, string>, handlers: Record<HotkeyName, () => void>, log: Logger): Promise<Record<HotkeyName, string | null>>;  // null — успех, строка — текст ошибки
```
- Rust-команды: `remember_foreground()`, `restore_foreground()`. Событие трея: `tray://show-panel`.

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/core/layout.test.ts
const m = { width: 1920, height: 1080 };
it('panel takes full height on the chosen side', () => {
  expect(panelRect(m, 'right', 470)).toEqual({ x: 1450, y: 0, width: 470, height: 1080 });
  expect(panelRect(m, 'left', 470)).toEqual({ x: 0, y: 0, width: 470, height: 1080 });
});
it('strip sits in a corner with a 16 px margin', () => {
  expect(stripRect(m, 'top-left')).toEqual({ x: 16, y: 16, width: 520, height: 32 });
  expect(stripRect(m, 'bottom-right')).toEqual({ x: 1384, y: 1032, width: 520, height: 32 });
});
it('panel never exceeds the monitor width', () => {
  expect(panelRect({ width: 400, height: 800 }, 'right', 470)).toEqual({ x: 0, y: 0, width: 400, height: 800 });
});
```

- [ ] **Step 2: Запустить** — `npm test -- layout` — Expected: FAIL.
- [ ] **Step 3: Реализовать `src/core/layout.ts`.**
- [ ] **Step 4: Запустить** — `npm test -- layout` — Expected: PASS.

- [ ] **Step 5: Настроить окно и права**

Окно `main` в `tauri.conf.json`: `decorations: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, `shadow: false`, `visible: false`, `focus: false`. В `capabilities/default.json` разрешить: окно — `set-size`, `set-position`, `set-focus`, `show`, `hide`, `set-ignore-cursor-events`, `current-monitor`; `global-shortcut` — `register`, `unregister`, `is-registered`; `log:default`; `os:default`; `opener:default`; `sql:default` и `sql:allow-execute`; `http:default` с `allow: [{ "url": "https://api.uexcorp.uk/*" }]`.

- [ ] **Step 6: Реализовать `focus.rs` и `tray.rs`**

`remember_foreground` сохраняет `GetForegroundWindow()` в состоянии приложения; `restore_foreground` вызывает `SetForegroundWindow` для сохранённого окна, если оно ещё существует. Трей: пункты «Показать панель» (шлёт `tray://show-panel`) и «Выход» (`app.exit(0)`).

- [ ] **Step 7: Реализовать `window.ts` и `hotkeys.ts`**

Размер монитора берётся в логических пикселях (физический размер ÷ `scaleFactor`). `setMode('panel')`: `remember_foreground` → клики включить → геометрия `panelRect` → показать → фокус. `setMode('strip')`: если `showStrip` — геометрия `stripRect` и `setIgnoreCursorEvents(true)`, иначе скрыть окно; затем `restore_foreground`. Каждая смена режима, фокус и результат регистрации каждого хоткея пишутся в лог (`window`, `hotkey`). Обработчик хоткея срабатывает только на нажатие.

- [ ] **Step 8: Подключить в `App.svelte`**

Состояние `mode`; хоткей `panel` и событие трея переключают режим; `Esc` в панели возвращает в полоску. В панели пока заглушка «Панель», в полоске — «SC Trade».

- [ ] **Step 9: Проверить вручную в игре**

Run: `npm run tauri build -- --debug`, запустить exe, запустить Star Citizen в borderless. Проверить и записать результат в сообщение коммита:
1. Полоска видна поверх игры, клики сквозь неё попадают в игру.
2. `Ctrl+Alt+T` при фокусе в игре открывает панель, в поле ввода можно печатать.
3. `Esc` сворачивает панель, управление в игре работает без клика мышью.
4. Трей: «Показать панель» и «Выход» работают.
5. В логе есть записи о каждой смене режима и срабатывании хоткея.

- [ ] **Step 10: Commit** — `git add -A && git commit -m "feat: overlay window with strip and panel modes"`

---

# Этап 2. Данные

### Task 3: База, миграции, резервная копия

**Files:**
- Create: `src/data/db.ts`, `src/data/migrations.ts`, `src/data/slow-query.ts`, `src/platform/tauri-db.ts`, `src-tauri/src/backup.rs`, `tests/helpers/test-db.ts`
- Test: `tests/data/migrations.test.ts`, `tests/data/slow-query.test.ts`, Rust-тест в `backup.rs`

**Interfaces:**
- Produces:
```ts
// src/data/db.ts
export interface ExecResult { rowsAffected: number; lastInsertId: number }
export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ExecResult>;
}
// src/data/migrations.ts
export interface Migration { version: number; statements: string[] }
export const MIGRATIONS: Migration[];
export function migrate(db: Db, log: Logger): Promise<number>;   // версия схемы после миграции
// src/data/slow-query.ts
export function withSlowQueryLog(db: Db, log: Logger, clockMs?: () => number, thresholdMs?: number): Db;  // 200
// src/platform/tauri-db.ts
export function openTauriDb(): Promise<Db>;   // 'sqlite:sctrade.db'
// tests/helpers/test-db.ts
export function testDb(): Db;                 // better-sqlite3 ':memory:'
export function migratedDb(): Promise<Db>;
```
- Rust-команда: `backup_db() -> Result<Option<String>, String>` — имя созданной копии или `None`, если базы ещё нет.

Схема версии 1 (версия хранится в `PRAGMA user_version`):

```sql
CREATE TABLE uex_star_system (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL, is_available_live INTEGER NOT NULL);
CREATE TABLE uex_terminal (id INTEGER PRIMARY KEY, star_system_id INTEGER NOT NULL, planet_id INTEGER NOT NULL, orbit_id INTEGER NOT NULL,
  name TEXT NOT NULL, nickname TEXT NOT NULL, displayname TEXT NOT NULL, code TEXT NOT NULL,
  star_system_name TEXT, planet_name TEXT, orbit_name TEXT, moon_name TEXT, space_station_name TEXT, outpost_name TEXT, city_name TEXT,
  has_freight_elevator INTEGER NOT NULL, has_loading_dock INTEGER NOT NULL, is_auto_load INTEGER NOT NULL, is_available_live INTEGER NOT NULL);
CREATE TABLE uex_commodity (id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL,
  is_illegal INTEGER NOT NULL, is_buyable INTEGER NOT NULL, is_sellable INTEGER NOT NULL, is_available_live INTEGER NOT NULL);
CREATE TABLE uex_vehicle (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_full TEXT NOT NULL, scu INTEGER NOT NULL);
CREATE TABLE uex_price (terminal_id INTEGER NOT NULL, commodity_id INTEGER NOT NULL,
  /* для side из (buy, sell): {side}_last, {side}_min_week, {side}_max_week, {side}_avg_week,
     {side}_min_month, {side}_max_month, {side}_avg_month, {side}_min, {side}_max, {side}_avg — все REAL NOT NULL */
  scu_buy REAL NOT NULL, scu_sell REAL NOT NULL, date_modified INTEGER NOT NULL, synced_at INTEGER NOT NULL,
  PRIMARY KEY (terminal_id, commodity_id));
CREATE TABLE uex_distance (terminal_a_id INTEGER NOT NULL, terminal_b_id INTEGER NOT NULL, distance_gm REAL,
  PRIMARY KEY (terminal_a_id, terminal_b_id), CHECK (terminal_a_id < terminal_b_id));
CREATE TABLE uex_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE observation (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, terminal_id INTEGER NOT NULL, commodity_id INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')), price REAL NOT NULL, scu INTEGER);
CREATE INDEX observation_lookup ON observation (terminal_id, commodity_id, side, ts);
CREATE TABLE run (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, scu_capacity INTEGER NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL CHECK (status IN ('active','done','lost')));
CREATE UNIQUE INDEX run_one_active ON run (status) WHERE status = 'active';
CREATE TABLE run_event (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES run(id), ts INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy','sell','depart','arrive')), terminal_id INTEGER, commodity_id INTEGER, scu INTEGER, price REAL);
CREATE INDEX run_event_run ON run_event (run_id, ts);
CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```
`distance_gm` допускает `NULL` — так запоминается, что UEX расстояния не знает.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/data/migrations.test.ts
it('creates all tables and reports version 1', async () => {
  const db = testDb(); const log = createLogger(memorySink());
  expect(await migrate(db, log)).toBe(1);
  const names = (await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
  for (const t of ['uex_star_system','uex_terminal','uex_commodity','uex_vehicle','uex_price','uex_distance','uex_meta','observation','run','run_event','setting'])
    expect(names).toContain(t);
});
it('is a no-op when run twice', async () => {
  const db = testDb(); const log = createLogger(memorySink());
  await migrate(db, log); expect(await migrate(db, log)).toBe(1);
});
it('allows only one active run', async () => {
  const db = await migratedDb();
  const ins = "INSERT INTO run (scu_capacity, started_at, status) VALUES (696, 1000, 'active')";
  await db.execute(ins); await expect(db.execute(ins)).rejects.toThrow();
});
it('rejects an unknown observation side and an unordered distance pair', async () => {
  const db = await migratedDb();
  await expect(db.execute("INSERT INTO observation (ts, terminal_id, commodity_id, side, price) VALUES (1,1,1,'x',1)")).rejects.toThrow();
  await expect(db.execute('INSERT INTO uex_distance VALUES (5, 2, 10)')).rejects.toThrow();
});
it('logs each applied migration', async () => {
  const sink = memorySink(); await migrate(testDb(), createLogger(sink));
  expect(sink.lines.some(l => l.line.startsWith('[db] migration applied'))).toBe(true);
});
```
```ts
// tests/data/slow-query.test.ts
it('warns when a query takes 200 ms or more', async () => {
  const sink = memorySink(); const ticks = [0, 250];
  const db = withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!);
  await db.select('SELECT 1');
  expect(sink.lines).toEqual([{ level: 'warn', line: expect.stringContaining('[db] slow query') }]);
});
it('stays silent for fast queries', async () => {
  const sink = memorySink(); const ticks = [0, 100];
  await withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!).select('SELECT 1');
  expect(sink.lines).toHaveLength(0);
});
it('logs and rethrows query errors', async () => {
  const sink = memorySink(); const db = withSlowQueryLog(testDb(), createLogger(sink));
  await expect(db.select('SELECT * FROM nope')).rejects.toThrow();
  expect(sink.lines[0].level).toBe('error');
});
```
Rust, в `backup.rs`:
```rust
#[test]
fn prunes_everything_but_the_newest_five() {
    let names: Vec<String> = (1..=7).map(|d| format!("sctrade-2026100{d}-120000.db")).collect();
    assert_eq!(to_prune(names, 5), vec!["sctrade-20261001-120000.db", "sctrade-20261002-120000.db"]);
}
```

- [ ] **Step 2: Запустить** — `npm test -- migrations slow-query` и `cargo test --manifest-path src-tauri/Cargo.toml` — Expected: FAIL.
- [ ] **Step 3: Реализовать `db.ts`, `tests/helpers/test-db.ts`, `migrations.ts`, `slow-query.ts`.** Адаптер `better-sqlite3` возвращает `lastInsertId` из `lastInsertRowid`.
- [ ] **Step 4: Реализовать `backup.rs`:** `fn to_prune(names: Vec<String>, keep: usize) -> Vec<String>` (сортировка по имени, старые в начале) и команду `backup_db`: файл `sctrade.db` из каталога конфигурации приложения копируется в `backups/sctrade-%Y%m%d-%H%M%S.db`, лишние удаляются; результат пишется в лог.
- [ ] **Step 5: Реализовать `src/platform/tauri-db.ts`** — `Database.load('sqlite:sctrade.db')`, обёрнутый в `withSlowQueryLog`.
- [ ] **Step 6: Запустить** — обе команды из шага 2 — Expected: PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: database schema, migrations, backups"`

### Task 4: Настройки

**Files:**
- Create: `src/core/settings.ts` (код из раздела Shared Types), `src/data/repo/settings.ts`
- Test: `tests/data/settings.test.ts`

**Interfaces:**
- Consumes: `Db`, `Logger`, `migratedDb`.
- Produces:
```ts
export function loadSettings(db: Db, log: Logger): Promise<Settings>;
export function saveSetting<K extends keyof Settings>(db: Db, log: Logger, key: K, value: Settings[K]): Promise<void>;
```
Значения хранятся как JSON в таблице `setting`.

- [ ] **Step 1: Написать падающий тест**

```ts
it('returns defaults on an empty database', async () => {
  expect(await loadSettings(await migratedDb(), log)).toEqual(DEFAULT_SETTINGS);
});
it('round-trips number, null, string and boolean', async () => {
  const db = await migratedDb();
  await saveSetting(db, log, 'scuCapacity', 696); await saveSetting(db, log, 'starSystemId', 68);
  await saveSetting(db, log, 'hotkeyPanel', 'F8'); await saveSetting(db, log, 'showStrip', false);
  await saveSetting(db, log, 'starSystemId', null);
  expect(await loadSettings(db, log)).toEqual({ ...DEFAULT_SETTINGS, scuCapacity: 696, starSystemId: null, hotkeyPanel: 'F8', showStrip: false });
});
it('ignores unknown keys and falls back to default on corrupt JSON, with a warning', async () => {
  const db = await migratedDb();
  await db.execute("INSERT INTO setting VALUES ('nope', '1'), ('topN', '{oops')");
  expect(await loadSettings(db, log)).toEqual(DEFAULT_SETTINGS);
  expect(sink.lines.some(l => l.level === 'warn' && l.line.includes('topN'))).toBe(true);
});
it('logs every saved value', async () => {
  await saveSetting(await migratedDb(), log, 'topN', 3);
  expect(sink.lines.at(-1)).toEqual({ level: 'info', line: '[settings] saved {"key":"topN","value":3}' });
});
```
- [ ] **Step 2: Запустить** — `npm test -- settings` — Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: settings repository"`

### Task 5: Клиент UEX

**Files:**
- Create: `src/core/types.ts` (код из раздела Shared Types), `src/data/uex-client.ts`, `src/platform/tauri-http.ts`, `tests/fixtures/uex/{star_systems,terminals,commodities,vehicles,prices,routes,distance}.json`
- Test: `tests/data/uex-client.test.ts`

**Interfaces:**
- Consumes: `Logger`.
- Produces:
```ts
export type FetchJson = (url: string) => Promise<{ status: number; body: unknown }>;
export class UexError extends Error { kind: 'network' | 'http' | 'status' | 'shape' }
export const UEX_BASE = 'https://api.uexcorp.uk/2.0';
export interface UexClient {
  starSystems(): Promise<StarSystem[]>;
  terminals(): Promise<Terminal[]>;            // terminals?type=commodity
  commodities(): Promise<Commodity[]>;
  vehicles(): Promise<Vehicle[]>;
  prices(terminalIds: number[]): Promise<UexPrice[]>;                       // 1–10 id, иначе RangeError
  distancesFrom(terminalId: number): Promise<Array<{ destId: number; gm: number }>>;  // commodities_routes
  distance(a: number, b: number): Promise<number | null>;                   // terminals_distances
}
export function createUexClient(fetchJson: FetchJson, log: Logger, clockMs?: () => number): UexClient;
// src/platform/tauri-http.ts
export const tauriFetchJson: FetchJson;   // таймаут 30 с; не-JSON тело возвращается как строка
```

Соответствие полей: snake_case UEX → camelCase типов (`id_star_system` → `starSystemId`, `name_full` → `nameFull`). Цены: `price_{side}` → `last`; `price_{side}_{min|max|avg}_{week|month}` и `price_{side}_{min|max|avg}` → одноимённые поля `UexSideStats`; `scu_buy`, `scu_sell`, `date_modified`. Флаги `0/1` → `boolean`.

- [ ] **Step 1: Сохранить ответы UEX**

```bash
mkdir -p tests/fixtures/uex && cd tests/fixtures/uex
curl -s "https://api.uexcorp.uk/2.0/star_systems" -o star_systems.json
curl -s "https://api.uexcorp.uk/2.0/terminals?type=commodity" -o terminals.json
curl -s "https://api.uexcorp.uk/2.0/commodities" -o commodities.json
curl -s "https://api.uexcorp.uk/2.0/vehicles" -o vehicles.json
curl -s "https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=12,85" -o prices.json
curl -s "https://api.uexcorp.uk/2.0/commodities_routes?id_terminal_origin=85" -o routes.json
curl -s "https://api.uexcorp.uk/2.0/terminals_distances?id_terminal_origin=85&id_terminal_destination=12" -o distance.json
```
Обрезать `data` в каждом массиве до первых 20 строк, сохранив в `prices.json` строку Gold у терминала 12, а в `routes.json` — строку с назначением 12. Значения в тестах ниже сверить с сохранёнными файлами и при расхождении взять из файлов.

- [ ] **Step 2: Написать падающий тест**

```ts
const client = (fixtures: Record<string, unknown>, status = 200) =>
  createUexClient(async url => {
    const key = Object.keys(fixtures).find(k => url.includes(k)); calls.push(url);
    return { status, body: fixtures[key!] };
  }, log);

it('maps terminals', async () => {
  const t = (await client({ 'terminals?type=commodity': terminalsFx }).terminals()).find(x => x.id === 1)!;
  expect(t).toMatchObject({ nickname: 'ARC-L1', code: 'ARCL1', starSystemId: 68, starSystemName: 'Stanton', hasFreightElevator: true, isAutoLoad: true });
});
it('maps prices with weekly, monthly and all-time stats', async () => {
  const p = (await client({ commodities_prices: pricesFx }).prices([12, 85])).find(x => x.terminalId === 12 && x.commodityId === 33)!;
  expect(p.sell).toMatchObject({ last: 31000, avgWeek: 31000, minWeek: 31000, maxWeek: 31000 });
  expect(p.scuSell).toBe(840); expect(p.buy.last).toBe(0);
  expect(calls.at(-1)).toBe('https://api.uexcorp.uk/2.0/commodities_prices?id_terminal=12,85');
});
it('coerces numeric strings and nulls', async () => {
  expect(await client({ terminals_distances: { status: 'ok', data: { distance: '59' } } }).distance(85, 12)).toBe(59);
  const [p] = await client({ commodities_prices: { status: 'ok', data: [{ id_terminal: 1, id_commodity: 2, price_buy: '120', price_sell: null, scu_buy: null }] } }).prices([1]);
  expect(p.buy.last).toBe(120); expect(p.sell.last).toBe(0); expect(p.scuBuy).toBe(0); expect(p.sell.avgWeek).toBe(0);
});
it('returns null for an unknown distance', async () => {
  expect(await client({ terminals_distances: { status: 'ok', data: { distance: null } } }).distance(1, 2)).toBeNull();
});
it('reads distances from routes', async () => {
  expect(await client({ commodities_routes: routesFx }).distancesFrom(85)).toContainEqual({ destId: 12, gm: 59 });
});
it('rejects more than ten terminals', async () => {
  await expect(client({}).prices([1,2,3,4,5,6,7,8,9,10,11])).rejects.toBeInstanceOf(RangeError);
});
it.each([
  ['status', 200, { status: 'requests_limit_reached', data: [] }],
  ['http', 500, 'Internal Server Error'],
  ['shape', 200, { status: 'ok', data: 'nope' }],
  ['shape', 200, '<html>'],
])('throws UexError kind %s', async (kind, status, body) => {
  await expect(client({ commodities: body }, status).commodities()).rejects.toMatchObject({ kind });
});
it('wraps network failures', async () => {
  const c = createUexClient(async () => { throw new Error('ECONNRESET'); }, log);
  await expect(c.vehicles()).rejects.toMatchObject({ kind: 'network' });
});
it('logs every request with status, duration and row count', async () => {
  await client({ vehicles: vehiclesFx }).vehicles();
  expect(sink.lines.at(-1)!.line).toMatch(/^\[uex\] request \{"url":".*vehicles","status":200,"ms":\d+,"rows":\d+\}$/);
});
```
- [ ] **Step 3: Запустить** — `npm test -- uex-client` — Expected: FAIL.
- [ ] **Step 4: Реализовать `uex-client.ts` и `tauri-http.ts`.** Ошибки пишутся в лог уровнем `warn` с адресом и видом ошибки.
- [ ] **Step 5: Запустить** — Expected: PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: UEX API client"`

### Task 6: Кэш UEX и синхронизация

**Files:**
- Create: `src/data/repo/uex-cache.ts`, `src/data/sync.ts`, `tests/helpers/factories.ts` (раздел Test Fixtures)
- Test: `tests/data/uex-cache.test.ts`, `tests/data/sync.test.ts`

**Interfaces:**
- Consumes: `Db`, `Logger`, `UexClient`, `UexError`, типы из `core/types.ts`.
- Produces:
```ts
// src/data/repo/uex-cache.ts
export function saveReference(db: Db, part: { starSystems?: StarSystem[]; terminals?: Terminal[]; commodities?: Commodity[]; vehicles?: Vehicle[] }): Promise<void>;  // upsert, затем удаление отсутствующих id
export function loadReference(db: Db): Promise<Reference>;
export function upsertPrices(db: Db, terminalIds: number[], rows: UexPrice[], syncedAt: number): Promise<void>;
export function loadUexPrices(db: Db): Promise<UexPrice[]>;
export function putDistances(db: Db, rows: Array<{ a: number; b: number; gm: number | null }>): Promise<void>;
export function loadDistances(db: Db): Promise<Map<string, number | null>>;   // ключ distKey
export function getMeta(db: Db, key: string): Promise<string | null>;
export function setMeta(db: Db, key: string, value: string): Promise<void>;
// src/data/sync.ts
export interface SyncDeps { db: Db; uex: UexClient; log: Logger; now: () => number }
export function referenceIsStale(syncedAt: number | null, now: number): boolean;   // null или старше 24 ч
export function pricesAreStale(syncedAt: number | null, now: number): boolean;     // null или старше 60 мин
export function syncReference(d: SyncDeps): Promise<void>;                 // бросает UexError; meta 'reference_synced_at'
export function syncPrices(d: SyncDeps): Promise<{ batches: number; failed: number }>;  // не бросает; meta 'prices_synced_at' только при failed === 0
export function ensureDistances(d: SyncDeps, originId: number, pairs: Array<[number, number]>): Promise<Map<string, number | null>>;  // не бросает
```

`upsertPrices` сначала вставляет или обновляет строки, затем удаляет строки терминалов из `terminalIds` с `synced_at < syncedAt`. `syncReference` сначала получает все четыре списка и только потом пишет. `syncPrices` берёт терминалы с `is_available_live`. `ensureDistances`: если по `originId` ещё не запрашивали (`meta 'routes_fetched:<id>'`) — один `distancesFrom`; затем для пар, которых всё ещё нет в кэше, не больше 20 вызовов `distance`; неизвестное расстояние сохраняется как `NULL` и повторно не запрашивается.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/data/uex-cache.test.ts
it('removes a commodity that vanished from a synced terminal but keeps other terminals', async () => {
  await upsertPrices(db, [1, 2], [px(1, 10), px(1, 11), px(2, 10)], 100);
  await upsertPrices(db, [1], [px(1, 10)], 200);
  expect((await loadUexPrices(db)).map(p => priceKey(p.terminalId, p.commodityId)).sort()).toEqual(['1:10', '2:10']);
});
it('round-trips every price field', async () => {
  const p = px(1, 10, { sell: { last: 7000, minWeek: 6400, maxWeek: 7100, avgWeek: 6900, minMonth: 6000, maxMonth: 7200, avgMonth: 6800, min: 5000, max: 8000, avg: 6500 }, scuSell: 500 });
  await upsertPrices(db, [1], [p], 100);
  expect((await loadUexPrices(db))[0]).toEqual(p);
});
it('saveReference drops rows missing from the new list', async () => {
  await saveReference(db, { vehicles: [veh(1), veh(2)] }); await saveReference(db, { vehicles: [veh(2)] });
  expect((await loadReference(db)).vehicles.map(v => v.id)).toEqual([2]);
});
it('stores distances symmetrically, including unknown', async () => {
  await putDistances(db, [{ a: 85, b: 12, gm: 59 }, { a: 3, b: 4, gm: null }]);
  const d = await loadDistances(db);
  expect(d.get(distKey(12, 85))).toBe(59); expect(d.get(distKey(3, 4))).toBeNull(); expect(d.has(distKey(1, 2))).toBe(false);
});
```
```ts
// tests/data/sync.test.ts
it('staleness boundaries', () => {
  expect(pricesAreStale(null, 5000)).toBe(true);
  expect(pricesAreStale(1000, 1000 + 3600)).toBe(false); expect(pricesAreStale(1000, 1000 + 3601)).toBe(true);
  expect(referenceIsStale(1000, 1000 + 86400)).toBe(false); expect(referenceIsStale(1000, 1000 + 86401)).toBe(true);
});
it('requests prices in batches of ten', async () => {
  await seedTerminals(db, 25);
  expect(await syncPrices(deps)).toEqual({ batches: 3, failed: 0 });
  expect(uex.priceCalls.map(ids => ids.length)).toEqual([10, 10, 5]);
  expect(await getMeta(db, 'prices_synced_at')).toBe(String(NOW));
});
it('keeps old rows of a failed batch and does not mark prices fresh', async () => {
  await seedTerminals(db, 25); await upsertPrices(db, [11], [px(11, 10)], 50);
  uex.failBatch = 1;                                   // вторая пачка: терминалы 11–20
  expect(await syncPrices(deps)).toEqual({ batches: 3, failed: 1 });
  const keys = (await loadUexPrices(db)).map(p => p.terminalId);
  expect(keys).toContain(11); expect(keys).toContain(1); expect(keys).toContain(21);
  expect(await getMeta(db, 'prices_synced_at')).toBeNull();
  expect(sink.lines.some(l => l.level === 'warn' && l.line.includes('[sync]'))).toBe(true);
});
it('syncReference writes nothing when one list fails', async () => {
  await saveReference(db, { terminals: [term(1)] }); uex.failCommodities = true;
  await expect(syncReference(deps)).rejects.toBeInstanceOf(UexError);
  expect((await loadReference(db)).terminals.has(1)).toBe(true);
  expect(await getMeta(db, 'reference_synced_at')).toBeNull();
});
it('ensureDistances asks routes once, then only missing pairs, at most twenty', async () => {
  uex.routes = [{ destId: 12, gm: 59 }];
  const pairs = Array.from({ length: 30 }, (_, i) => [85, 100 + i] as [number, number]);
  const d = await ensureDistances(deps, 85, [[85, 12], ...pairs]);
  expect(d.get(distKey(85, 12))).toBe(59);
  expect(uex.routeCalls).toEqual([85]); expect(uex.distanceCalls).toHaveLength(20);
  await ensureDistances(deps, 85, [[85, 12], ...pairs.slice(0, 20)]);
  expect(uex.routeCalls).toEqual([85]); expect(uex.distanceCalls).toHaveLength(20);
});
it('ensureDistances swallows UEX failures and returns the cache', async () => {
  uex.failRoutes = true;
  await expect(ensureDistances(deps, 85, [[85, 12]])).resolves.toBeInstanceOf(Map);
});
```
`uex` в тестах — подставной `UexClient` со счётчиками вызовов и флагами отказа; `px`, `term`, `veh`, `seedTerminals` — вспомогательные функции в `tests/helpers/factories.ts`.

- [ ] **Step 2: Запустить** — `npm test -- uex-cache sync` — Expected: FAIL.
- [ ] **Step 3: Реализовать `uex-cache.ts`.** Вставка многострочным `INSERT … ON CONFLICT DO UPDATE`, не больше 100 строк на выражение.
- [ ] **Step 4: Реализовать `sync.ts`.** Начало и конец каждой синхронизации и итог по пачкам пишутся в лог (`sync`).
- [ ] **Step 5: Запустить** — Expected: PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: UEX cache and sync"`

---

# Этап 3. Дневник и подсказки

### Task 7: Температура, рынок, оценка цены

**Files:**
- Create: `src/core/temperature.ts`, `src/core/market.ts`, `src/core/estimate.ts`
- Test: `tests/core/temperature.test.ts`, `tests/core/market.test.ts`, `tests/core/estimate.test.ts`

**Interfaces:**
- Produces:
```ts
export function temperature(ts: number, now: number, th: TempThresholds, serverChangedAt: number | null): Temp;
export function buildMarket(prices: UexPrice[], latestObs: Observation[]): Market;
export interface EstimateCtx { now: number; thresholds: TempThresholds; serverChangedAt: number | null }
export function estimate(m: Market, terminalId: number, commodityId: number, side: Side, ctx: EstimateCtx): Estimate | null;
```

Границы: возраст `< 60 мин` — `hot`, `< 180` — `warm`, `≤ 240` — `cooling`, иначе `cold`. Отрицательный возраст считается нулём. `ts < serverChangedAt` — всегда `cold`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// temperature.test.ts
const th = { hotMin: 60, warmMin: 180, coolingMin: 240 }; const now = 1_000_000; const min = 60;
it.each([
  [0, 'hot'], [59 * min + 59, 'hot'], [60 * min, 'warm'], [179 * min + 59, 'warm'],
  [180 * min, 'cooling'], [240 * min, 'cooling'], [240 * min + 1, 'cold'],
])('age %i s → %s', (age, temp) => expect(temperature(now - age, now, th, null)).toBe(temp));
it('server change cools older data only', () => {
  expect(temperature(now - 1200, now, th, now - 600)).toBe('cold');
  expect(temperature(now - 300, now, th, now - 600)).toBe('hot');
});
it('treats a future timestamp as fresh', () => expect(temperature(now + 500, now, th, null)).toBe('hot'));
```
```ts
// market.test.ts
it('indexes by terminal and commodity across both sources and keeps the latest observation', () => {
  const m = buildMarket([px(1, 10)], [obs({ id: 1, ts: 100, terminalId: 2, commodityId: 10, side: 'sell', price: 5 }), obs({ id: 2, ts: 200, terminalId: 2, commodityId: 10, side: 'sell', price: 7 })]);
  expect([...m.byCommodity.get(10)!].sort()).toEqual([1, 2]);
  expect([...m.byTerminal.get(2)!]).toEqual([10]);
  expect(m.own.get(obsKey(2, 10, 'sell'))!.price).toBe(7);
});
```
```ts
// estimate.test.ts — терминал 2, товар 10, сторона sell
const week = { avgWeek: 6900, minWeek: 6400, maxWeek: 7100 };
const ctx = { now, thresholds: th, serverChangedAt: null };
const own = (ageMin: number, scu: number | null = 200) => obs({ ts: now - ageMin * 60, terminalId: 2, commodityId: 10, side: 'sell', price: 6840, scu });
it('uses a hot own price as is', () => {
  expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10)]), 2, 10, 'sell', ctx))
    .toEqual({ price: 6840, low: 6840, high: 6840, source: 'own', temp: 'hot', ageSec: 600, ownLast: null, uexRange: null, scu: 200 });
});
it('attaches the UEX range while cooling', () => {
  expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(200)]), 2, 10, 'sell', ctx))
    .toMatchObject({ price: 6840, source: 'own', temp: 'cooling', uexRange: { low: 6400, high: 7100 } });
});
it('falls back to UEX weekly stats when own is cold, keeping own for reference', () => {
  expect(estimate(buildMarket([px(2, 10, { sell: week })], [own(300)]), 2, 10, 'sell', ctx))
    .toMatchObject({ price: 6900, low: 6400, high: 7100, source: 'uex', temp: null, ownLast: { price: 6840, ageSec: 18000 } });
});
it.each([
  [{ avgMonth: 6800, minMonth: 6000, maxMonth: 7200 }, [6800, 6000, 7200]],
  [{ avg: 6500, min: 5000, max: 8000 }, [6500, 5000, 8000]],
  [{ last: 6300 }, [6300, 6300, 6300]],
])('falls back through month, all-time, last', (sell, [price, low, high]) => {
  expect(estimate(buildMarket([px(2, 10, { sell })], []), 2, 10, 'sell', ctx)).toMatchObject({ price, low, high, source: 'uex' });
});
it('returns null when nothing is known', () => {
  expect(estimate(buildMarket([px(2, 10)], []), 2, 10, 'sell', ctx)).toBeNull();
  expect(estimate(buildMarket([], []), 2, 10, 'sell', ctx)).toBeNull();
});
it('keeps a cold own price when UEX has no row', () => {
  expect(estimate(buildMarket([], [own(300)]), 2, 10, 'sell', ctx))
    .toMatchObject({ price: 6840, low: 6840, high: 6840, source: 'own', temp: 'cold' });
});
it('takes quantity from own when known, else UEX, else null', () => {
  const m = (scu: number | null, scuSell: number) => buildMarket([px(2, 10, { sell: week, scuSell })], [own(10, scu)]);
  expect(estimate(m(null, 500), 2, 10, 'sell', ctx)!.scu).toBe(500);
  expect(estimate(m(null, 0), 2, 10, 'sell', ctx)!.scu).toBeNull();
  expect(estimate(m(0, 500), 2, 10, 'sell', ctx)!.scu).toBe(500);
});
it('reads buy stats and stock for the buy side', () => {
  expect(estimate(buildMarket([px(2, 10, { buy: { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 }, scuBuy: 340 })], []), 2, 10, 'buy', ctx))
    .toMatchObject({ price: 6000, low: 5900, high: 6200, scu: 340 });
});
```
`obs` — фабрика в `tests/helpers/factories.ts`.

- [ ] **Step 2: Запустить** — `npm test -- temperature market estimate` — Expected: FAIL.
- [ ] **Step 3: Реализовать три модуля.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: temperature and price estimation"`

### Task 8: Объём, время, маршруты

**Files:**
- Create: `src/core/routes.ts`
- Test: `tests/core/routes.test.ts`

**Interfaces:**
- Consumes: `Market`, `Estimate`, `estimate`, `EstimateCtx`, `Terminal`, `pairKey`, `distKey`.
- Produces:
```ts
export function quantity(i: { freeScu: number; stockScu: number | null; demandScu: number | null; budget: number | null; buyPrice: number }): number;
export function travelSec(distanceGm: number, speedKkms: number, overheadMin: number): number;  // overheadMin*60 + distanceGm*1000/speedKkms
export interface RouteSettings { starSystemId: number | null; budget: number | null; quantumSpeedKkms: number; overheadMin: number; overheadEmptyMin: number; topN: number; sort: 'uecPerHour' | 'roi' }
export interface RouteCtx extends EstimateCtx {
  settings: RouteSettings; freeScu: number;
  terminals: Map<number, Terminal>;
  distances: Map<string, number | null>;   // distKey
  ownMedian: Map<string, number>;          // pairKey → секунды
}
export interface RouteOption {
  commodityId: number; originId: number; destId: number; buy: Estimate; sell: Estimate;
  qty: number; profit: number; roi: number; worstProfit: number;
  distanceGm: number | null; emptyLegSec: number; timeSec: number | null; timeSource: 'own' | 'estimate' | null;
  uecPerHour: number | null;
}
export interface RouteTrace { considered: number; kept: number; dropped: { unknownTerminal: number; systemFilter: number; nonPositiveProfit: number; zeroQty: number } }
export interface RouteResult { options: RouteOption[]; trace: RouteTrace }
export function routesFrom(m: Market, originIds: number[], currentTerminalId: number, ctx: RouteCtx, commodityId?: number): RouteResult;
export function routesTo(m: Market, destId: number, ctx: RouteCtx): RouteResult;
```

Правила: пустой перелёт до точки закупки, отличной от текущей, — `travelSec(d, speed, overheadEmptyMin)`; если расстояние до неё неизвестно, время всего варианта неизвестно. `timeSec` включает `emptyLegSec`. Сортировка по убыванию; при `uecPerHour` варианты без времени идут в конец в порядке убывания ROI. `options` обрезается до `topN`.

- [ ] **Step 1: Написать падающий тест**

```ts
// Терминалы: A=1 (система 68, планета 10), B=2 (68, 20), C=3 (68, 20), D=4 (99, 30), A2=5 (68, 10). Товар Gold=10.
// A: своя горячая покупка 6120, остаток 340. B: UEX продажа 6900 (6400–7100). C: своя тёплая продажа 6840.
// D: UEX продажа 9000. Расстояния: A–B 59, A–C 61.
it.each([
  [{ freeScu: 696, stockScu: 340, demandScu: null, budget: null, buyPrice: 6120 }, 340],
  [{ freeScu: 696, stockScu: null, demandScu: 200, budget: null, buyPrice: 6120 }, 200],
  [{ freeScu: 696, stockScu: null, demandScu: null, budget: 1_000_000, buyPrice: 6120 }, 163],
  [{ freeScu: 696, stockScu: null, demandScu: null, budget: null, buyPrice: 6120 }, 696],
  [{ freeScu: -5, stockScu: 340, demandScu: null, budget: null, buyPrice: 6120 }, 0],
])('quantity', (i, q) => expect(quantity(i)).toBe(q));
it('travelSec', () => { expect(travelSec(59, 200, 12)).toBe(1015); expect(travelSec(0, 200, 5)).toBe(300); });

it('ranks destinations by UEC per hour and applies the system filter', () => {
  const { options, trace } = routesFrom(market, [1], 1, ctx);
  expect(options.map(o => o.destId)).toEqual([2, 3]);
  expect(options[0]).toMatchObject({ qty: 340, profit: 265200, worstProfit: 95200, distanceGm: 59, timeSec: 1015, timeSource: 'estimate', emptyLegSec: 0 });
  expect(options[0].roi).toBeCloseTo(0.12745, 4);
  expect(Math.round(options[0].uecPerHour!)).toBe(940611);
  expect(options[1]).toMatchObject({ profit: 244800, timeSec: 1025 });
  expect(Math.round(options[1].uecPerHour!)).toBe(859785);
  expect(trace).toEqual({ considered: 3, kept: 2, dropped: { unknownTerminal: 0, systemFilter: 1, nonPositiveProfit: 0, zeroQty: 0 } });
});
it('prefers my own median time over the estimate', () => {
  const { options } = routesFrom(market, [1], 1, { ...ctx, ownMedian: new Map([[pairKey(1, 3), 600]]) });
  expect(options[0]).toMatchObject({ destId: 3, timeSec: 600, timeSource: 'own', uecPerHour: 1468800 });
});
it('sorts by ROI on request', () => {
  const c = { ...ctx, ownMedian: new Map([[pairKey(1, 3), 600]]), settings: { ...ctx.settings, sort: 'roi' as const } };
  expect(routesFrom(market, [1], 1, c).options.map(o => o.destId)).toEqual([2, 3]);
});
it('puts routes with unknown distance last and leaves UEC per hour empty', () => {
  const { options } = routesFrom(market, [1], 1, { ...ctx, distances: new Map([[distKey(1, 3), 61]]) });
  expect(options.map(o => o.destId)).toEqual([3, 2]);
  expect(options[1]).toMatchObject({ timeSec: null, uecPerHour: null, timeSource: null });
});
it('allows cross-system routes when the filter is off', () => {
  const c = { ...ctx, settings: { ...ctx.settings, starSystemId: null } };
  expect(routesFrom(market, [1], 1, c).options.map(o => o.destId)).toContain(4);
});
it('drops non-positive profit, respects topN, budget and the commodity filter', () => {
  const m2 = withSell(market, 6, 6000);                 // терминал 6 в системе 68 покупает дешевле закупки
  expect(routesFrom(m2, [1], 1, ctx).trace.dropped.nonPositiveProfit).toBe(1);
  expect(routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, topN: 1 } }).options).toHaveLength(1);
  expect(routesFrom(market, [1], 1, { ...ctx, settings: { ...ctx.settings, budget: 1_000_000 } }).options[0].qty).toBe(163);
  expect(routesFrom(market, [1], 1, ctx, 999).options).toEqual([]);
});
it('adds the empty leg for a nearby origin', () => {
  const m2 = withBuy(market, 5, { avgWeek: 6000, minWeek: 5900, maxWeek: 6200 });
  const c = { ...ctx, distances: new Map([...ctx.distances, [distKey(1, 5), 2], [distKey(5, 2), 60]]) };
  const o = routesFrom(m2, [1, 5], 1, c).options.find(x => x.originId === 5 && x.destId === 2)!;
  expect(o.emptyLegSec).toBe(310); expect(o.timeSec).toBe(310 + 1020);
  expect(o.worstProfit).toBe(o.qty * (6400 - 6200));
});
it('never routes a terminal to itself and skips terminals missing from the reference', () => {
  const m2 = withSell(market, 777, 9999);               // терминала 777 нет в ctx.terminals
  const r = routesFrom(m2, [1], 1, ctx);
  expect(r.options.every(o => o.destId !== o.originId && o.destId !== 777)).toBe(true);
  expect(r.trace.dropped.unknownTerminal).toBe(1);
});
it('routesTo mirrors routesFrom for the same pair', () => {
  const o = routesTo(market, 2, ctx).options[0];
  expect(o).toMatchObject({ originId: 1, destId: 2, profit: 265200, timeSec: 1015 });
});
```
- [ ] **Step 2: Запустить** — `npm test -- routes` — Expected: FAIL.
- [ ] **Step 3: Реализовать `src/core/routes.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: route ranking"`

### Task 9: Поиск, ввод, форматирование

**Files:**
- Create: `src/core/search.ts`, `src/core/input.ts`, `src/core/format.ts`
- Test: `tests/core/search.test.ts`, `tests/core/input.test.ts`, `tests/core/format.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Searchable { id: number; code: string; name: string; aliases?: string[] }
export function search<T extends Searchable>(items: T[], query: string, boostIds?: Set<number>, limit?: number): T[];  // limit = 8
export function parsePrice(input: string): number | null;   // целое > 0
export function parseScu(input: string): number | null;     // целое ≥ 0; пустая строка → null
export function priceWarning(price: number, uexMin: number, uexMax: number): boolean;
export function formatUec(n: number): string;        // '6 120', разделитель — неразрывный пробел
export function formatCompact(n: number): string;    // '936k', '1,25M'
export function formatPct(ratio: number): string;    // '12,7%'
export function formatAge(sec: number): string;      // 'сейчас', '40 мин', '1,5 ч', '2 д'
export function formatDuration(sec: number): string; // '14:32', '1:04:32'
```

Порядок поиска: начало кода → начало слова в названии или псевдониме → подстрока. Внутри уровня: сначала `boostIds`, затем по алфавиту названия. Разбор чисел: пробелы, неразрывные пробелы, запятые и точки отбрасываются; если остаток — не только цифры, результат `null`; больше 100 000 000 — `null`. Возраст: меньше минуты — «сейчас»; меньше часа — минуты; меньше суток — часы с шагом 0,5; дальше — целые дни.

- [ ] **Step 1: Написать падающие тесты**

```ts
// search.test.ts
const items = [
  { id: 1, code: 'GOLD', name: 'Gold' }, { id: 2, code: 'GOLM', name: 'Golden Medmon' },
  { id: 3, code: 'AGRI', name: 'Agricium' }, { id: 4, code: 'AGRS', name: 'Agricultural Supplies' },
  { id: 5, code: 'RMC', name: 'Recycled Material Composite' }, { id: 6, code: 'TITA', name: 'Titanium' },
  { id: 7, code: 'STIM', name: 'Stims' }, { id: 8, code: 'TDA18', name: 'TDD Area 18', aliases: ['ArcCorp'] },
];
const ids = (q: string, boost?: Set<number>) => search(items, q, boost).map(i => i.id);
it('matches code prefix case-insensitively', () => expect(ids('gol')).toEqual([1, 2]));
it('boosts commodities traded here', () => expect(ids('gol', new Set([2]))).toEqual([2, 1]));
it('resolves an ambiguous prefix alphabetically', () => expect(ids('AGR')).toEqual([3, 4]));
it('ranks code prefix above word prefix above substring', () => { expect(ids('ti')).toEqual([6, 7]); expect(ids('mat')).toEqual([5]); expect(ids('tan')).toEqual([6]); });
it('searches aliases', () => { expect(ids('area')).toEqual([8]); expect(ids('arc')).toEqual([8]); });
it('returns nothing for a blank query', () => { expect(ids('')).toEqual([]); expect(ids('   ')).toEqual([]); });
```
```ts
// input.test.ts
it.each([['6120', 6120], ['6 120', 6120], ['6,120', 6120], ['6.120', 6120], [' 318 ', 318], ['6 120', 6120],
  ['', null], ['abc', null], ['12abc', null], ['-5', null], ['0', null], ['999999999', null]])('parsePrice(%j)', (s, n) => expect(parsePrice(s)).toBe(n));
it.each([['340', 340], ['0', 0], ['', null], ['x', null]])('parseScu(%j)', (s, n) => expect(parseScu(s)).toBe(n));
it.each([[3000, false], [2999, true], [14000, false], [14001, true]])('priceWarning(%i) against 6000–7000', (p, w) => expect(priceWarning(p, 6000, 7000)).toBe(w));
it('never warns without UEX history', () => expect(priceWarning(5, 0, 0)).toBe(false));
```
```ts
// format.test.ts
it('formatUec', () => { expect(formatUec(6120)).toBe('6 120'); expect(formatUec(318)).toBe('318'); expect(formatUec(1234567)).toBe('1 234 567'); });
it.each([[612, '612'], [936000, '936k'], [1250000, '1,25M'], [999950, '1M'], [-95200, '-95k']])('formatCompact(%i)', (n, s) => expect(formatCompact(n)).toBe(s));
it('formatPct', () => expect(formatPct(0.12745)).toBe('12,7%'));
it.each([[30, 'сейчас'], [2400, '40 мин'], [3599, '59 мин'], [3600, '1 ч'], [5400, '1,5 ч'], [12600, '3,5 ч'], [172800, '2 д']])('formatAge(%i)', (s, t) => expect(formatAge(s)).toBe(t));
it.each([[5, '0:05'], [872, '14:32'], [3872, '1:04:32']])('formatDuration(%i)', (s, t) => expect(formatDuration(s)).toBe(t));
```
- [ ] **Step 2: Запустить** — `npm test -- search input format` — Expected: FAIL.
- [ ] **Step 3: Реализовать три модуля.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: search, input parsing, formatting"`

### Task 10: Дневник и сервис подсказок

**Files:**
- Create: `src/data/repo/diary.ts`, `src/data/suggest.ts`
- Test: `tests/data/diary.test.ts`, `tests/data/suggest.test.ts`

**Interfaces:**
- Consumes: `Db`, `Logger`, `SyncDeps`, `ensureDistances`, `loadUexPrices`, `loadDistances`, `buildMarket`, `routesFrom`, `routesTo`, `Settings`, `Reference`.
- Produces:
```ts
// src/data/repo/diary.ts
export function addObservation(db: Db, log: Logger, o: Omit<Observation, 'id'>): Promise<number>;
export function latestObservations(db: Db): Promise<Observation[]>;   // по одному на (терминал, товар, сторона): максимум ts, затем id
// src/data/suggest.ts
export interface SuggestDeps extends SyncDeps { reference: Reference; settings: Settings; ownMedian: Map<string, number> }
export function loadMarket(db: Db): Promise<Market>;
export function suggestFrom(d: SuggestDeps, currentTerminalId: number, freeScu: number, commodityId?: number): Promise<RouteOption[]>;
export function suggestTo(d: SuggestDeps, destId: number, freeScu: number): Promise<RouteOption[]>;
```

`suggestFrom`: точки закупки — текущий терминал; при `settings.nearby` — ещё и терминалы с тем же ненулевым `planetId`. Расчёт выполняется, затем для вариантов без расстояния (до 20, по убыванию ROI) вызывается `ensureDistances`, после чего расчёт повторяется. В лог (`suggest`, уровень `debug`) пишутся: входные точки, фильтры, трассировка и итоговый список — код товара, точки, цены, источники, температуры.

- [ ] **Step 1: Написать падающие тесты**

```ts
// diary.test.ts
it('returns only the latest observation per terminal, commodity and side', async () => {
  await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
  await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
  await addObservation(db, log, { ts: 150, terminalId: 1, commodityId: 10, side: 'sell', price: 5000, scu: null });
  const l = await latestObservations(db);
  expect(l).toHaveLength(2);
  expect(l.find(o => o.side === 'buy')).toMatchObject({ price: 6120, scu: null, ts: 200 });
});
it('breaks a timestamp tie by insertion order', async () => {
  await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 1, scu: null });
  await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 2, scu: null });
  expect((await latestObservations(db))[0].price).toBe(2);
});
it('logs the written values', async () => {
  await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: 340 });
  expect(sink.lines.at(-1)!.line).toBe('[diary] observation {"ts":100,"terminalId":1,"commodityId":10,"side":"buy","price":6120,"scu":340}');
});
```
```ts
// suggest.test.ts — те же терминалы и цены, что в задаче 8, но в базе; расстояний в кэше нет
it('fetches missing distances once and returns timed options', async () => {
  uex.routes = [{ destId: 2, gm: 59 }, { destId: 3, gm: 61 }];
  const o = await suggestFrom(deps, 1, 696);
  expect(o.map(x => x.destId)).toEqual([2, 3]); expect(o[0].timeSec).toBe(1015);
  await suggestFrom(deps, 1, 696);
  expect(uex.routeCalls).toEqual([1]);
});
it('still answers when UEX is down', async () => {
  uex.failRoutes = true; uex.failDistance = true;
  const o = await suggestFrom(deps, 1, 696);
  expect(o).toHaveLength(2); expect(o[0].uecPerHour).toBeNull();
});
it('includes same-planet origins when nearby is on', async () => {
  await addUexBuy(db, 5, 10, 6000);
  const o = await suggestFrom({ ...deps, settings: { ...deps.settings, nearby: true } }, 1, 696);
  expect(o.some(x => x.originId === 5)).toBe(true);
});
it('ignores diary rows whose terminal left the reference', async () => {
  await addObservation(db, log, { ts: NOW, terminalId: 777, commodityId: 10, side: 'sell', price: 99999, scu: null });
  const o = await suggestFrom(deps, 1, 696);
  expect(o.every(x => x.destId !== 777)).toBe(true);
});
it('narrows to one commodity', async () => expect(await suggestFrom(deps, 1, 696, 999)).toEqual([]));
it('suggestTo lists origins for what the terminal buys', async () => {
  expect((await suggestTo(deps, 2, 696))[0]).toMatchObject({ originId: 1, destId: 2 });
});
it('logs inputs, trace and results', async () => {
  await suggestFrom(deps, 1, 696);
  const line = sink.lines.findLast(l => l.line.startsWith('[suggest] from'))!.line;
  expect(line).toContain('"considered":3'); expect(line).toContain('"systemFilter":1'); expect(line).toContain('"source":"own"');
});
```
- [ ] **Step 2: Запустить** — `npm test -- diary suggest` — Expected: FAIL.
- [ ] **Step 3: Реализовать `diary.ts` и `suggest.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: price diary and suggestion service"`

### Task 11: Запуск, состояние, шапка, настройки

**Files:**
- Create: `src/ui/boot.ts`, `src/ui/state.svelte.ts`, `src/ui/vm/header.ts`, `src/ui/theme.css`, `src/ui/Panel.svelte`, `src/ui/Header.svelte`, `src/ui/Strip.svelte`, `src/ui/components/SearchBox.svelte`, `src/ui/tabs/SettingsTab.svelte`
- Modify: `src/ui/App.svelte`, `src/main.ts`
- Test: `tests/ui/header.test.ts`

**Interfaces:**
- Consumes: всё из задач 1–10.
- Produces:
```ts
// src/ui/vm/header.ts
export interface HeaderModel { location: string; ship: string; system: string; uex: string; uexStale: boolean }
export function headerModel(ref: Reference, s: Settings, pricesSyncedAt: number | null, uexOk: boolean, now: number): HeaderModel;
export function terminalSearchItems(ref: Reference, starSystemId: number | null): Searchable[];   // name = displayname, aliases = [nickname, name, planetName]
export function commoditySearchItems(ref: Reference): Searchable[];
// src/ui/boot.ts
export type BootResult = { ok: true } | { ok: false; reason: string };
export function boot(): Promise<BootResult>;
// src/ui/state.svelte.ts — единственный экземпляр
export const app: {
  settings: Settings; reference: Reference; market: Market; distances: Map<string, number | null>;
  pricesSyncedAt: number | null; uexOk: boolean; now: number;          // now обновляется раз в секунду
  mode: WindowMode; tab: 'terminal' | 'run' | 'routes' | 'settings'; hotkeyErrors: Record<HotkeyName, string | null>;
  setCurrentTerminal(id: number): Promise<void>;
  serverChanged(): Promise<void>;                                       // serverChangedAt = now
  updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>;
  reloadMarket(): Promise<void>;
  refreshReference(): Promise<void>;
  toggleMode(): Promise<void>;
  openLogs(): Promise<void>;
  quit(): Promise<void>;
};
```

Последовательность `boot()`: `backup_db` → открыть базу → `migrate` → `loadSettings` → `applyLogLevel` → лог `app/start` с версией приложения, версией Windows, размером экрана и версией схемы → `bindHotkeys` → если справочник пуст: `syncReference`, при ошибке вернуть `{ ok: false }` → загрузить справочник, рынок, расстояния → в фоне: `syncReference` при устаревании, `syncPrices` при устаревании и далее каждые 60 минут, после каждой — `reloadMarket`. Любой сбой фоновой синхронизации ставит `uexOk = false` и не всплывает.

`updateSetting` после сохранения применяет изменение: хоткеи перерегистрируются, геометрия и прозрачность окна обновляются, уровень лога меняется. Каждое действие из `app` пишет `log.info('ui', …)`.

- [ ] **Step 1: Написать падающий тест**

```ts
it('describes location, ship and system', () => {
  const h = headerModel(ref, { ...DEFAULT_SETTINGS, currentTerminalId: 1, vehicleId: 7, scuCapacity: 696, starSystemId: 68 }, NOW - 1500, true, NOW);
  expect(h).toEqual({ location: 'ARC-L1 Wide Forest Station', ship: 'C2 Hercules · 696 SCU', system: 'Stanton', uex: 'UEX 25 мин назад', uexStale: false });
});
it('covers unset values', () => {
  const h = headerModel(ref, DEFAULT_SETTINGS, null, true, NOW);
  expect(h).toMatchObject({ location: 'Локация не выбрана', ship: 'Корабль не выбран', system: 'Все системы', uex: 'UEX ещё не загружен' });
});
it('flags an unreachable UEX with the cache date', () => {
  const h = headerModel(ref, DEFAULT_SETTINGS, Date.UTC(2026, 9, 6, 14, 5) / 1000, false, NOW);
  expect(h.uexStale).toBe(true); expect(h.uex).toMatch(/^UEX недоступен, данные от 06\.10 \d\d:05$/);
});
it('survives a current terminal that left the reference', () => {
  expect(headerModel(ref, { ...DEFAULT_SETTINGS, currentTerminalId: 777 }, NOW, true, NOW).location).toBe('Локация не выбрана');
});
it('filters terminals by system and exposes aliases', () => {
  const items = terminalSearchItems(ref, 68);
  expect(items.every(i => ref.terminals.get(i.id)!.starSystemId === 68)).toBe(true);
  expect(items.find(i => i.id === 1)!.aliases).toContain('ARC-L1');
});
```
- [ ] **Step 2: Запустить** — `npm test -- header` — Expected: FAIL.
- [ ] **Step 3: Реализовать `vm/header.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Реализовать `boot.ts` и `state.svelte.ts`.**
- [ ] **Step 6: Реализовать компоненты**

`App.svelte`: при `{ ok: false }` — экран с текстом ошибки и кнопкой «Повторить»; иначе `Strip` или `Panel` по `app.mode`. `Panel`: шапка, вкладки, прозрачность из настроек. `Header`: локация с `SearchBox` (поиск по `terminalSearchItems`, `Enter` берёт верхний, стрелки выбирают), корабль, система, возраст UEX, кнопка «Сменил сервер». `SettingsTab`: все поля из раздела 9 спеки, ошибки хоткеев рядом с полями, выбор корабля подставляет его SCU, кнопки «Открыть папку логов», «Обновить справочник», «Выход». `theme.css`: цвета плашек горячая / тёплая / остывает / холодная и общие отступы; тёмная полупрозрачная тема.

- [ ] **Step 7: Проверить**

Run: `npm run check` — Expected: 0 errors. Run: `npm run tauri dev` — Expected: первый запуск качает справочник; в настройках выбирается корабль и система; смена локации поиском по трём буквам работает; перезапуск сохраняет настройки; в логе есть `[app] start`, `[sync]`, `[ui]`.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: boot sequence, app state, header and settings"`

### Task 12: Вкладка «Терминал»

**Files:**
- Create: `src/ui/vm/terminal-rows.ts`, `src/ui/tabs/TerminalTab.svelte`, `src/ui/components/QuickEntry.svelte`, `src/ui/components/TempBadge.svelte`, `src/ui/components/RouteList.svelte`
- Modify: `src/ui/state.svelte.ts`, `src/ui/Panel.svelte`
- Test: `tests/ui/terminal-rows.test.ts`

**Interfaces:**
- Consumes: `estimate`, `priceWarning`, `formatAge`, `addObservation`, `suggestFrom`, `suggestTo`, `app`.
- Produces:
```ts
// src/ui/vm/terminal-rows.ts
export interface Cell {
  own: number | null; ownScu: number | null;      // своё не холодное значение
  hint: number | null; hintScu: number | null;    // подсказка UEX или своё холодное
  badge: { text: string; kind: Temp | 'uex' } | null;
  warn: boolean;
}
export interface TerminalRow { commodityId: number; code: string; name: string; buy: Cell | null; sell: Cell | null }
export function terminalRows(m: Market, ref: Reference, terminalId: number, ctx: EstimateCtx): TerminalRow[];
export function badgeText(e: Estimate): { text: string; kind: Temp | 'uex' };   // 'моя · 40 мин' | 'UEX'
// добавляется в app
app.recordPrice(input: { terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }): Promise<void>;
app.suggestions: { from: RouteOption[]; to: RouteOption[]; loading: boolean };
app.refreshSuggestions(commodityId?: number): Promise<void>;
```

Строки — объединение товаров точки из UEX и из своего дневника, по алфавиту названия. Ячейка стороны есть, если по ней существует оценка. Товары, которых нет в справочнике, пропускаются.

- [ ] **Step 1: Написать падающий тест**

```ts
it('shows own values with a temperature badge and UEX values as hints', () => {
  const rows = terminalRows(market, ref, 1, ctx);       // точка 1: Gold — своя покупка 6120/340 две минуты назад; Tungsten — только UEX 3980/410
  expect(rows.map(r => r.code)).toEqual(['GOLD', 'TUNG']);
  expect(rows[0].buy).toEqual({ own: 6120, ownScu: 340, hint: null, hintScu: null, badge: { text: 'моя · 2 мин', kind: 'hot' }, warn: false });
  expect(rows[0].sell).toBeNull();
  expect(rows[1].buy).toEqual({ own: null, ownScu: null, hint: 3980, hintScu: 410, badge: { text: 'UEX', kind: 'uex' }, warn: false });
});
it('demotes a cold own value to a hint', () => {
  const rows = terminalRows(withOwnBuy(market, 1, 10, 6120, NOW - 5 * 3600), ref, 1, ctx);
  expect(rows[0].buy).toMatchObject({ own: null, badge: { kind: 'uex' } });
});
it('flags a likely typo', () => {
  const rows = terminalRows(withOwnBuy(withUexRange(market, 1, 10, 5000, 7000), 1, 10, 61200, NOW - 60), ref, 1, ctx);
  expect(rows[0].buy!.warn).toBe(true);
});
it('lists a commodity known only from my diary', () => {
  expect(terminalRows(withOwnBuy(market, 1, 20, 300, NOW - 60), ref, 1, ctx).map(r => r.commodityId)).toContain(20);
});
it('skips commodities missing from the reference', () => {
  expect(terminalRows(withOwnBuy(market, 1, 999, 300, NOW - 60), ref, 1, ctx).some(r => r.commodityId === 999)).toBe(false);
});
it('badgeText', () => {
  expect(badgeText({ ...est, source: 'own', temp: 'cooling', ageSec: 12600 })).toEqual({ text: 'моя · 3,5 ч', kind: 'cooling' });
  expect(badgeText({ ...est, source: 'own', temp: 'cold', ageSec: 18000 })).toEqual({ text: 'моя · 5 ч', kind: 'cold' });
});
```
- [ ] **Step 2: Запустить** — `npm test -- terminal-rows` — Expected: FAIL.
- [ ] **Step 3: Реализовать `vm/terminal-rows.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Реализовать `app.recordPrice`, `app.suggestions`, `app.refreshSuggestions`.** `recordPrice` пишет наблюдение, перезагружает рынок, делает терминал текущим и обновляет подсказки.
- [ ] **Step 6: Реализовать компоненты**

`QuickEntry`: поля локация (по умолчанию текущая) → код товара → сторона → цена → SCU; `Tab` между полями, `Enter` сохраняет и возвращает фокус в поле кода; товары точки поднимаются в поиске (`boostIds`); сторона по умолчанию — та, которой точка торгует этим товаром, иначе покупка; при неразобранной цене поле подсвечивается и ничего не сохраняется. `TerminalTab`: быстрая строка, таблица (ввод в ячейке сохраняет по `Enter` или потере фокуса, серый текст — `hint`, предупреждение «проверь цифру» при `warn`), блок подсказок с переключателем «Отсюда / Сюда», сортировкой «UEC/ч / ROI», кнопкой «Новый маршрут» и переключателем «искать и рядом». Выбор строки таблицы сужает «Отсюда» до её товара. `RouteList`: точка, плашка источника цены продажи, расстояние, время, число своих рейсов (пока 0), цена с диапазоном, ROI, UEC/ч, худший случай.

- [ ] **Step 7: Проверить**

Run: `npm run check` — Expected: 0 errors. Run: `npm run tauri dev` — Expected: ввод `GOL` → `Enter` → цена → SCU → `Enter` добавляет строку Gold с плашкой «моя · сейчас»; подсказки «Отсюда» показывают до 5 направлений; «Новый маршрут» работает на пустой точке по данным UEX; цена 61200 при диапазоне UEX около 6000 даёт «проверь цифру»; в логе есть `[diary] observation` и `[suggest] from`.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: terminal tab with quick entry and suggestions"`

---

# Этап 4. Рейсы

### Task 13: Рейс и «продать или лететь дальше»

**Files:**
- Create: `src/core/run.ts`, `src/core/sell.ts`
- Test: `tests/core/run.test.ts`, `tests/core/sell.test.ts`

**Interfaces:**
- Consumes: `Run`, `RunEvent`, `CargoLine`, `Market`, `estimate`, `RouteCtx`, `travelSec`.
- Produces:
```ts
// src/core/run.ts
export function cargoOf(events: RunEvent[]): CargoLine[];   // строки с scu > 0; цена — средневзвешенная по всем покупкам товара
export interface RunTotals { invested: number; revenue: number; profit: number; roi: number | null; durationSec: number; uecPerHour: number | null }
export function runTotals(run: Run, events: RunEvent[], now: number): RunTotals;
export function simpleRoute(events: RunEvent[]): { originId: number; destId: number; commodityId: number } | null;
export interface Phases { loadingSec: number; flightSec: number; unloadingSec: number }
export function phases(events: RunEvent[]): Phases | null;
// src/core/sell.ts
export interface SellHere { qty: number; profit: number; roi: number; uecPerHour: number | null }
export interface SellAlternative { destId: number; sell: Estimate; qty: number; expectedProfit: number; extraSec: number | null; expectedUecPerHour: number | null; worstUecPerHour: number | null }
export function sellOrContinue(m: Market, line: CargoLine, hereId: number, actualPrice: number, hereDemand: number | null, elapsedSec: number, ctx: RouteCtx): { here: SellHere; alternatives: SellAlternative[] };
```

Длительность — `max(0, конец − начало)`; конец активного рейса — `now`. При нулевой длительности `uecPerHour = null`, при нулевых вложениях `roi = null`. Альтернатив не больше трёх, по убыванию ожидаемого UEC/час, без времени — в конце; фильтр системы и отсутствие терминала в справочнике учитываются как в задаче 8. Время до альтернативы — своя медиана пары, иначе `travelSec` с `overheadMin`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// run.test.ts
const buy = (ts: number, scu: number, price: number, terminalId = 1, commodityId = 10) => ev({ ts, type: 'buy', terminalId, commodityId, scu, price });
const sell = (ts: number, scu: number, price: number, terminalId = 2, commodityId = 10) => ev({ ts, type: 'sell', terminalId, commodityId, scu, price });
const E = [buy(1000, 300, 6000), buy(1100, 100, 6400), sell(3000, 150, 6900), sell(3400, 250, 7000)];
it('derives cargo with a weighted buy price', () => {
  expect(cargoOf(E.slice(0, 2))).toEqual([{ commodityId: 10, scu: 400, avgBuyPrice: 6100 }]);
  expect(cargoOf(E.slice(0, 3))).toEqual([{ commodityId: 10, scu: 250, avgBuyPrice: 6100 }]);
  expect(cargoOf(E)).toEqual([]);
});
it('never reports negative cargo', () => expect(cargoOf([buy(1, 400, 6000), sell(2, 500, 7000)])).toEqual([]));
it('totals a finished run', () => {
  const t = runTotals(run({ startedAt: 1000, endedAt: 3400, status: 'done' }), E, 9999);
  expect(t).toMatchObject({ invested: 2_440_000, revenue: 2_785_000, profit: 345_000, durationSec: 2400, uecPerHour: 517_500 });
  expect(t.roi).toBeCloseTo(0.14139, 4);
});
it('uses now for an active run', () => expect(runTotals(run({ startedAt: 1000, endedAt: null }), E.slice(0, 2), 2200).durationSec).toBe(1200));
it('survives zero and negative duration and zero investment', () => {
  expect(runTotals(run({ startedAt: 1000, endedAt: 1000 }), E, 0)).toMatchObject({ durationSec: 0, uecPerHour: null });
  expect(runTotals(run({ startedAt: 1000, endedAt: 900 }), E, 0)).toMatchObject({ durationSec: 0, uecPerHour: null });
  expect(runTotals(run({ startedAt: 1000, endedAt: 2000 }), [], 0)).toMatchObject({ invested: 0, roi: null });
});
it('recognises a simple route', () => {
  expect(simpleRoute(E)).toEqual({ originId: 1, destId: 2, commodityId: 10 });
  expect(simpleRoute([...E, sell(3500, 1, 1, 3)])).toBeNull();
  expect(simpleRoute([...E, buy(1200, 1, 1, 1, 11)])).toBeNull();
  expect(simpleRoute(E.slice(0, 2))).toBeNull();
});
it('splits phases only with exactly one ordered depart and arrive', () => {
  const marks = [buy(1000, 100, 6000), ev({ ts: 1300, type: 'depart' }), ev({ ts: 2900, type: 'arrive' }), sell(3400, 100, 7000)];
  expect(phases(marks)).toEqual({ loadingSec: 300, flightSec: 1600, unloadingSec: 500 });
  expect(phases(marks.filter(e => e.type !== 'arrive'))).toBeNull();
  expect(phases([...marks, ev({ ts: 1400, type: 'depart' })])).toBeNull();
  expect(phases([marks[0], { ...marks[2], ts: 1200 }, { ...marks[1], ts: 1300 }, marks[3]])).toBeNull();
});
```
```ts
// sell.test.ts — груз: Gold 340 SCU по 6120; стою в C (3), реальная цена 6500, прошло 1200 с; B (2): UEX 6900 (6400–7100); C–B 10 Gm
it('compares selling here with flying on', () => {
  const r = sellOrContinue(market, { commodityId: 10, scu: 340, avgBuyPrice: 6120 }, 3, 6500, null, 1200, ctx);
  expect(r.here).toMatchObject({ qty: 340, profit: 129_200, uecPerHour: 387_600 });
  expect(r.here.roi).toBeCloseTo(0.06209, 4);
  expect(r.alternatives[0]).toMatchObject({ destId: 2, qty: 340, expectedProfit: 265_200, extraSec: 770 });
  expect(Math.round(r.alternatives[0].expectedUecPerHour!)).toBe(484_629);
  expect(Math.round(r.alternatives[0].worstUecPerHour!)).toBe(173_970);
});
it('limits the sale here by demand', () => {
  expect(sellOrContinue(market, line, 3, 6500, 100, 1200, ctx).here).toMatchObject({ qty: 100, profit: 38_000 });
});
it('excludes the current terminal, caps at three, and puts untimed options last', () => {
  const r = sellOrContinue(withManySellers(market), line, 3, 6500, null, 1200, { ...ctx, distances: new Map([[distKey(3, 2), 10]]) });
  expect(r.alternatives).toHaveLength(3);
  expect(r.alternatives.every(a => a.destId !== 3)).toBe(true);
  expect(r.alternatives[0].destId).toBe(2); expect(r.alternatives.at(-1)!.expectedUecPerHour).toBeNull();
});
it('returns no rate for a zero elapsed time', () => expect(sellOrContinue(market, line, 3, 6500, null, 0, ctx).here.uecPerHour).toBeNull());
```
- [ ] **Step 2: Запустить** — `npm test -- run sell` — Expected: FAIL.
- [ ] **Step 3: Реализовать `run.ts` и `sell.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: run accounting and sell-or-continue"`

### Task 14: Репозиторий рейсов и сервис сделок

**Files:**
- Create: `src/data/repo/runs.ts`, `src/data/trade.ts`
- Test: `tests/data/trade.test.ts`

**Interfaces:**
- Consumes: `Db`, `Logger`, `Settings`, `cargoOf`, `addObservation`.
- Produces:
```ts
// src/data/repo/runs.ts
export function getActiveRun(db: Db): Promise<RunWithEvents | null>;
export function listRuns(db: Db): Promise<RunWithEvents[]>;      // новые сверху, события по возрастанию ts, затем id
export function allRecordTimestamps(db: Db): Promise<number[]>;  // ts наблюдений и событий, по возрастанию
// src/data/trade.ts
export class TradeError extends Error { code: 'no_active_run' | 'oversell' | 'no_space' | 'bad_input' }
export interface TradeDeps { db: Db; log: Logger; now: () => number; settings: Settings }
export interface TradeInput { terminalId: number; commodityId: number; scu: number; price: number; knownScu?: number | null }  // knownScu — остаток или спрос на точке
export function recordBuy(d: TradeDeps, t: TradeInput): Promise<RunWithEvents>;
export function recordSell(d: TradeDeps, t: TradeInput): Promise<{ run: RunWithEvents; finished: boolean }>;
export function recordMark(d: TradeDeps, type: 'depart' | 'arrive'): Promise<void>;
export function loseCargo(d: TradeDeps): Promise<RunWithEvents>;
```

Тексты ошибок (показываются пользователю): `no_active_run` — «Нет активного рейса»; `oversell` — «В трюме только N SCU»; `no_space` — «Свободно только N SCU»; `bad_input` — «Количество и цена должны быть больше нуля». Проверка места выполняется только при `settings.scuCapacity > 0`.

- [ ] **Step 1: Написать падающий тест**

```ts
it('starts a run on the first buy with the ship from settings', async () => {
  const r = await recordBuy(deps, { terminalId: 1, commodityId: 10, scu: 300, price: 6000 });
  expect(r.run).toMatchObject({ status: 'active', startedAt: NOW, scuCapacity: 696, vehicleId: 7, endedAt: null });
  expect(r.events).toHaveLength(1);
});
it('adds further buys to the same run', async () => {
  await recordBuy(deps, buyIn(300)); clock.advance(100);
  const r = await recordBuy(deps, buyIn(100, 6400));
  expect(r.events).toHaveLength(2); expect(r.run.startedAt).toBe(NOW);
});
it('writes an observation for every trade, carrying stock or demand but not the traded amount', async () => {
  await recordBuy(deps, { ...buyIn(300), knownScu: 340 }); await recordSell(deps, sellIn(100, 6900));
  const o = await latestObservations(db);
  expect(o.find(x => x.side === 'buy')).toMatchObject({ terminalId: 1, price: 6000, scu: 340 });
  expect(o.find(x => x.side === 'sell')).toMatchObject({ terminalId: 2, price: 6900, scu: null });
});
it('finishes the run when the hold is empty', async () => {
  await recordBuy(deps, buyIn(300)); clock.advance(2000);
  expect((await recordSell(deps, sellIn(100, 6900))).finished).toBe(false);
  clock.advance(400);
  const r = await recordSell(deps, sellIn(200, 7000));
  expect(r.finished).toBe(true); expect(r.run.run).toMatchObject({ status: 'done', endedAt: NOW + 2400 });
  expect(await getActiveRun(db)).toBeNull();
});
it('rejects overselling without writing anything', async () => {
  await recordBuy(deps, buyIn(300));
  await expect(recordSell(deps, sellIn(301, 7000))).rejects.toMatchObject({ code: 'oversell', message: 'В трюме только 300 SCU' });
  expect((await getActiveRun(db))!.events).toHaveLength(1);
});
it('rejects selling a commodity that is not on board and selling without a run', async () => {
  await expect(recordSell(deps, sellIn(1, 7000))).rejects.toMatchObject({ code: 'no_active_run' });
  await recordBuy(deps, buyIn(300));
  await expect(recordSell(deps, { ...sellIn(1, 7000), commodityId: 11 })).rejects.toMatchObject({ code: 'oversell' });
});
it('rejects buying beyond free space, unless capacity is unset', async () => {
  await recordBuy(deps, buyIn(600));
  await expect(recordBuy(deps, buyIn(97))).rejects.toMatchObject({ code: 'no_space', message: 'Свободно только 96 SCU' });
  const loose = { ...deps, settings: { ...deps.settings, scuCapacity: 0 } };
  await expect(recordBuy(loose, buyIn(5000))).resolves.toBeDefined();
});
it.each([[0, 6000], [-1, 6000], [10, 0]])('rejects scu %i at price %i', async (scu, price) => {
  await expect(recordBuy(deps, { terminalId: 1, commodityId: 10, scu, price })).rejects.toMatchObject({ code: 'bad_input' });
});
it('records marks only inside a run', async () => {
  await expect(recordMark(deps, 'depart')).rejects.toMatchObject({ code: 'no_active_run' });
  await recordBuy(deps, buyIn(300)); await recordMark(deps, 'depart');
  expect((await getActiveRun(db))!.events.at(-1)).toMatchObject({ type: 'depart', terminalId: null });
});
it('closes a lost run and frees the slot', async () => {
  await recordBuy(deps, buyIn(300)); clock.advance(500);
  expect((await loseCargo(deps)).run).toMatchObject({ status: 'lost', endedAt: NOW + 500 });
  expect((await recordBuy(deps, buyIn(10))).run.status).toBe('active');
});
it('restores an active run after a restart', async () => {
  await recordBuy(deps, buyIn(300));
  expect((await getActiveRun(db))!.run.startedAt).toBe(NOW);       // таймер считается от значения в базе
});
it('logs start, trades, marks, finish and loss', async () => {
  await recordBuy(deps, buyIn(300)); await recordMark(deps, 'depart'); await recordSell(deps, sellIn(300, 7000));
  const msgs = sink.lines.filter(l => l.line.startsWith('[run]')).map(l => l.line.split(' ')[1]);
  expect(msgs).toEqual(['started', 'buy', 'depart', 'sell', 'finished']);
});
```
- [ ] **Step 2: Запустить** — `npm test -- trade` — Expected: FAIL.
- [ ] **Step 3: Реализовать `runs.ts` и `trade.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: runs repository and trade service"`

### Task 15: Сделки в интерфейсе, вкладка «Рейс», живая полоска

**Files:**
- Create: `src/ui/vm/strip.ts`, `src/ui/tabs/RunTab.svelte`, `src/ui/components/TradeDialog.svelte`, `src/ui/components/SellDecision.svelte`
- Modify: `src/ui/state.svelte.ts`, `src/ui/Strip.svelte`, `src/ui/tabs/TerminalTab.svelte`, `src/ui/components/RouteList.svelte`
- Test: `tests/ui/strip.test.ts`

**Interfaces:**
- Consumes: `recordBuy`, `recordSell`, `recordMark`, `loseCargo`, `getActiveRun`, `cargoOf`, `runTotals`, `sellOrContinue`, `estimate`, `travelSec`, форматтеры.
- Produces:
```ts
// src/ui/vm/strip.ts
export type StripModel =
  | { kind: 'idle'; location: string }
  | { kind: 'run'; timer: string; cargo: string; target: string | null; expect: string | null; rate: string | null };
export function stripModel(active: RunWithEvents | null, m: Market, ref: Reference, s: Settings, ctx: RouteCtx): StripModel;
// добавляется в app
app.activeRun: RunWithEvents | null;
app.flash: string | null;                             // короткое сообщение в полоске на 3 секунды
app.buy(t: TradeInput): Promise<void>;
app.sell(t: TradeInput): Promise<void>;
app.mark(type: 'depart' | 'arrive'): Promise<void>;
app.loseCargo(): Promise<void>;
app.setTarget(terminalId: number | null): Promise<void>;
```

Полоска при рейсе: таймер от `startedAt`; груз — `КОД N SCU`, несколько товаров через запятую; цель — ник терминала из `targetTerminalId`; ожидание — оценка продажи первого товара на цели в виде `ждём 6 900 (6 400–7 100)`, без скобок, когда границы равны цене; темп — `≈ 310k/ч`, где прибыль = Σ `scu × (ожидаемая цена − средняя закупка)` по товарам, у которых есть оценка на цели, а время = `max(прошло, оценка всего маршрута)`. Оценка всего маршрута — своя медиана пары (точка первой покупки → цель), иначе `travelSec`, иначе прошедшее время. `TradeError` показывается текстом в диалоге, а для хоткеев — через `app.flash`. Рейс завершён — цель сбрасывается. Каждый расчёт «продать или лететь дальше» пишется в лог (`sell`, уровень `debug`) со всеми сравниваемыми вариантами: «здесь» и каждая альтернатива с ценой, источником, временем и UEC/час.

- [ ] **Step 1: Написать падающий тест**

```ts
it('is idle without a run', () => {
  expect(stripModel(null, market, ref, { ...s, currentTerminalId: 1 }, ctx)).toEqual({ kind: 'idle', location: 'ARC-L1' });
});
it('shows timer, cargo, target, expectation and rate', () => {
  // куплено 96 SCU Gold по 6120 в точке 1 в момент NOW−872; цель — точка 2: UEX 6900 (6400–7100); 1–2: 59 Gm
  expect(stripModel(active, market, ref, { ...s, targetTerminalId: 2 }, ctx)).toEqual({
    kind: 'run', timer: '14:32', cargo: 'GOLD 96 SCU', target: 'TDD Area 18',
    expect: 'ждём 6 900 (6 400–7 100)', rate: '≈ 266k/ч',     // 96×780 = 74 880 за max(872, 1015) с
  });
});
it('collapses the range for an own price and omits unknown parts', () => {
  expect(stripModel(active, withOwnSell(market, 2, 10, 6840, NOW - 60), ref, { ...s, targetTerminalId: 2 }, ctx))
    .toMatchObject({ expect: 'ждём 6 840' });
  expect(stripModel(active, market, ref, { ...s, targetTerminalId: null }, ctx)).toMatchObject({ target: null, expect: null, rate: null });
  expect(stripModel(active, market, ref, { ...s, targetTerminalId: 777 }, ctx)).toMatchObject({ target: null, expect: null, rate: null });
});
it('lists mixed cargo', () => {
  expect(stripModel(mixedRun, market, ref, s, ctx)).toMatchObject({ cargo: 'GOLD 96 SCU, TITA 40 SCU' });
});
```
- [ ] **Step 2: Запустить** — `npm test -- strip` — Expected: FAIL.
- [ ] **Step 3: Реализовать `vm/strip.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Реализовать действия `app` и подключить хоткеи `depart` / `arrive` к `app.mark`.**
- [ ] **Step 6: Реализовать компоненты**

`TradeDialog`: количество (по умолчанию — предложенный объём для покупки и весь груз товара для продажи) и цена (по умолчанию из строки), `Enter` подтверждает. Кнопки «Купил» и «Продал» в строке таблицы. `SellDecision` — над таблицей, когда в трюме есть товар, по которому на текущей точке есть своя не холодная цена продажи: блок «Здесь сейчас» и до трёх альтернатив с ожидаемым и худшим UEC/ч и дополнительным временем. В `RouteList` — кнопка «Цель» у направления. `RunTab`: груз, таймер, итоги на текущий момент, кнопки «Взлетел», «Прилетел», «Груз потерян» (с подтверждением). `Strip` рисует `stripModel` и `app.flash`.

- [ ] **Step 7: Проверить**

Run: `npm run check` — Expected: 0 errors. Run: `npm run tauri dev` — Expected: «Купил» запускает таймер в полоске; выбор цели показывает ожидание и темп; ввод цены продажи на другой точке показывает «Здесь сейчас» и альтернативы; продажа всего груза завершает рейс; перезапуск приложения посреди рейса сохраняет таймер; `Ctrl+Alt+1` без рейса показывает «Нет активного рейса».

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: trades, run tab and live strip"`

---

# Этап 5. Статистика

### Task 16: Статистика маршрутов и сессий

**Files:**
- Create: `src/core/stats.ts`
- Modify: `src/ui/state.svelte.ts` (заполнение `ownMedian`), `src/ui/components/RouteList.svelte` (число своих рейсов)
- Test: `tests/core/stats.test.ts`

**Interfaces:**
- Consumes: `RunWithEvents`, `runTotals`, `simpleRoute`, `phases`, `pairKey`.
- Produces:
```ts
export interface RouteStat {
  originId: number; destId: number; commodityId: number; runs: number;
  medianDurationSec: number; medianPhases: Phases | null;
  totalProfit: number; avgRoi: number; uecPerHour: number | null;
}
export function routeStats(runs: RunWithEvents[]): RouteStat[];              // только простые со статусом 'done'; по убыванию uecPerHour
export function ownMedianIndex(runs: RunWithEvents[]): Map<string, number>;  // pairKey → медиана длительности по всем товарам
export function ownRunCounts(runs: RunWithEvents[]): Map<string, number>;    // pairKey → число рейсов
export interface Session { startTs: number; endTs: number; runIds: number[]; profit: number; uecPerHour: number | null }
export function sessions(recordTs: number[], runs: RunWithEvents[], gapSec?: number): Session[];   // gapSec = 7200; новые сверху
```

`uecPerHour` маршрута = суммарная прибыль / суммарное время. `medianPhases` — медианы по рейсам, у которых фазы есть; `null`, если таких нет. Рейс относится к сессии, в которую попадает его `startedAt`; в прибыль сессии входят рейсы `done` и `lost`.

- [ ] **Step 1: Написать падающий тест**

```ts
// R1: 1→2 Gold, 1000–3400, прибыль 345 000, ROI 0,14139. R2: 1→2 Gold, 10000–11800, вложено 2 000 000, прибыль 200 000.
// R3: 1→3 Gold, 20000–21000, прибыль 50 000. R4: lost, 12000–12500, вложено 100 000. R5: две точки продажи. R6: active.
it('groups simple finished runs by route', () => {
  const s = routeStats([R1, R2, R3, R4, R5, R6]);
  expect(s).toHaveLength(2);
  expect(s[0]).toMatchObject({ originId: 1, destId: 2, commodityId: 10, runs: 2, medianDurationSec: 2100, totalProfit: 545_000 });
  expect(s[0].avgRoi).toBeCloseTo(0.1207, 4);
  expect(Math.round(s[0].uecPerHour!)).toBe(467_143);
  expect(s[1]).toMatchObject({ destId: 3, runs: 1, uecPerHour: 180_000 });
});
it('takes phase medians only from runs that have marks', () => {
  expect(routeStats([R1, withMarks(R2, 300, 1000, 500)])[0].medianPhases).toEqual({ loadingSec: 300, flightSec: 1000, unloadingSec: 500 });
  expect(routeStats([R1, R2])[0].medianPhases).toBeNull();
});
it('indexes my median time and run count by direction', () => {
  expect(ownMedianIndex([R1, R2, R3]).get(pairKey(1, 2))).toBe(2100);
  expect(ownMedianIndex([R1, R2, R3]).has(pairKey(2, 1))).toBe(false);
  expect(ownRunCounts([R1, R2, R3]).get(pairKey(1, 2))).toBe(2);
});
it('splits sessions on gaps longer than two hours and includes losses', () => {
  const s = sessions([1000, 3400, 10000, 11800, 12000, 12500, 30000], [R1, R2, R4]);
  expect(s).toHaveLength(2);
  expect(s[1]).toMatchObject({ startTs: 1000, endTs: 12500, runIds: [1, 2, 4], profit: 445_000 });
  expect(Math.round(s[1].uecPerHour!)).toBe(139_304);          // 445 000 за 11 500 с
  expect(s[0]).toMatchObject({ startTs: 30000, endTs: 30000, profit: 0, uecPerHour: null });
});
it('keeps one session when the gap is exactly two hours', () => {
  expect(sessions([1000, 8200], [])).toHaveLength(1); expect(sessions([1000, 8201], [])).toHaveLength(2);
});
it('handles no data', () => { expect(routeStats([])).toEqual([]); expect(sessions([], [])).toEqual([]); });
```
- [ ] **Step 2: Запустить** — `npm test -- stats` — Expected: FAIL.
- [ ] **Step 3: Реализовать `src/core/stats.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Подключить.** `app` после загрузки и после каждого завершённого рейса пересчитывает `ownMedian` и `ownRunCounts` из `listRuns` и передаёт их в `SuggestDeps` и `RouteCtx`; `RouteList` показывает «твоих рейсов N».
- [ ] **Step 6: Запустить всё** — `npm test && npm run check` — Expected: PASS, 0 errors.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: route and session statistics"`

### Task 17: Вкладка «Маршруты», история и сессии

**Files:**
- Create: `src/ui/vm/stats-rows.ts`, `src/ui/tabs/RoutesTab.svelte`
- Modify: `src/ui/tabs/RunTab.svelte`, `src/ui/state.svelte.ts`
- Test: `tests/ui/stats-rows.test.ts`

**Interfaces:**
- Consumes: `routeStats`, `sessions`, `runTotals`, `simpleRoute`, `listRuns`, `allRecordTimestamps`, форматтеры.
- Produces:
```ts
export interface RouteRow { key: string; route: string; commodity: string; runs: number; time: string; phases: string | null; profit: string; roi: string; rate: string }
export function routeRows(stats: RouteStat[], ref: Reference): RouteRow[];
export interface HistoryRow { runId: number; when: string; title: string; status: 'active' | 'done' | 'lost'; profit: string; roi: string; duration: string; rate: string }
export function historyRows(runs: RunWithEvents[], ref: Reference, now: number): HistoryRow[];
export interface SessionRow { when: string; duration: string; runs: number; profit: string; rate: string }
export function sessionRows(list: Session[]): SessionRow[];
// добавляется в app
app.history: { runs: RunWithEvents[]; recordTs: number[] };
app.reloadHistory(): Promise<void>;
```

Отсутствующее значение показывается как «—». Терминал или товар, которого нет в справочнике, показывается как `#<id>`. Терминалы подписываются ником. Заголовок рейса в истории: коды товаров через запятую, двоеточие, затем `A → B` для простого рейса или «смешанный рейс».

- [ ] **Step 1: Написать падающий тест**

```ts
it('formats a route row', () => {
  expect(routeRows(routeStats([R1, withMarks(R2, 300, 1000, 500)]), ref)[0]).toEqual({
    key: '1>2:10', route: 'ARC-L1 → TDD Area 18', commodity: 'GOLD', runs: 2, time: '35:00',
    phases: '5:00 · 16:40 · 8:20', profit: '545 000', roi: '12,1%', rate: '467k/ч',
  });
});
it('formats history, including mixed and lost runs', () => {
  const h = historyRows([R5, R4, R1], ref, NOW);
  expect(h[2]).toMatchObject({ title: 'GOLD: ARC-L1 → TDD Area 18', status: 'done', profit: '345 000', roi: '14,1%', duration: '40:00', rate: '518k/ч' });
  expect(h[1]).toMatchObject({ status: 'lost', profit: '-100 000' });
  expect(h[0].title).toBe('GOLD: смешанный рейс');
});
it('falls back to ids for entries missing from the reference', () => {
  expect(routeRows([{ ...stat, originId: 777, commodityId: 999 }], ref)[0]).toMatchObject({ route: '#777 → TDD Area 18', commodity: '#999' });
});
it('formats sessions and empty rates', () => {
  expect(sessionRows([{ startTs: 30000, endTs: 30000, runIds: [], profit: 0, uecPerHour: null }])[0]).toMatchObject({ runs: 0, duration: '0:00', rate: '—' });
});
```
- [ ] **Step 2: Запустить** — `npm test -- stats-rows` — Expected: FAIL.
- [ ] **Step 3: Реализовать `vm/stats-rows.ts`.**
- [ ] **Step 4: Запустить** — Expected: PASS.
- [ ] **Step 5: Реализовать `RoutesTab` (таблица `routeRows`, пустое состояние «Заверши первый рейс — здесь появится твой рейтинг маршрутов») и дополнить `RunTab` разделами «История» и «Сессии».**
- [ ] **Step 6: Проверить** — `npm run check` — Expected: 0 errors. `npm run tauri dev`: после двух завершённых рейсов по одной паре точек во вкладке «Маршруты» одна строка с числом рейсов 2; в «Рейсе» видны история и сессия.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: routes tab, run history and sessions"`

### Task 18: Сборка и проверка в игре

**Files:**
- Create: `README.md`
- Modify: `src-tauri/tauri.conf.json` (версия `0.1.0`, название продукта, иконки)

- [ ] **Step 1: Полный прогон**

Run: `npm test && npm run check && cargo test --manifest-path src-tauri/Cargo.toml` — Expected: всё PASS.

- [ ] **Step 2: Собрать**

Run: `npm run tauri build` — Expected: установщик в `src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 3: Проверить в игре (borderless)** и отметить каждый пункт:

1. Полоска поверх игры, клики проходят сквозь неё.
2. Хоткей панели работает при фокусе в игре; `Esc` возвращает управление без клика.
3. На реальном терминале: ввод трёх цен через быструю строку занимает меньше 30 секунд.
4. «Новый маршрут» даёт до 5 направлений; у каждой цены виден источник и возраст.
5. Полный рейс: «Купил» → `Ctrl+Alt+1` → `Ctrl+Alt+2` → ввод цены → «Продал». Рейс завершён, во вкладке «Маршруты» есть строка с разбивкой по фазам.
6. «Сменил сервер» делает все свои плашки холодными.
7. Отключить сеть и перезапустить: приложение работает, в шапке «UEX недоступен, данные от …».
8. В папке логов по файлу восстанавливается весь рейс: ввод цен, подсказки с трассировкой, сделки, отметки.

- [ ] **Step 4: Написать `README.md`:** что это, требование borderless, установка, хоткеи, где лежат база, резервные копии и логи, как собрать из исходников.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: release 0.1.0"`

---

# Дополнение к плану (2026-10-07)

### Task 19: Таймер количества

Реализует раздел 14.3 спеки. Меняет общий смысл «количества»: в своих наблюдениях `0` — известный ноль, `null` — неизвестно.

**Files:**
- Create: `src/core/stock.ts`
- Modify: `src/core/types.ts`, `src/core/settings.ts`, `src/core/estimate.ts`, `src/core/market.ts`, `src/core/routes.ts` (только `quantity`), `src/data/migrations.ts` (версия 2), `src/data/uex-client.ts`, `src/data/repo/uex-cache.ts`, `src/data/repo/diary.ts`, `src/data/suggest.ts`, `src/ui/vm/terminal-rows.ts`, `tests/helpers/factories.ts`
- Test: `tests/core/stock.test.ts`, и правки в `tests/core/estimate.test.ts`, `tests/core/routes.test.ts`, `tests/data/migrations.test.ts`, `tests/data/uex-client.test.ts`, `tests/data/uex-cache.test.ts`, `tests/data/diary.test.ts`, `tests/data/suggest.test.ts`, `tests/ui/terminal-rows.test.ts`

**Interfaces:**
- Consumes: всё из задач 3, 5–8, 10 и вью-модель таблицы терминала.
- Produces:
```ts
// src/core/types.ts — добавления
export interface UexPrice { /* …как было… */ scuBuyMax: number; scuSellMax: number }   // наибольшее, что видел UEX; 0 — неизвестно
export interface StockStats { maxScu: number | null; ratePerMin: number | null }       // выучено по своему дневнику
export interface StockEstimate {
  scu: number;                 // оценка сейчас
  baseScu: number; baseAgeSec: number;
  ratePerMin: number; rateSource: 'learned' | 'default' | 'none';
  maxScu: number | null;
}
export interface Market { /* …как было… */ stock: Map<string, StockStats> }             // ключ obsKey
export interface Estimate { /* …как было… */ stock: StockEstimate | null }              // не null, когда scu получено из своего наблюдения

// src/core/settings.ts
// Settings.refillFullMin: number;  DEFAULT_SETTINGS.refillFullMin = 75

// src/core/stock.ts
export const MIN_LEARN_GAP_SEC = 120;
export const DEFAULT_REFILL_FULL_MIN = 75;
export function maxSeenScu(history: Array<{ ts: number; scu: number | null }>): number | null;
export function learnRatePerMin(history: Array<{ ts: number; scu: number | null }>): number | null;   // history по возрастанию ts
export function estimateStock(i: { baseScu: number; baseTs: number; now: number; maxScu: number | null; learnedRatePerMin: number | null; refillFullMin: number }): StockEstimate;

// src/core/estimate.ts
export interface EstimateCtx { /* …как было… */ refillFullMin?: number }   // по умолчанию DEFAULT_REFILL_FULL_MIN

// src/core/market.ts
export function buildMarket(prices: UexPrice[], latestObs: Observation[], stock?: Map<string, StockStats>): Market;   // без третьего аргумента — пустая карта

// src/data/repo/diary.ts
export function stockStats(db: Db): Promise<Map<string, StockStats>>;   // по всей истории наблюдений с известным scu

// src/ui/vm/terminal-rows.ts — Cell получает
//   ownScuBase: { scu: number; age: string } | null   // «было 40 · 20 мин»; не null, когда оценка отличается от базы
//   ownScuRate: 'learned' | 'default' | 'none' | null
```

Правила, которых нет в сигнатурах:

- `learnRatePerMin`: пары соседних замеров с известным `scu`, разницей во времени не меньше `MIN_LEARN_GAP_SEC` и ростом количества; скорость пары = прирост / минуты; результат — наибольшая; пар нет — `null`.
- `estimateStock`: `elapsedMin = max(0, now − baseTs) / 60`. Максимум: `maxScu`, но не меньше `baseScu`. Скорость: выученная (`'learned'`); иначе при известном максимуме и `refillFullMin > 0` — `максимум / refillFullMin` (`'default'`); иначе `0` (`'none'`). `scu = floor(min(максимум или ∞, baseScu + скорость × elapsedMin))`.
- `estimate`: количество берётся из своего наблюдения, если оно не холодное и его `scu !== null` (ноль допустим). Тогда `stock = estimateStock(…)`, `scu = stock.scu`. Максимум для оценки — наибольшее из `Market.stock[key].maxScu` и `scuBuyMax` / `scuSellMax` строки UEX (нули игнорируются); если нет ни того ни другого — `null`. Иначе как раньше: количество UEX (`> 0`) или `null`, и `stock = null`.
- `quantity`: неизвестно только `null`. Ноль остатка или спроса даёт объём 0.
- Клиент UEX: `scuBuyMax = scu_buy_max_week`, а если там ноль — `scu_buy_max`; `scuSellMax` — так же по `scu_sell_*`.
- Миграция версии 2: `uex_price` — это кэш, поэтому таблица пересоздаётся с двумя новыми колонками `scu_buy_max`, `scu_sell_max` (`REAL NOT NULL DEFAULT 0`) через `DROP TABLE IF EXISTS` и `CREATE TABLE IF NOT EXISTS`, и удаляется отметка `prices_synced_at`, чтобы цены скачались заново. Все выражения безопасны при повторном запуске.
- `loadMarket` (в `suggest.ts`) передаёт `stockStats(db)` в `buildMarket`; `refillFullMin` из настроек попадает в контекст расчёта.
- Таблица терминала: `ownScu` — оценка сейчас; своё количество известно, если оно не `null`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/core/stock.test.ts
const h = (...p: Array<[number, number | null]>) => p.map(([ts, scu]) => ({ ts, scu }));
it('learns the fastest refill seen between neighbouring readings', () => {
  expect(learnRatePerMin(h([0, 40], [600, 140], [1200, 150]))).toBe(10);       // +100 за 10 мин и +10 за 10 мин
});
it('ignores drops, unknown readings and readings closer than two minutes', () => {
  expect(learnRatePerMin(h([0, 300], [600, 40]))).toBeNull();
  expect(learnRatePerMin(h([0, 40], [600, null], [1200, 100]))).toBeNull();
  expect(learnRatePerMin(h([0, 40], [119, 100]))).toBeNull();
  expect(learnRatePerMin(h([0, 40], [120, 100]))).toBe(30);
  expect(learnRatePerMin([])).toBeNull();
});
it('reports the largest known reading, zero included', () => {
  expect(maxSeenScu(h([0, 40], [1, null], [2, 340]))).toBe(340);
  expect(maxSeenScu(h([0, 0]))).toBe(0);
  expect(maxSeenScu(h([0, null]))).toBeNull();
});
const base = { baseScu: 40, baseTs: 1000, now: 1000 + 20 * 60, maxScu: 340, learnedRatePerMin: null, refillFullMin: 75 };
it('falls back to max / full-refill time while no rate is learned', () => {
  expect(estimateStock(base)).toEqual({ scu: 130, baseScu: 40, baseAgeSec: 1200, ratePerMin: 340 / 75, rateSource: 'default', maxScu: 340 });
});
it('uses the learned rate and never exceeds the maximum', () => {
  expect(estimateStock({ ...base, learnedRatePerMin: 10 })).toMatchObject({ scu: 240, rateSource: 'learned', ratePerMin: 10 });
  expect(estimateStock({ ...base, learnedRatePerMin: 10, now: 1000 + 60 * 60 }).scu).toBe(340);
});
it('keeps the base when nothing is known, and grows without a cap when only the rate is', () => {
  expect(estimateStock({ ...base, maxScu: null })).toMatchObject({ scu: 40, rateSource: 'none', ratePerMin: 0, maxScu: null });
  expect(estimateStock({ ...base, maxScu: null, learnedRatePerMin: 10 }).scu).toBe(240);
});
it('treats a base above the known maximum as the new maximum, and a clock running backwards as no time passed', () => {
  expect(estimateStock({ ...base, baseScu: 400 })).toMatchObject({ scu: 400, maxScu: 400 });
  expect(estimateStock({ ...base, now: 500 })).toMatchObject({ scu: 40, baseAgeSec: 0 });
});
it('starts from a known empty stock', () => {
  expect(estimateStock({ ...base, baseScu: 0, learnedRatePerMin: 10 }).scu).toBe(200);
});
```
```ts
// tests/core/estimate.test.ts — новые и изменённые случаи (терминал 2, товар 10, сторона sell, как в файле)
it('extrapolates my own quantity with the refill timer', () => {
  const m = buildMarket([px(2, 10, { sell: week, scuSell: 500, scuSellMax: 800 })], [own(20, 100)]);
  const e = estimate(m, 2, 10, 'sell', { ...ctx, refillFullMin: 80 })!;      // 800 / 80 = 10 в минуту, прошло 20 минут
  expect(e.scu).toBe(300);
  expect(e.stock).toEqual({ scu: 300, baseScu: 100, baseAgeSec: 1200, ratePerMin: 10, rateSource: 'default', maxScu: 800 });
});
it('prefers the rate and the maximum learned from my own diary', () => {
  const stock = new Map([[obsKey(2, 10, 'sell'), { maxScu: 1000, ratePerMin: 5 }]]);
  const e = estimate(buildMarket([px(2, 10, { sell: week, scuSellMax: 800 })], [own(20, 100)], stock), 2, 10, 'sell', ctx)!;
  expect(e.stock).toMatchObject({ scu: 200, ratePerMin: 5, rateSource: 'learned', maxScu: 1000 });
});
it('treats my own zero as known empty and a missing quantity as unknown', () => {
  const m = (scu: number | null) => buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10, scu)]);
  expect(estimate(m(0), 2, 10, 'sell', ctx)!.stock).toMatchObject({ baseScu: 0 });       // раньше ноль уводил к UEX
  expect(estimate(m(null), 2, 10, 'sell', ctx)).toMatchObject({ scu: 500, stock: null });
});
it('does not extrapolate a cold quantity', () => {
  expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(300, 100)]), 2, 10, 'sell', ctx)).toMatchObject({ scu: 500, stock: null });
});
```
Существующий тест «takes quantity from own when known, else UEX, else null» меняется: случай `m(0, 500)` теперь ожидает оценку от базы 0, а не 500. Остальные ожидания с `toEqual` дополняются полем `stock`.
```ts
// tests/core/routes.test.ts — изменение
it('quantity: a known zero limits, only null is unknown', () => {
  expect(quantity({ freeScu: 696, stockScu: 0, demandScu: null, budget: null, buyPrice: 6120 })).toBe(0);
  expect(quantity({ freeScu: 696, stockScu: null, demandScu: 0, budget: null, buyPrice: 6120 })).toBe(0);
});
```
```ts
// tests/data/diary.test.ts — добавление
it('derives the largest quantity and the fastest refill per terminal, commodity and side', async () => {
  for (const [ts, scu] of [[0, 40], [600, 140], [1200, 150]] as const)
    await addObservation(db, log, { ts, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu });
  await addObservation(db, log, { ts: 0, terminalId: 1, commodityId: 10, side: 'sell', price: 5000, scu: null });
  const s = await stockStats(db);
  expect(s.get(obsKey(1, 10, 'buy'))).toEqual({ maxScu: 150, ratePerMin: 10 });
  expect(s.has(obsKey(1, 10, 'sell'))).toBe(false);
});
```
```ts
// tests/data/migrations.test.ts — изменение и добавление
// версия схемы теперь 2 во всех существующих ожиданиях
it('rebuilds the price cache with the stock maximum columns and forces a price re-sync', async () => {
  const db = testDb(); const log = createLogger(memorySink());
  await migrate(db, log);
  const cols = (await db.select<{ name: string }>('PRAGMA table_info(uex_price)')).map(c => c.name);
  expect(cols).toContain('scu_buy_max'); expect(cols).toContain('scu_sell_max');
  expect(await db.select("SELECT 1 FROM uex_meta WHERE key = 'prices_synced_at'")).toEqual([]);
});
```
```ts
// tests/data/uex-client.test.ts — добавление
it('maps the stock maximum from the week, falling back to all-time', async () => {
  const rows = [{ id_terminal: 1, id_commodity: 2, scu_buy_max_week: 0, scu_buy_max: 900, scu_sell_max_week: 1088, scu_sell_max: 2000 }];
  const [p] = await client({ commodities_prices: { status: 'ok', data: rows } }).prices([1]);
  expect(p.scuBuyMax).toBe(900); expect(p.scuSellMax).toBe(1088);
});
```
```ts
// tests/ui/terminal-rows.test.ts — добавление
it('shows the estimated stock with its base when the timer has moved it', () => {
  // своя покупка 6120, количество 40, двадцать минут назад; максимум UEX 340; refillFullMin 75 → 130
  const rows = terminalRows(marketWithStock, ref, 1, ctx);
  expect(rows[0].buy).toMatchObject({ ownScu: 130, ownScuBase: { scu: 40, age: '20 мин' }, ownScuRate: 'default' });
});
it('shows no base when the estimate equals what I saw', () => {
  expect(terminalRows(market, ref, 1, ctx)[0].buy).toMatchObject({ ownScu: 340, ownScuBase: null });
});
```
Тесты `uex-cache` «round-trips every price field» и `suggest` дополняются новыми полями; в `suggest` добавляется случай: два наблюдения количества в дневнике дают в логе `[suggest]` у закупки `"rateSource":"learned"`.

- [ ] **Step 2: Запустить** — `npm test` — Expected: новые и изменённые тесты падают.
- [ ] **Step 3: Реализовать** в порядке: типы и фабрики → `stock.ts` → миграция 2, клиент, кэш → `diary.stockStats` → `market`, `estimate`, `quantity` → `suggest` → `terminal-rows`. Строка лога `[suggest]` для каждой цены дополняется `stock` (если есть).
- [ ] **Step 4: Запустить** — `npm test && npm run check` — Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: stock refill timer"`

### Task 20: Управление мышью вместо хоткеев

Реализует раздел 14.4 спеки поверх готовой задачи 2. Черновой образец низкоуровневого перехвата есть в ветке `spike/input-probe` (файл `src-tauri/src/probe.rs`) — оттуда берётся только знание, как ставить перехват и поток с циклом сообщений; сам диагностический код в основную ветку не переносится.

**Files:**
- Create: `src-tauri/src/keys.rs`, `src-tauri/src/input_hook.rs`, `src/platform/triggers.ts`
- Delete: `src/platform/hotkeys.ts`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/logging.rs`, `src-tauri/Cargo.toml` (убрать `tauri-plugin-global-shortcut`), `src-tauri/capabilities/default.json`, `package.json` (убрать `@tauri-apps/plugin-global-shortcut`), `src/platform/window.ts`, `src/core/layout.ts`, `src/core/settings.ts`, `src/ui/App.svelte`
- Test: `tests/core/layout.test.ts`, Rust-тесты в `keys.rs` и `input_hook.rs`

**Interfaces:**
- Consumes: `Logger`, `setMode`, `watchFocus`, команды `remember_foreground` / `restore_foreground` (задача 2).
- Produces:
```ts
// src/core/layout.ts
export const STRIP_SIZE: Size = { width: 260, height: 36 };          // было 520×32
export function panelSideFor(corner: Corner): 'left' | 'right';      // левые углы → 'left', правые → 'right'

// src/core/settings.ts — изменения
// hotkeyPanel, hotkeyDepart, hotkeyArrive: по умолчанию '' (не назначено)
// stripCorner: по умолчанию 'top-right'
// поле panelSide удаляется: сторона панели следует из угла плашки

// src/platform/window.ts
export interface WindowLayout { panelWidth: number; stripCorner: Corner; showStrip: boolean; opacity: number }
// setMode('strip'): окно кликабельно, фокус не берёт; setMode('panel'): сторона = panelSideFor(stripCorner)
// геометрия считается от ОСНОВНОГО монитора (primaryMonitor, при null — currentMonitor)

// src/platform/triggers.ts
export type TriggerName = 'panel' | 'depart' | 'arrive';
export function bindTriggers(keys: Record<TriggerName, string>, handlers: Record<TriggerName, () => void>, log: Logger): Promise<Record<TriggerName, string | null>>;
// '' — клавиша не назначена, результат null; строка в результате — текст ошибки разбора
```
```rust
// src-tauri/src/keys.rs
pub struct KeyCombo { pub vk: u32, pub ctrl: bool, pub alt: bool, pub shift: bool }
pub fn parse_key(text: &str) -> Result<KeyCombo, String>;   // "F8", "ScrollLock", "Pause", "Insert", "Ctrl+Alt+T", "Shift+F9"

// src-tauri/src/input_hook.rs
// команда: set_trigger_keys(panel: String, depart: String, arrive: String) -> Result<Vec<Option<String>>, String>
//   пустая строка — не назначено; для каждой из трёх — None или текст ошибки разбора
// событие: "input://trigger" с полезной нагрузкой { "name": "panel" | "depart" | "arrive" }
pub fn matches(combo: &KeyCombo, vk: u32, ctrl: bool, alt: bool, shift: bool) -> bool;
```

Правила:

- Перехват ставится, только если назначена хотя бы одна клавиша, и снимается, когда не осталась ни одна. Он живёт в своём потоке с циклом сообщений.
- Процедура перехвата сравнивает нажатие только с назначенными сочетаниями. Для любой другой клавиши она ничего не читает, не сохраняет и не пишет в лог. Она всегда возвращает `CallNextHookEx` и никогда не «съедает» нажатие. Срабатывает только на нажатие, автоповтор игнорируется.
- Модификаторы должны совпадать точно: `F8` не срабатывает при зажатом `Ctrl`.
- Допустимые клавиши: `F1`–`F24`, `ScrollLock`, `Pause`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, буквы и цифры (только с `Ctrl` и/или `Alt`). Одна буква или цифра без модификатора — ошибка «нужен Ctrl или Alt».
- Плашка — кнопка: клик открывает панель. В режиме плашки окно некликабельным не делается (`setIgnoreCursorEvents(false)`), `setFocusable(false)` остаётся.
- Панель сворачивается, когда окно теряет фокус в режиме панели (причина в логе — `focus lost`), и в этом случае `restore_foreground` не вызывается. По `Esc` и по крестику — сворачивается и `restore_foreground` вызывается.
- Если рядом с exe лежит файл `portable.flag`, добавляется вторая цель лога — файл `sc-trade.log` в папке exe.
- В лог пишется: какие клавиши назначены (или что ни одна), установка и снятие перехвата, каждое срабатывание (имя триггера, не клавиша), монитор, на который поставлено окно.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/core/layout.test.ts — изменения
it('strip is a small corner badge', () => {
  expect(stripRect(m, 'top-right')).toEqual({ x: 1644, y: 16, width: 260, height: 36 });      // 1920 − 260 − 16
  expect(stripRect(m, 'top-left')).toEqual({ x: 16, y: 16, width: 260, height: 36 });
  expect(stripRect(m, 'bottom-right')).toEqual({ x: 1644, y: 1028, width: 260, height: 36 }); // 1080 − 36 − 16
});
it('the panel opens on the side of the strip', () => {
  expect(panelSideFor('top-left')).toBe('left'); expect(panelSideFor('bottom-left')).toBe('left');
  expect(panelSideFor('top-right')).toBe('right'); expect(panelSideFor('bottom-right')).toBe('right');
});
```
```rust
// src-tauri/src/keys.rs
#[test] fn parses_function_and_named_keys() {
    assert_eq!(parse_key("F8").unwrap(), KeyCombo { vk: 0x77, ctrl: false, alt: false, shift: false });
    assert_eq!(parse_key("ScrollLock").unwrap().vk, 0x91);
    assert_eq!(parse_key("Pause").unwrap().vk, 0x13);
}
#[test] fn parses_modifiers_in_any_order_and_case() {
    let k = parse_key("alt+CTRL+t").unwrap();
    assert_eq!((k.vk, k.ctrl, k.alt, k.shift), (0x54, true, true, false));
    assert!(parse_key("Shift+F9").unwrap().shift);
}
#[test] fn rejects_bare_letters_unknown_keys_and_garbage() {
    assert!(parse_key("T").is_err()); assert!(parse_key("5").is_err());
    assert!(parse_key("Ctrl+").is_err()); assert!(parse_key("Banana").is_err()); assert!(parse_key("Ctrl+Alt").is_err());
}
// src-tauri/src/input_hook.rs
#[test] fn matches_only_the_exact_combination() {
    let f8 = parse_key("F8").unwrap();
    assert!(matches(&f8, 0x77, false, false, false));
    assert!(!matches(&f8, 0x77, true, false, false));   // лишний модификатор
    assert!(!matches(&f8, 0x78, false, false, false));  // другая клавиша
    let cat = parse_key("Ctrl+Alt+T").unwrap();
    assert!(matches(&cat, 0x54, true, true, false)); assert!(!matches(&cat, 0x54, true, false, false));
}
```

- [ ] **Step 2: Запустить** — `npm test -- layout` и `cargo test --manifest-path src-tauri/Cargo.toml` — Expected: FAIL.
- [ ] **Step 3: Реализовать `layout.ts`, `keys.rs`, `input_hook.rs`; подключить команду и событие в `lib.rs`; убрать плагин глобальных хоткеев из `Cargo.toml`, `package.json`, `lib.rs` и `capabilities`; добавить цель лога для `portable.flag`.**
- [ ] **Step 4: Реализовать `triggers.ts`, изменить `window.ts` и `settings.ts`, удалить `hotkeys.ts`.** `bindTriggers` вызывает `set_trigger_keys` и слушает `input://trigger`.
- [ ] **Step 5: Переделать `App.svelte`:** плашка — кнопка с текстом «SC Trade» (клик открывает панель); в панели — заглушка с полем ввода и крестиком; панель сворачивается при потере фокуса; клавиши берутся из `DEFAULT_SETTINGS` (все пустые), для ручной проверки можно временно задать `F8`.
- [ ] **Step 6: Запустить** — `npm test`, `npm run check`, `cargo test`, `cargo clippy` — Expected: PASS, 0 errors.
- [ ] **Step 7: Собрать и проверить без игры**

Run: `npm run tauri build -- --debug --no-bundle`. Положить рядом с exe пустой `portable.flag`, запустить, по файлу `sc-trade.log` рядом с exe убедиться: окно поставлено на основной монитор, плашка кликабельна и не берёт фокус, клавиши не назначены и перехват не установлен. Завершить процесс. Ввод с клавиатуры и мыши не автоматизировать.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: mouse-first overlay — clickable strip, optional low-level key triggers"`

### Task 21: Сторона продажи — это склад покупателя

Реализует раздел 14.5 спеки. Исправляет ошибку модели: количество на стороне продажи считалось спросом и ограничивало объём рейса; на деле это запас товара у покупателя, и ноль там — лучший случай, а не запрет.

**Files:**
- Modify: `src/core/routes.ts`, `src/core/estimate.ts`, `src/core/sell.ts`, `src/data/trade.ts`, `src/ui/vm/terminal-rows.ts`
- Test: правки в `tests/core/routes.test.ts`, `tests/core/estimate.test.ts`, `tests/core/sell.test.ts`, `tests/data/trade.test.ts`, `tests/data/suggest.test.ts`, `tests/ui/terminal-rows.test.ts`, `tests/ui/strip.test.ts` и в помощниках `tests/helpers/*.ts`, где это нужно

**Interfaces:**
- Consumes: всё из задач 7, 8, 13, 14, 19.
- Produces (изменения существующих сигнатур):
```ts
// src/core/routes.ts
export function quantity(i: { freeScu: number; stockScu: number | null; budget: number | null; buyPrice: number }): number;   // поле demandScu удалено

// src/core/sell.ts
export function sellOrContinue(m: Market, line: CargoLine, hereId: number, actualPrice: number, elapsedSec: number, ctx: RouteCtx): { here: SellHere; alternatives: SellAlternative[] };   // параметр hereDemand удалён
// SellHere.qty и SellAlternative.qty всегда равны line.scu

// src/core/estimate.ts — для side === 'sell':
//   scu   = количество из своего не холодного наблюдения как записано (ноль допустим), иначе scuSell из UEX (> 0), иначе null
//   stock = null всегда (таймер количества только для 'buy')

// src/data/trade.ts
// recordSell с knownScu: наблюдение получает scu = knownScu + проданное; без knownScu — null
```

Правила:

- `RouteTrace.dropped.zeroQty` теперь возможен только из-за нулевого остатка на закупке, нулевого свободного места или бюджета.
- `RouteOption.sell.scu` остаётся в данных как справка о складе покупателя и ни на что не влияет.
- В таблице терминала на стороне продажи `ownScu` — записанное значение, `ownScuBase` и `ownScuRate` — `null`.
- Строка лога `[suggest]` по-прежнему содержит количество на стороне продажи.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/core/routes.test.ts
it('quantity is the smallest of free space, stock at the origin and budget', () => {
  expect(quantity({ freeScu: 696, stockScu: 340, budget: null, buyPrice: 6120 })).toBe(340);
  expect(quantity({ freeScu: 696, stockScu: null, budget: 1_000_000, buyPrice: 6120 })).toBe(163);
  expect(quantity({ freeScu: 696, stockScu: 0, budget: null, buyPrice: 6120 })).toBe(0);
});
it('an empty buyer is the best case, not a blocker', () => {
  // покупатель C (3): своё наблюдение продажи 6840 с количеством 0 («нет в наличии»)
  const r = routesFrom(withOwnSellScu(market, 3, 10, 0), [1], 1, ctx);
  expect(r.options.find(o => o.destId === 3)).toMatchObject({ qty: 340, profit: 244800 });
  expect(r.trace.dropped.zeroQty).toBe(0);
});
it('the buyer inventory reported by UEX does not limit the load', () => {
  expect(routesFrom(withUexSellScu(market, 2, 10, 4), [1], 1, ctx).options.find(o => o.destId === 2)!.qty).toBe(340);
});
```
```ts
// tests/core/estimate.test.ts — сторона sell
it('reports the buyer inventory as recorded, without the refill timer', () => {
  const m = buildMarket([px(2, 10, { sell: week, scuSell: 500, scuSellMax: 800 })], [own(20, 100)]);
  expect(estimate(m, 2, 10, 'sell', ctx)).toMatchObject({ scu: 100, stock: null });
});
it('keeps a recorded zero on the sell side', () => {
  expect(estimate(buildMarket([px(2, 10, { sell: week, scuSell: 500 })], [own(10, 0)]), 2, 10, 'sell', ctx)).toMatchObject({ scu: 0, stock: null });
});
```
Существующие тесты таймера количества на стороне `sell` переносятся на сторону `buy` (с `scuBuy` / `scuBuyMax`), их числа не меняются.
```ts
// tests/core/sell.test.ts
it('compares the whole cargo regardless of the inventory shown at either terminal', () => {
  const r = sellOrContinue(withOwnSellScu(market, 2, 10, 0), line, 3, 6500, 1200, ctx);
  expect(r.here.qty).toBe(340);
  expect(r.alternatives[0]).toMatchObject({ destId: 2, qty: 340, expectedProfit: 265_200 });
});
```
Тесты, которые ограничивали объём спросом («limits the sale here by demand», ограничение альтернативы спросом), удаляются.
```ts
// tests/data/trade.test.ts
it('a sale records the buyer inventory after the sale', async () => {
  await recordBuy(deps, buyIn(300));
  await recordSell(deps, { ...sellIn(100, 6900), knownScu: 250 });
  expect((await latestObservations(db)).find(o => o.side === 'sell')).toMatchObject({ scu: 350 });
});
```
Прежние ожидания `150` и `0` для продажи с `knownScu` заменяются на сумму.
```ts
// tests/ui/terminal-rows.test.ts
it('shows the buyer inventory on the sell side without an estimate', () => {
  const rows = terminalRows(withOwnSellScu(market, 1, 10, 3048), ref, 1, ctx);
  expect(rows.find(r => r.commodityId === 10)!.sell).toMatchObject({ ownScu: 3048, ownScuBase: null, ownScuRate: null });
});
```

- [ ] **Step 2: Запустить** — `npm test` — Expected: новые и изменённые тесты падают, `npm run check` показывает ошибки типов в местах вызова `quantity` и `sellOrContinue`.
- [ ] **Step 3: Реализовать** изменения в `routes.ts`, `estimate.ts`, `sell.ts`, `trade.ts`, `terminal-rows.ts`; поправить все места вызова и помощники тестов.
- [ ] **Step 4: Запустить** — `npm test && npm run check` — Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix: the sell-side quantity is the buyer inventory, not demand"`

### Task 23: Количество и цена — независимые замеры

Реализует раздел 14.6 спеки. Сейчас количество берётся из того же наблюдения, что и цена, поэтому правка одной только цены (наблюдение без количества) стирает базу для таймера запаса. Заодно оценка начинает сообщать, известен ли возраст данных UEX.

**Files:**
- Modify: `src/core/types.ts`, `src/core/market.ts`, `src/core/estimate.ts`, `src/data/repo/diary.ts`, `src/data/suggest.ts`, `src/ui/vm/terminal-rows.ts`, `src/ui/vm/route-rows.ts`
- Test: правки и добавления в `tests/core/market.test.ts`, `tests/core/estimate.test.ts`, `tests/data/diary.test.ts`, `tests/data/suggest.test.ts`, `tests/ui/terminal-rows.test.ts`, `tests/ui/route-rows.test.ts`, и в помощниках `tests/helpers/*.ts`, где это нужно

**Interfaces:**
- Consumes: всё из задач 7, 10, 19, 21 и вью-модели.
- Produces:
```ts
// src/core/types.ts — добавления
export interface QuantityReading { terminalId: number; commodityId: number; side: Side; ts: number; scu: number }
export interface Market { /* …как было… */ ownScu: Map<string, { ts: number; scu: number }> }   // obsKey → последний свой замер с количеством
export interface Estimate { /* …как было… */ ageKnown: boolean; scuOrigin: 'own' | 'uex' | null }

// src/core/market.ts
export function buildMarket(prices: UexPrice[], latestObs: Observation[], stock?: Map<string, StockStats>, quantities?: QuantityReading[]): Market;
// без quantities карта ownScu строится из latestObs (наблюдения с scu !== null)

// src/data/repo/diary.ts
export function latestQuantities(db: Db): Promise<QuantityReading[]>;   // по одному на (терминал, товар, сторона): последнее наблюдение с scu IS NOT NULL

// src/ui/vm/terminal-rows.ts
export function badgeText(e: Estimate): { text: string; kind: Temp | 'uex' };   // второй параметр удалён, используется e.ageKnown
```

Правила:

- Цена в оценке по-прежнему берётся из последнего своего наблюдения (или UEX). Количество берётся из `Market.ownScu`: если этот замер не холодный (температура считается по ЕГО времени, «сменил сервер» учитывается) — для стороны `buy` запускается таймер запаса от него, для `sell` значение отдаётся как записано; `scuOrigin = 'own'`. Иначе количество UEX (`> 0`), `scuOrigin = 'uex'`; иначе `null`.
- `stock.baseAgeSec` — возраст замера количества, а не замера цены.
- `ageKnown = false` только когда источник цены — UEX и у строки `dateModified === 0`; во всех остальных случаях `true`.
- `badgeText`: для UEX с `ageKnown === false` текст — просто «UEX».
- Таблица терминала: своё количество показывается, когда `scuOrigin === 'own'`, даже если цена в ячейке взята из UEX (своя цена остыла, а замер количества ещё нет — такого не бывает при равных порогах, но код не должен на это полагаться). Прямого чтения `m.own` для количества больше нет.
- `route-rows.ts` и всё, что строит плашки для вариантов маршрута, берёт текст из `badgeText(e)` без догадок о возрасте.
- `loadMarket` передаёт `latestQuantities(db)` в `buildMarket`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// tests/core/estimate.test.ts — сторона buy, терминал 1, товар 10; now, ctx как в файле
it('keeps the stock timer running after a price-only observation', () => {
  const priceOnly = obs({ id: 2, ts: now - 120, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
  const quantities = [{ terminalId: 1, commodityId: 10, side: 'buy' as const, ts: now - 1200, scu: 40 }];
  const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300, scuBuyMax: 340 })], [priceOnly], undefined, quantities);
  const e = estimate(m, 1, 10, 'buy', { ...ctx, refillFullMin: 75 })!;
  expect(e).toMatchObject({ price: 6120, source: 'own', scu: 130, scuOrigin: 'own' });
  expect(e.stock).toMatchObject({ baseScu: 40, baseAgeSec: 1200 });
});
it('falls back to the UEX quantity when my quantity reading is cold, even with a hot price', () => {
  const priceOnly = obs({ id: 2, ts: now - 120, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
  const quantities = [{ terminalId: 1, commodityId: 10, side: 'buy' as const, ts: now - 5 * 3600, scu: 40 }];
  const m = buildMarket([px(1, 10, { buy: week, scuBuy: 300 })], [priceOnly], undefined, quantities);
  expect(estimate(m, 1, 10, 'buy', ctx)).toMatchObject({ price: 6120, scu: 300, scuOrigin: 'uex', stock: null });
});
it('reports the buyer inventory from the latest quantity reading on the sell side', () => {
  const priceOnly = obs({ id: 2, ts: now - 60, terminalId: 2, commodityId: 10, side: 'sell', price: 6900, scu: null });
  const quantities = [{ terminalId: 2, commodityId: 10, side: 'sell' as const, ts: now - 600, scu: 3048 }];
  expect(estimate(buildMarket([], [priceOnly], undefined, quantities), 2, 10, 'sell', ctx)).toMatchObject({ scu: 3048, scuOrigin: 'own', stock: null });
});
it('says whether the age of a UEX price is known', () => {
  expect(estimate(buildMarket([px(2, 10, { sell: week, dateModified: 0 })], []), 2, 10, 'sell', ctx)).toMatchObject({ source: 'uex', ageKnown: false });
  expect(estimate(buildMarket([px(2, 10, { sell: week, dateModified: now - 3600 })], []), 2, 10, 'sell', ctx)).toMatchObject({ ageKnown: true });
  expect(estimate(buildMarket([], [own(10)]), 2, 10, 'sell', ctx)).toMatchObject({ source: 'own', ageKnown: true });
});
```
```ts
// tests/core/market.test.ts
it('derives quantity readings from the observations when none are passed', () => {
  const m = buildMarket([], [obs({ id: 1, ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 })]);
  expect(m.ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 300 });
});
it('keeps an explicit quantity reading that is older than the latest price observation', () => {
  const m = buildMarket([], [obs({ id: 2, ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null })], undefined,
    [{ terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 300 }]);
  expect(m.ownScu.get(obsKey(1, 10, 'buy'))).toEqual({ ts: 100, scu: 300 });
  expect(m.own.get(obsKey(1, 10, 'buy'))!.price).toBe(6120);
});
```
```ts
// tests/data/diary.test.ts
it('returns the latest observation that carries a quantity, per terminal, commodity and side', async () => {
  await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 300 });
  await addObservation(db, log, { ts: 200, terminalId: 1, commodityId: 10, side: 'buy', price: 6120, scu: null });
  await addObservation(db, log, { ts: 150, terminalId: 1, commodityId: 10, side: 'sell', price: 5000, scu: null });
  expect(await latestQuantities(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 300 }]);
});
it('keeps a recorded zero as a quantity reading', async () => {
  await addObservation(db, log, { ts: 100, terminalId: 1, commodityId: 10, side: 'buy', price: 6000, scu: 0 });
  expect(await latestQuantities(db)).toEqual([{ terminalId: 1, commodityId: 10, side: 'buy', ts: 100, scu: 0 }]);
});
```
```ts
// tests/ui/terminal-rows.test.ts
it('keeps my stock estimate on screen after I correct only the price', () => {
  // замер количества 40 двадцать минут назад, затем наблюдение только с ценой две минуты назад; максимум UEX 340, восстановление 75 мин
  const rows = terminalRows(marketAfterPriceOnlyEdit, ref, 1, ctx);
  expect(rows[0].buy).toMatchObject({ own: 6120, ownScu: 130, ownScuBase: { scu: 40, age: '20 мин' } });
});
it('labels a UEX price of unknown age without an age', () => {
  expect(badgeText({ ...est, source: 'uex', temp: null, ageKnown: false })).toEqual({ text: 'UEX', kind: 'uex' });
});
```
В `tests/ui/route-rows.test.ts` добавляется случай: вариант маршрута с ценой UEX неизвестного возраста получает плашку «UEX» без возраста. В `tests/data/suggest.test.ts` — случай: после наблюдения только с ценой строка лога `[suggest]` у закупки по-прежнему содержит оценку запаса (`"stock"` с прежней базой).

- [ ] **Step 2: Запустить** — `npm test` — Expected: новые тесты падают; `npm run check` показывает ошибки типов там, где создаются `Estimate` и `Market` или вызывается `badgeText` с двумя аргументами.
- [ ] **Step 3: Реализовать** в порядке: типы → `market.ts` → `estimate.ts` → `diary.latestQuantities` → `suggest.loadMarket` → `terminal-rows.ts`, `route-rows.ts`; поправить все места, где создаются `Estimate` / `Market` или вызывается `badgeText`.
- [ ] **Step 4: Запустить** — `npm test && npm run check` — Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "fix: quantity readings are independent of price readings; UEX age may be unknown"`
