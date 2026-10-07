import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { appLogDir, join } from '@tauri-apps/api/path';
import {
  getCurrentWindow, LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, primaryMonitor,
} from '@tauri-apps/api/window';
import { debug, error, info } from '@tauri-apps/plugin-log';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import Database from '@tauri-apps/plugin-sql';
import { afterEach, describe, expect, it } from 'vitest';
import { anchoredRect, maxContentSize, toPhysicalRect } from '../../src/core/layout';
import { createLogger, memorySink } from '../../src/data/logger';
import { openTauriDb } from '../../src/platform/tauri-db';
import { tauriFetchJson } from '../../src/platform/tauri-http';
import { applyLogLevel } from '../../src/platform/tauri-logger';
import { bindTriggers } from '../../src/platform/triggers';
import {
  armKeyboard, disarmKeyboard, fitWindow, giveKeyboard, isWindowFocused, moveWindow, setWindowVisible, showWindow,
  takeKeyboard, watchFocus, windowGeometry, type WindowLayout,
} from '../../src/platform/window';
import { logicalSize, parseMonitor } from '../../src/preview/monitor';
import { startPreviewHarness, type PreviewHarness } from '../helpers/preview-fixtures';

let harness: PreviewHarness | undefined;

function start(options: Parameters<typeof startPreviewHarness>[0] = {}): PreviewHarness {
  harness = startPreviewHarness(options);
  return harness;
}

afterEach(() => {
  harness?.dispose();
  harness = undefined;
});

const layout: WindowLayout = { corner: 'top-right', offset: { dx: 16, dy: 16 }, showMini: true, opacity: 0.9 };
const logger = () => createLogger(memorySink());

describe('commands nobody mocks', () => {
  it('fail with the name of the command, and are reported', async () => {
    const { unknown } = start();
    await expect(invoke('plugin:sparkle|explode', { a: 1 })).rejects.toThrow('plugin:sparkle|explode');
    await expect(invoke('made_up_command')).rejects.toThrow('made_up_command');
    expect(unknown).toEqual(['plugin:sparkle|explode', 'made_up_command']);
  });
});

