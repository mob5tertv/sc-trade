import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The overlay runs next to a game with an anti-cheat: nothing synthetic ever enters the input stream, and the README
// promises that to the player. Tauri's own call that focuses a window broke the promise (when Windows refuses the
// foreground, tao presses and releases Alt through the input stream and tries again), so the window asks Windows itself,
// once, through its own command (src-tauri/src/focus.rs). This test keeps every door to the old way shut:
//  - the Rust side never names a Win32 call that sends input, moves the cursor, joins input queues, switches windows by
//    force or posts messages to windows, and never calls the focus call of tao / Tauri itself (the same code path);
//  - the interface never names the focus call or its command, in whatever spelling;
//  - no capability grants the permission for it: not the capability files, not an inline capability of the configuration.
// The checks are by name and read comments too: a name that must not be used is not written at all in these folders.

const root = resolve(__dirname, '..', '..');

/** Every file under `dir` (relative to the project) whose name ends with one of `extensions` (all files when none), as project paths. */
function filesUnder(dir: string, extensions: readonly string[] = []): string[] {
  if (!existsSync(resolve(root, dir))) return [];
  return readdirSync(resolve(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && (extensions.length === 0 || extensions.some((extension) => entry.name.endsWith(extension))))
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/** What must not be written, and why. */
interface Forbidden {
  what: string;
  pattern: RegExp;
}

/** `path:line: what` for every line of the files that matches a forbidden pattern. */
function offences(files: readonly string[], forbidden: readonly Forbidden[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    readFileSync(resolve(root, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const { what, pattern } of forbidden) if (pattern.test(line)) found.push(`${file}:${i + 1}: ${what}`);
    });
  }
  return found;
}

const matchesAny = (forbidden: readonly Forbidden[], line: string): boolean => forbidden.some(({ pattern }) => pattern.test(line));

/** The Rust side. `PostThreadMessageW` to the hook's OWN thread (input_hook.rs) is not `PostMessage` and must stay allowed. */
const RUST_FORBIDDEN: readonly Forbidden[] = [
  { what: 'SendInput (synthetic keys and clicks)', pattern: /SendInput/ },
  { what: 'keybd_event (a synthetic key)', pattern: /keybd_event/ },
  { what: 'mouse_event (a synthetic click)', pattern: /mouse_event/ },
  { what: 'AttachThreadInput (joins the input queue of another thread)', pattern: /AttachThreadInput/ },
  { what: 'SwitchToThisWindow (forces the foreground)', pattern: /SwitchToThisWindow/ },
  { what: 'SetCursorPos (moves the cursor)', pattern: /SetCursorPos/ },
  { what: 'PostMessage (posts a message to a window)', pattern: /\bPostMessage[AW]?\b/ },
  { what: 'set_focus() of tao / Tauri (it sends a key press when Windows refuses)', pattern: /\bset_focus\s*\(/ },
];

/** The interface: `setFocus`, `set_focus`, `set-focus` in any call form; `setFocusable` (a different thing) is not matched. */
const INTERFACE_FORBIDDEN: readonly Forbidden[] = [
  { what: 'the focus call of the Tauri window, or its command', pattern: /set[-_]?[Ff]ocus\b/ },
];

/** A permission for the focus command, in a capability file or in an inline capability. */
const CAPABILITY_FORBIDDEN: readonly Forbidden[] = [
  { what: 'a permission for the focus command of the window', pattern: /set-focus\b/ },
];

const rustSources = [
  ...filesUnder('src-tauri/src', ['.rs']),
  ...filesUnder('src-tauri/tests', ['.rs']),
  ...(existsSync(resolve(root, 'src-tauri/build.rs')) ? ['src-tauri/build.rs'] : []),
];
const interfaceSources = filesUnder('src', ['.ts', '.svelte', '.js', '.mjs', '.html']);
const capabilityFiles = [
  ...filesUnder('src-tauri/capabilities'),
  // the configuration may carry inline capabilities (`app.security.capabilities`); platform files are `tauri.<platform>.conf.json`
  ...readdirSync(resolve(root, 'src-tauri')).filter((name) => /^tauri(\..+)?\.conf\.json5?$/.test(name)).map((name) => `src-tauri/${name}`).sort(),
];

describe('the patterns of the guard', () => {
  it.each([
    'window.set_focus()?;',
    'let _ = main.set_focus ();',
    'unsafe { SendInput(&inputs, size) };',
    'keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_EXTENDEDKEY, 0);',
    'mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);',
    'AttachThreadInput(ours, theirs, true);',
    'SwitchToThisWindow(hwnd, true);',
    'SetCursorPos(10, 10)?;',
    'PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))',
    'PostMessageA(hwnd, msg, w, l)',
    'use windows::Win32::UI::WindowsAndMessaging::PostMessage;',
  ])('refuse the Rust line: %s', (line) => {
    expect(matchesAny(RUST_FORBIDDEN, line)).toBe(true);
  });

  it.each([
    'unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) }', // the hook stops its own thread
    'unsafe { SetForegroundWindow(handle(hwnd)) }.as_bool()',
    'pub fn set_foreground(hwnd: isize) -> bool {',
    'window.set_focusable(true)',
    'let restored = sys::set_foreground(hwnd);',
  ])('let the Rust line pass: %s', (line) => {
    expect(matchesAny(RUST_FORBIDDEN, line)).toBe(false);
  });

  it.each([
    'await win.setFocus();',
    'await getCurrentWindow()?.setFocus?.();',
    "await win['setFocus']();",
    "await invoke('plugin:window|set_focus', { label: 'main' });",
    'const { setFocus } = getCurrentWindow();',
    "case 'set_focus':",
  ])('refuse the interface line: %s', (line) => {
    expect(matchesAny(INTERFACE_FORBIDDEN, line)).toBe(true);
  });

  it.each([
    'await win.setFocusable(false);',
    "case 'set_focusable':",
    'if (field.isConnected) field.focus();',
    'const focused = await win.isFocused();',
    "log.info('window', 'focus changed', { focused });",
  ])('let the interface line pass: %s', (line) => {
    expect(matchesAny(INTERFACE_FORBIDDEN, line)).toBe(false);
  });

  it.each([
    '    "core:window:allow-set-focus",',
    '"permissions": ["core:default", "core:window:allow-set-focus"]',
    'permissions = ["core:window:allow-set-focus"]',
  ])('refuse the capability line: %s', (line) => {
    expect(matchesAny(CAPABILITY_FORBIDDEN, line)).toBe(true);
  });

  it('let the permission that makes the window activatable pass', () => {
    expect(matchesAny(CAPABILITY_FORBIDDEN, '    "core:window:allow-set-focusable",')).toBe(false);
  });
});

describe('no synthetic input', () => {
  it('reads the sources it is meant to guard', () => {
    expect(rustSources).toContain('src-tauri/src/focus.rs');
    expect(rustSources).toContain('src-tauri/src/lib.rs');
    expect(rustSources).toContain('src-tauri/src/input_hook.rs');
    expect(interfaceSources).toContain('src/platform/window.ts');
    expect(interfaceSources).toContain('src/ui/App.svelte');
    expect(interfaceSources).toContain('src/preview/ipc.ts');
    expect(capabilityFiles).toContain('src-tauri/capabilities/default.json');
    expect(capabilityFiles).toContain('src-tauri/tauri.conf.json');
  });

  it('the Rust side names no call that sends input, moves the cursor or forces the foreground, and never calls set_focus', () => {
    expect(offences(rustSources, RUST_FORBIDDEN)).toEqual([]);
  });

  it('nothing in the interface names the focus call of the Tauri window, in any spelling', () => {
    expect(offences(interfaceSources, INTERFACE_FORBIDDEN)).toEqual([]);
  });

  it('no capability grants the permission to call it: not a capability file, not the configuration', () => {
    expect(offences(capabilityFiles, CAPABILITY_FORBIDDEN)).toEqual([]);
  });

  it('the permission that makes the window activatable for the time of an edit is a different one, and it stays', () => {
    const capabilities = readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8');
    const { permissions } = JSON.parse(capabilities) as { permissions: Array<string | { identifier: string }> };
    const names = permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier));
    expect(names).toContain('core:window:allow-set-focusable');
  });
});
