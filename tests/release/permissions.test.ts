import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// What the README and the site promise about the disk and the network rests on the permissions of the window:
// no access to the file system, and one address on the network. A permission added here changes that promise,
// so the list is pinned: a new entry fails this test until the README and the site say what is true.

const CAPABILITIES = join(__dirname, '..', '..', 'src-tauri', 'capabilities');
const UEX = 'https://api.uexcorp.uk/*';

/** The permissions the window may have, as written in the capability file. */
const ALLOWED: ReadonlyArray<RegExp> = [
  /^core:default$/,
  /^core:window:allow-[a-z-]+$/,
  /^log:default$/,
  /^os:default$/,
  /^opener:allow-reveal-item-in-dir$/,
  /^sql:default$/,
  /^sql:allow-execute$/,
];

interface Capability {
  permissions: Array<string | { identifier: string; allow?: Array<{ url?: string }> }>;
}

const files = readdirSync(CAPABILITIES).filter((name) => name.endsWith('.json'));
const capabilities = files.map((name) => JSON.parse(readFileSync(join(CAPABILITIES, name), 'utf8')) as Capability);
const permissions = capabilities.flatMap((capability) => capability.permissions);

describe('the permissions of the window', () => {
  it('are written in one file', () => {
    expect(files).toEqual(['default.json']);
  });

  it('give no access to the file system, to a shell, to dialogs or to an updater', () => {
    const names = permissions.map((entry) => (typeof entry === 'string' ? entry : entry.identifier));
    expect(names.filter((name) => /^(fs|shell|dialog|updater|process|clipboard-manager|global-shortcut):/.test(name))).toEqual([]);
  });

  it('are only the ones the README speaks of', () => {
    const plain = permissions.filter((entry): entry is string => typeof entry === 'string');
    expect(plain.filter((name) => !ALLOWED.some((pattern) => pattern.test(name)))).toEqual([]);
  });

  it('let the window reach one address on the network: the UEX API', () => {
    const scoped = permissions.filter((entry): entry is Exclude<(typeof permissions)[number], string> => typeof entry !== 'string');
    expect(scoped.map((entry) => entry.identifier)).toEqual(['http:default']);
    expect(scoped[0]?.allow).toEqual([{ url: UEX }]);
  });
});