describe('plugin:sql', () => {
  it('answers like tauri-plugin-sql: load gives the path back, execute gives [rows, id], select gives rows', async () => {
    start({ dataset: 'empty' });
    const raw = await invoke<string>('plugin:sql|load', { db: 'sqlite:sctrade.db' });
    expect(raw).toBe('sqlite:sctrade.db');
    expect(await invoke('plugin:sql|execute', { db: raw, query: 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, note TEXT)', values: [] }))
      .toEqual([0, 0]);
    expect(await invoke('plugin:sql|execute', { db: raw, query: 'INSERT INTO t (name, note) VALUES (?, ?)', values: ['a', null] }))
      .toEqual([1, 1]);
    expect(await invoke('plugin:sql|execute', { db: raw, query: 'INSERT INTO t (name) VALUES (?), (?)', values: ['b', 'c'] }))
      .toEqual([2, 3]);
    expect(await invoke('plugin:sql|select', { db: raw, query: 'SELECT id, name, note FROM t WHERE id < ? ORDER BY id', values: [3] }))
      .toEqual([{ id: 1, name: 'a', note: null }, { id: 2, name: 'b', note: null }]);
    expect(await invoke('plugin:sql|close', { db: raw })).toBe(true);
  });

  it('serves the app database layer: the plugin client, then Db, with a failure that names the statement', async () => {
    start({ dataset: 'empty' });
    const db = await openTauriDb(logger());
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v REAL)');
    expect(await db.execute('INSERT INTO t (v) VALUES (?)', [1.5])).toEqual({ rowsAffected: 1, lastInsertId: 1 });
    expect(await db.select('SELECT v FROM t')).toEqual([{ v: 1.5 }]);
    await expect(db.select('SELECT * FROM nothing_here')).rejects.toThrow(/nothing_here/);
  });

  it('gives the database of the dataset, with the real schema', async () => {
    start({ dataset: 'default' });
    const raw = await Database.load('sqlite:sctrade.db');
    const rows = await raw.select<Array<{ user_version: number }>>('PRAGMA user_version');
    expect(rows).toEqual([{ user_version: 2 }]);
    const systems = await raw.select<Array<{ name: string }>>('SELECT name FROM uex_star_system ORDER BY id');
    expect(systems.map((s) => s.name).sort()).toEqual(['Nyx', 'Pyro', 'Stanton']);
  });
});

describe('the window', () => {
  it('takes physical and logical sizes and positions as tauri sends them', async () => {
    const { win } = start({ monitor: parseMonitor('2560x1440@1.5') });
    const window = getCurrentWindow();
    await window.setPosition(new PhysicalPosition(1450, 20));
    await window.setSize(new PhysicalSize(470, 1080));
    expect(win.snapshot()).toMatchObject({ position: { x: 1450, y: 20 }, size: { width: 470, height: 1080 } });

    await window.setPosition(new LogicalPosition(100, 40));
    await window.setSize(new LogicalSize(200, 100));
    expect(win.snapshot()).toMatchObject({ position: { x: 150, y: 60 }, size: { width: 300, height: 150 } });
  });

  it('shows, hides, and keeps the focus and click flags', async () => {
    const { win } = start();
    const window = getCurrentWindow();
    await window.show();
    expect(await window.isVisible()).toBe(true);
    await window.setFocusable(false);
    await window.setIgnoreCursorEvents(true);
    await window.setSkipTaskbar(false);
    expect(win.snapshot()).toMatchObject({ visible: true, focusable: false, ignoreCursorEvents: true, skipTaskbar: false });
    await window.hide();
    expect(win.snapshot().visible).toBe(false);
  });

  it('describes the monitor in physical pixels, with the scale', async () => {
    start({ monitor: parseMonitor('2560x1440@1.5') });
    const monitor = await primaryMonitor();
    expect(monitor?.scaleFactor).toBe(1.5);
    expect(monitor?.size.width).toBe(2560);
    expect(monitor?.size.toLogical(monitor.scaleFactor).height).toBe(960);
    expect(monitor?.position.x).toBe(0);
    expect(monitor?.workArea.size.height).toBe(1440);
  });

  it('places the window by one command that changes the position and the size together', async () => {
    const { win, logged } = start();
    await invoke('place_window', { x: 1450, y: 20, width: 470, height: 300 });
    expect(win.snapshot()).toMatchObject({ position: { x: 1450, y: 20 }, size: { width: 470, height: 300 } });
    expect(logged.filter((line) => line.includes('place_window'))).toHaveLength(1);
  });

  it('refuses to place a window with no area, like the Rust side', async () => {
    const { win } = start();
    await expect(invoke('place_window', { x: 0, y: 0, width: 0, height: 26 })).rejects.toThrow('0x26');
    await expect(invoke('place_window', { x: 0, y: 0, width: 440, height: -1 })).rejects.toThrow('440x-1');
    expect(win.snapshot().size).toEqual({ width: 240, height: 26 });
  });

  it.each(['1920x1080@1', '2560x1440@1', '2560x1440@1.5', '3840x2160@1.25'])(
    'puts the real window layer where anchoredRect and toPhysicalRect say, on %s',
    async (text) => {
      const monitor = parseMonitor(text);
      const { win } = start({ monitor });
      const size = logicalSize(monitor);
      const physical = (corner: 'top-right' | 'bottom-left', content: { width: number; height: number }) =>
        toPhysicalRect(anchoredRect(size, corner, content), { x: 0, y: 0 }, monitor.scale);

      expect(await showWindow(layout, logger())).toEqual(maxContentSize(size));
      // the first show: clickable, out of the taskbar, and the window never takes the focus
      expect(win.snapshot()).toMatchObject({
        visible: true, focusable: false, ignoreCursorEvents: false, skipTaskbar: true, keyboard: 'game',
      });

      const expanded = physical('top-right', { width: 440, height: 612 });
      await fitWindow({ width: 440, height: 612 }, layout, logger());
      expect(win.snapshot()).toMatchObject({
        visible: true, focusable: false,
        position: { x: expanded.x, y: expanded.y }, size: { width: expanded.width, height: expanded.height },
      });

      const mini = physical('bottom-left', { width: 310, height: 26 });
      await fitWindow({ width: 310, height: 26 }, { ...layout, corner: 'bottom-left' }, logger());
      expect(win.snapshot()).toMatchObject({
        position: { x: mini.x, y: mini.y }, size: { width: mini.width, height: mini.height },
      });
    },
  );

  it('stands at the anchor: the corner and the offsets from it, and the corner stays while the size changes', async () => {
    const monitor = parseMonitor('2560x1440@1.5');
    const { win } = start({ monitor });
    const size = logicalSize(monitor);
    const anchor: WindowLayout = { corner: 'bottom-left', offset: { dx: 100, dy: 50 }, showMini: true, opacity: 0.9 };
    await showWindow(anchor, logger());
    for (const content of [{ width: 310, height: 26 }, { width: 440, height: 600 }]) {
      await fitWindow(content, anchor, logger());
      const wanted = toPhysicalRect(anchoredRect(size, 'bottom-left', content, { dx: 100, dy: 50 }), { x: 0, y: 0 }, monitor.scale);
      expect(win.snapshot()).toMatchObject({
        position: { x: wanted.x, y: wanted.y }, size: { width: wanted.width, height: wanted.height },
      });
      // the left edge and the bottom edge are the fixed ones
      expect(win.snapshot().position.x).toBe(150);
      expect(win.snapshot().position.y + win.snapshot().size.height).toBe(1440 - 75);
    }
  });

  it('unfolds a dragged window downward and shifts it onto the screen instead of shrinking it, and folds back to the same place', async () => {
    const monitor = parseMonitor('2560x1440@1');
    const { win } = start({ monitor });
    // what the drag of the log saved: the window of 440x642 was dropped at 101,627, the anchor is its top-left corner
    const anchor: WindowLayout = { corner: 'top-left', offset: { dx: 101, dy: 627 }, showMini: true, opacity: 0.9 };
    const mini = { width: 189, height: 28 };
    const expanded = { width: 440, height: 642 };
    const at = () => ({ ...win.snapshot().position, ...win.snapshot().size });
    await showWindow(anchor, logger());

    await fitWindow(mini, anchor, logger());
    expect(at()).toEqual({ x: 101, y: 627, width: 189, height: 28 }); // the mini line stands where the header was (it was y = 1241)
    await fitWindow(expanded, anchor, logger());
    expect(at()).toEqual({ x: 101, y: 627, width: 440, height: 642 }); // unfolded downward from the same top

    // the mini line is dragged near the bottom edge: the expanded window does not fit below it
    const low: WindowLayout = { ...anchor, offset: { dx: 101, dy: 1400 } };
    await fitWindow(mini, low, logger());
    expect(at()).toEqual({ x: 101, y: 1400, width: 189, height: 28 });
    await fitWindow(expanded, low, logger());
    expect(at()).toEqual({ x: 101, y: 782, width: 440, height: 642 }); // shifted up whole, 16 px from the bottom, not shrunk
    await fitWindow(mini, low, logger());
    expect(at()).toEqual({ x: 101, y: 1400, width: 189, height: 28 }); // folded: the line is back where it was
  });

  it('knows where the window stands, in logical pixels of the monitor', async () => {
    const monitor = parseMonitor('2560x1440@1.5');
    start({ monitor });
    expect(await showWindow(layout, logger())).toEqual(maxContentSize(logicalSize(monitor)));
    await fitWindow({ width: 440, height: 300 }, layout, logger());
    expect(windowGeometry()).toEqual({
      rect: anchoredRect(logicalSize(monitor), 'top-right', { width: 440, height: 300 }),
      monitor: logicalSize(monitor),
    });
  });

  it('moves the window by one command, keeps the size, and does not write a line to the log of the app', async () => {
    const monitor = parseMonitor('2560x1440@1.5');
    const { win, logged } = start({ monitor });
    const sink = memorySink();
    const log = createLogger(sink);
    await showWindow(layout, log);
    await fitWindow({ width: 440, height: 300 }, layout, log);
    const placed = () => logged.filter((line) => line.includes('place_window')).length;
    const before = { lines: sink.lines.length, placed: placed() };

    await moveWindow({ x: 100, y: 200, width: 440, height: 300 }, log);
    const moved = toPhysicalRect({ x: 100, y: 200, width: 440, height: 300 }, { x: 0, y: 0 }, monitor.scale);
    expect(win.snapshot()).toMatchObject({ position: { x: moved.x, y: moved.y }, size: { width: moved.width, height: moved.height } });
    expect(placed()).toBe(before.placed + 1);
    expect(sink.lines.length).toBe(before.lines);
    expect(windowGeometry()?.rect).toEqual({ x: 100, y: 200, width: 440, height: 300 });

    // what stands there is not set a second time
    await moveWindow({ x: 100, y: 200, width: 440, height: 300 }, log);
    expect(placed()).toBe(before.placed + 1);
  });

  it('stays with the game while it is moved: moving takes neither the focus nor the keyboard', async () => {
    const { win, focusEvents } = start();
    await showWindow(layout, logger());
    await fitWindow({ width: 440, height: 300 }, layout, logger());
    await moveWindow({ x: 300, y: 300, width: 440, height: 300 }, logger());
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: false, gameRemembered: 0, focusReturnedToGame: 0 });
    expect(focusEvents).toEqual([]);
  });

  it('cuts content that is bigger than the monitor down to the largest content size', async () => {
    const monitor = parseMonitor('1920x1080@1');
    const { win } = start({ monitor });
    await showWindow(layout, logger());
    await fitWindow({ width: 5000, height: 4000 }, layout, logger());
    expect(win.snapshot()).toMatchObject({ position: { x: 16, y: 16 }, size: { width: 1888, height: 1048 } });
  });

  it('does not set the same rectangle twice, and does not place content that has no size', async () => {
    const { logged } = start();
    await showWindow(layout, logger());
    const placed = () => logged.filter((line) => line.includes('place_window')).length;
    const afterShow = placed();
    await fitWindow({ width: 440, height: 300 }, layout, logger());
    expect(placed()).toBe(afterShow + 1);
    await fitWindow({ width: 440, height: 300 }, layout, logger());
    await fitWindow({ width: 440, height: 300 }, { ...layout, opacity: 0.5 }, logger());
    expect(placed()).toBe(afterShow + 1);
    await fitWindow({ width: 0, height: 0 }, layout, logger());
    expect(placed()).toBe(afterShow + 1);
    await fitWindow({ width: 440, height: 301 }, layout, logger());
    expect(placed()).toBe(afterShow + 2);
  });

  it('says in the log of the app where it put the window', async () => {
    start();
    const sink = memorySink();
    await showWindow(layout, createLogger(sink));
    await fitWindow({ width: 440, height: 300 }, layout, createLogger(sink));
    expect(sink.lines.some((l) => l.line.startsWith('[window] window placed') && l.line.includes('"physical"'))).toBe(true);
  });

  it('leaves the window hidden when the mini bar is off, and shows and hides it on request', async () => {
    const { win } = start();
    await showWindow({ ...layout, showMini: false }, logger());
    expect(win.snapshot()).toMatchObject({ visible: false, focusable: false });
    await setWindowVisible(true, logger());
    expect(win.snapshot().visible).toBe(true);
    await setWindowVisible(false, logger());
    expect(win.snapshot().visible).toBe(false);
  });

  it('closing the window quits: the page is told', async () => {
    const { win } = start();
    await getCurrentWindow().close();
    expect(win.snapshot().closed).toBe(true);
  });
});

