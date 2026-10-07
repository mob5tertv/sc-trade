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
import { panelRect, stripRect, toPhysicalRect } from '../../src/core/layout';
import { createLogger, memorySink } from '../../src/data/logger';
import { openTauriDb } from '../../src/platform/tauri-db';
import { tauriFetchJson } from '../../src/platform/tauri-http';
import { applyLogLevel } from '../../src/platform/tauri-logger';
import { bindTriggers } from '../../src/platform/triggers';
import { setMode, watchFocus, type WindowLayout } from '../../src/platform/window';
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

const layout: WindowLayout = { panelWidth: 470, stripCorner: 'top-right', showStrip: true, opacity: 0.9 };
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

  it.each(['1920x1080@1', '2560x1440@1', '2560x1440@1.5', '3840x2160@1.25'])(
    'puts the real window layer where toPhysicalRect says, on %s',
    async (text) => {
      const monitor = parseMonitor(text);
      const { win } = start({ monitor });
      const size = logicalSize(monitor);

      await setMode('panel', layout, logger());
      const panel = toPhysicalRect(panelRect(size, 'right', 470), { x: 0, y: 0 }, monitor.scale);
      expect(win.snapshot()).toMatchObject({
        visible: true, focusable: true, ignoreCursorEvents: false,
        position: { x: panel.x, y: panel.y }, size: { width: panel.width, height: panel.height },
      });

      await setMode('strip', layout, logger());
      const strip = toPhysicalRect(stripRect(size, 'top-right'), { x: 0, y: 0 }, monitor.scale);
      expect(win.snapshot()).toMatchObject({
        visible: true, focusable: false,
        position: { x: strip.x, y: strip.y }, size: { width: strip.width, height: strip.height },
      });
    },
  );

  it('hides the window when the strip is off', async () => {
    const { win } = start();
    await setMode('strip', { ...layout, showStrip: false }, logger());
    expect(win.snapshot().visible).toBe(false);
  });

  it('closing the window quits: the page is told', async () => {
    const { win } = start();
    await getCurrentWindow().close();
    expect(win.snapshot().closed).toBe(true);
  });
});

describe('the keyboard focus', () => {
  it('goes to the panel when it opens and back to the game when the strip returns', async () => {
    const { win, focusEvents } = start();
    await setMode('strip', layout, logger()); // startup: nothing remembered yet, nothing to give back
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', gameRemembered: 0, focusReturnedToGame: 0 });

    await setMode('panel', layout, logger());
    expect(win.snapshot()).toMatchObject({ keyboard: 'overlay', gameRemembered: 1 });
    expect(await invoke('plugin:window|is_focused', { label: 'main' })).toBe(true);

    await setMode('strip', layout, logger());
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', focusReturnedToGame: 1 });
    expect(focusEvents).toEqual([true, false]);
  });

  it('is reported to the app through the same event Tauri uses', async () => {
    const { win } = start();
    const seen: boolean[] = [];
    const stop = await watchFocus(() => 'panel', logger(), () => seen.push(false));
    await setMode('panel', layout, logger());
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
