import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tauriDir = resolve(__dirname, '..', '..', 'src-tauri');

interface Bundle {
  active: boolean;
  targets: string | string[];
  icon: string[];
  publisher?: string;
  shortDescription?: string;
  windows?: { nsis?: { installMode?: string; installerIcon?: string; uninstallerIcon?: string } };
}

const bundle = (JSON.parse(readFileSync(resolve(tauriDir, 'tauri.conf.json'), 'utf8')) as { bundle: Bundle }).bundle;

describe('the installer', () => {
  it('builds NSIS only: "all" would also pull in WiX for an MSI', () => {
    expect(bundle.active).toBe(true);
    expect(bundle.targets).toEqual(['nsis']);
  });

  it('installs for the current user, so it needs no administrator rights', () => {
    expect(bundle.windows?.nsis?.installMode).toBe('currentUser');
  });

  it('says who publishes it and what it is', () => {
    expect(bundle.publisher).toBe('mob5terdisk');
    expect(bundle.shortDescription).toBeTruthy();
  });

  it('lists the icons Windows needs, and every one of them is in the repository', () => {
    expect(bundle.icon).toContain('icons/icon.ico');
    for (const icon of bundle.icon) expect(existsSync(resolve(tauriDir, icon)), icon).toBe(true);
  });

  it('gives the installer and the uninstaller the application icon, not the stock one of NSIS', () => {
    const nsis = bundle.windows?.nsis;
    expect(nsis?.installerIcon).toBe('icons/icon.ico');
    expect(nsis?.uninstallerIcon).toBe('icons/icon.ico');
    expect(existsSync(resolve(tauriDir, nsis?.installerIcon ?? 'missing'))).toBe(true);
  });

  it('keeps the source of the icon next to the generated set', () => {
    expect(existsSync(resolve(tauriDir, 'icons', 'source.svg'))).toBe(true);
  });
});