describe('the keyboard focus', () => {
  it('stays with the game when the window is shown and fitted: only taking the keyboard changes that', async () => {
    const { win, focusEvents } = start();
    await showWindow(layout, logger());
    await fitWindow({ width: 440, height: 300 }, layout, logger());
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: false, gameRemembered: 0, focusReturnedToGame: 0 });
    expect(focusEvents).toEqual([]);
  });

  /** The player's way to the keyboard: the pointer over a field arms the window, the press activates it, the field takes. */
  async function pressField(win: PreviewHarness['win'], log = logger()): Promise<void> {
    await armKeyboard(log);
    win.pressInside();
    await takeKeyboard(log);
  }

  it('the pointer over a field makes the window activatable and remembers the game; nothing is activated yet', async () => {
    const { win, focusEvents } = start();
    await showWindow(layout, logger());
    await armKeyboard(logger());
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: true, gameRemembered: 1, focusReturnedToGame: 0 });
    expect(focusEvents).toEqual([]);
  });

  it('the pointer leaving the field makes it not activatable again, and hands no focus back: none was taken', async () => {
    const { win, focusEvents } = start();
    await showWindow(layout, logger());
    await armKeyboard(logger());
    await disarmKeyboard(logger());
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: false, gameRemembered: 1, focusReturnedToGame: 0 });
    win.pressInside(); // a click on a button now
    expect(win.snapshot().keyboard).toBe('game');
    expect(focusEvents).toEqual([]);
  });

  it('a window that was hidden while it was armed is shown without the keyboard: it is made not activatable before it is shown', async () => {
    const { win, focusEvents } = start();
    await showWindow(layout, logger());
    await armKeyboard(logger());
    // folded by a key with the mini bar off: the pointer never "left" the field, the window is hidden as it is
    await setWindowVisible(false, logger());
    await setWindowVisible(true, logger());
    expect(win.snapshot()).toMatchObject({ visible: true, focusable: false, keyboard: 'game' });
    expect(focusEvents).toEqual([]);
  });

  it('goes to the window by the press on a field of the armed window and back to the game when it gives it back', async () => {
    const { win, focusEvents, logged } = start();
    await showWindow(layout, logger());

    await armKeyboard(logger());
    win.pressInside();
    expect(win.snapshot()).toMatchObject({ keyboard: 'overlay', focusable: true, gameRemembered: 1 });
    await takeKeyboard(logger());
    // the window was in front already: nothing was asked, and its own window was not remembered as the game
    expect(win.snapshot()).toMatchObject({ keyboard: 'overlay', focusable: true, gameRemembered: 1 });
    expect(logged.filter((line) => line.includes('take_foreground'))).toEqual([
      '[info] [preview] take_foreground: the overlay is the foreground window already (asked: false)',
    ]);
    expect(await invoke('panel_is_foreground')).toBe(true);

    await giveKeyboard(logger(), true);
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: false, focusReturnedToGame: 1 });
    expect(focusEvents).toEqual([true, false]);
  });

  it('a take with no arm before it is refused by a strict Windows: a warning, nothing else is tried, and the next press activates the window', async () => {
    const { win, focusEvents, logged, unknown } = start();
    const sink = memorySink();
    await showWindow(layout, logger());

    await takeKeyboard(createLogger(sink)); // touch, a pen, a press that came before the arm
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: true, gameRemembered: 1 });
    expect(focusEvents).toEqual([]);
    expect(sink.lines.filter((l) => l.line.startsWith('[window] keyboard'))).toEqual([
      expect.objectContaining({ level: 'warn', line: expect.stringContaining('Windows refused to make the window the foreground one') }),
    ]);
    expect(logged.filter((line) => line.includes('take_foreground'))).toEqual([
      '[warn] [preview] take_foreground: a strict Windows refuses, the overlay is not the foreground window (asked: true)',
    ]);
    expect(unknown).toEqual([]); // and no other command was tried to change its mind

    win.pressInside(); // the player presses the field again: the window is activatable, Windows activates it
    expect(win.snapshot().keyboard).toBe('overlay');
    expect(focusEvents).toEqual([true]);
  });

  it('never calls set_focus of Tauri (it sends a key press when Windows refuses): the preview does not even answer it', async () => {
    const { win, unknown } = start();
    await showWindow(layout, logger());
    await pressField(win);
    await giveKeyboard(logger(), true);
    await takeKeyboard(logger());
    await giveKeyboard(logger(), false);
    expect(unknown).toEqual([]);
    await expect(invoke('plugin:window|set_focus', { label: 'main' })).rejects.toThrow('unmocked Tauri command: plugin:window|set_focus');
    expect(unknown).toEqual(['plugin:window|set_focus']);
  });

  it('a take that fails after the window became focusable makes it not focusable again: a plain click must not activate it', async () => {
    const { win } = start();
    await showWindow(layout, logger());
    win.takeForeground = () => {
      throw new Error('the command failed');
    };
    await expect(takeKeyboard(logger())).rejects.toThrow('the command failed');
    expect(win.snapshot()).toMatchObject({ focusable: false, keyboard: 'game' });
  });

  it('a take that fails after the press has activated the window hands the keyboard back: nobody holds it, nobody else would', async () => {
    const { win, focusEvents } = start();
    await showWindow(layout, logger());
    await armKeyboard(logger());
    win.pressInside(); // the window is active now
    win.takeForeground = () => {
      throw new Error('the command failed');
    };
    await expect(takeKeyboard(logger())).rejects.toThrow('the command failed');
    expect(win.snapshot()).toMatchObject({ focusable: false, keyboard: 'game', focusReturnedToGame: 1 });
    expect(focusEvents).toEqual([true, false]);
  });

  it('an arm that fails leaves the window not activatable', async () => {
    const { win } = start();
    await showWindow(layout, logger());
    const setFocusable = win.setFocusable;
    win.setFocusable = (focusable) => {
      if (focusable) throw new Error('the command failed');
      setFocusable(focusable);
    };
    await expect(armKeyboard(logger())).rejects.toThrow('the command failed');
    expect(win.snapshot()).toMatchObject({ focusable: false, keyboard: 'game' });
  });

  it('answers whether the window is the foreground one: the answer of Windows, asked through our own command', async () => {
    const { win, unknown } = start();
    await showWindow(layout, logger());
    expect(await isWindowFocused(logger())).toBe(false);
    await armKeyboard(logger());
    expect(await isWindowFocused(logger())).toBe(false); // activatable is not active
    win.pressInside();
    expect(await isWindowFocused(logger())).toBe(true);
    win.clickGame();
    expect(await isWindowFocused(logger())).toBe(false);
    expect(unknown).toEqual([]);
  });

  it('does not hand the focus back when the player has already moved on', async () => {
    const { win } = start();
    await showWindow(layout, logger());
    await pressField(win);
    win.clickGame(); // the player clicked the game: it has the focus already
    await giveKeyboard(logger(), false);
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusable: false, gameRemembered: 1, focusReturnedToGame: 0 });
  });

  it('logs the arm and the disarm at debug, every take and give at info, with whether the focus went back', async () => {
    const { win } = start();
    const sink = memorySink();
    const log = createLogger(sink);
    await showWindow(layout, log);
    await armKeyboard(log);
    await disarmKeyboard(log);
    await pressField(win, log);
    await giveKeyboard(log, true);
    const lines = sink.lines.filter((l) => /^\[window\] (armed|disarmed|keyboard)/.test(l.line)).map((l) => `${l.level} ${l.line}`);
    expect(lines).toEqual([
      'debug [window] armed: the pointer is over a field, a press on it activates the window',
      'debug [window] disarmed: the pointer left the field, the window cannot be activated',
      'debug [window] armed: the pointer is over a field, a press on it activates the window',
      'info [window] keyboard taken {"foreground":true}',
      'info [window] keyboard given {"restore":true,"restored":true}',
    ]);
  });

  it('is reported to the app through the same event Tauri uses', async () => {
    const { win } = start();
    const seen: boolean[] = [];
    const stop = await watchFocus(() => 'expanded', logger(), () => seen.push(false));
    await showWindow(layout, logger());
    await pressField(win);
    win.clickGame();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([false]);
    stop();
  });

  it('answers the focus questions with booleans', async () => {
    start();
    expect(await invoke('restore_foreground')).toBe(false);
    expect(await invoke('remember_foreground')).toBeNull();
    expect(await invoke('restore_foreground')).toBe(true);
    expect(await invoke('panel_is_foreground')).toBe(false);
    expect(await invoke('take_foreground')).toBe(false);
  });
});

