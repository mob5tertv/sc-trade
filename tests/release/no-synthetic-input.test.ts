import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The overlay runs next to a game with an anti-cheat: nothing synthetic ever enters the input stream, and the README
// promises that to the player. Tauri's own `setFocus` broke the promise (when Windows refuses the foreground it presses
// and releases Alt through the input stream and tries again), so the window asks Windows itself, once, through its own
// command. This test keeps both doors shut: the names of the Win32 calls that send input or join input queues must not
// appear in the Rust sources (not even in a comment: the check is by name), nothing in the interface calls
// `setFocus`, and the permission for it is not granted, so a call that slipped in would be refused.

const root = resolve(__dirname, '..', '..');

/** Every file under `dir` (relative to the project) whose name ends with one of `extensions`, as project paths. */
function filesUnder(dir: string, extensions: readonly string[]): string[] {
  return readdirSync(resolve(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .sort();
}

/** `path:line` of every line of the files that matches `pattern`. */
function linesWith(files: readonly string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    readFileSync(resolve(root, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (pattern.test(line)) found.push(`${file}:${i + 1}`);
    });
  }
  return found;
}

const rustSources = filesUnder('src-tauri/src', ['.rs']);
const interfaceSources = filesUnder('src', ['.ts', '.svelte']);

describe('no synthetic input', () => {
  it('reads the sources it is meant to guard', () => {
    expect(rustSources).toContain('src-tauri/src/focus.rs');
    expect(rustSources).toContain('src-tauri/src/lib.rs');
    expect(interfaceSources).toContain('src/platform/window.ts');
    expect(interfaceSources).toContain('src/ui/App.svelte');
  });

  it.each(['SendInput', 'keybd_event', 'mouse_event', 'AttachThreadInput'])(
    'the Rust side never names %s',
    (name) => {
      expect(linesWith(rustSources, new RegExp(name))).toEqual([]);
    },
  );

  it('nothing in the interface calls setFocus of the Tauri window', () => {
    expect(linesWith(interfaceSources, /\.setFocus\(/)).toEqual([]);
  });

  it('the permission to call it is not granted', () => {
    const capabilities = readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8');
    const { permissions } = JSON.parse(capabilities) as { permissions: Array<string | { identifier: string }> };
    const names = permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier));
    expect(names.filter((name) => /set-focus$/.test(name))).toEqual([]);
    // the permission that makes the window activatable for the time of an edit is a different one, and it stays
    expect(names).toContain('core:window:allow-set-focusable');
  });
});