describe('the rest of the boundary', () => {
  it('sends the log of the app to the lines and keeps its level names', async () => {
    const { logged } = start();
    await debug('[ui] one');
    await info('[ui] two');
    await error('[ui] three');
    expect(logged).toEqual(['[debug] [ui] one', '[info] [ui] two', '[error] [ui] three']);
  });

  it('accepts the Rust log level and the backup and the trigger keys', async () => {
    const { logged } = start();
    const log = logger();
    await applyLogLevel(log, 'info');
    expect(logged.some((line) => line.includes('info'))).toBe(true);
    expect(await invoke('backup_db')).toBeNull();
    const outcome = await bindTriggers({ panel: 'F8', depart: '', arrive: '' }, { panel: () => {}, depart: () => {}, arrive: () => {} }, log);
    expect(outcome).toEqual({ panel: null, depart: null, arrive: null });
  });

  it('says the app is the preview, and gives harmless paths', async () => {
    const { logged } = start();
    expect(await getVersion()).toBe('preview');
    const path = await join(await appLogDir(), 'sctrade.log');
    expect(path.endsWith('sctrade.log')).toBe(true);
    await revealItemInDir(path);
    expect(logged.some((line) => line.includes('reveal'))).toBe(true);
  });

  it('has no network: UEX fails at once, the way an unreachable UEX does', async () => {
    start();
    await expect(tauriFetchJson('https://api.uexcorp.uk/2.0/star_systems')).rejects.toThrow(/star_systems/);
  });
});
