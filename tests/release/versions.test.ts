import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(resolve(root, relative), 'utf8');
}

/** The text of one `[section]` of a Cargo.toml, up to the next section header. */
function cargoSection(toml: string, name: string): string {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start < 0) throw new Error(`no [${name}] section in Cargo.toml`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*\[/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

function cargoString(section: string, key: string): string {
  const match = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(section);
  if (!match) throw new Error(`no string ${key} in the section`);
  return match[1];
}

const packageJson = JSON.parse(read('package.json')) as { name: string; version: string };
const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json')) as {
  productName: string;
  version: string;
  identifier: string;
};
const cargoToml = read('src-tauri/Cargo.toml');
const cargoPackage = cargoSection(cargoToml, 'package');

describe('release names and versions', () => {
  it('package.json, Cargo.toml and tauri.conf.json carry the same version', () => {
    const versions = {
      'package.json': packageJson.version,
      'Cargo.toml': cargoString(cargoPackage, 'version'),
      'tauri.conf.json': tauriConf.version,
    };
    // equal to one another, whatever the number is: a version bump touches the three files and not this test
    expect(versions).toEqual({
      'package.json': versions['package.json'],
      'Cargo.toml': versions['package.json'],
      'tauri.conf.json': versions['package.json'],
    });
  });

  it('the version is a semantic version: major.minor.patch, with an optional pre-release', () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it('the product is called SC Trade', () => {
    expect(tauriConf.productName).toBe('SC Trade');
  });

  it('the Cargo package is sc-trade, so the program is sc-trade.exe', () => {
    expect(cargoString(cargoPackage, 'name')).toBe('sc-trade');
    expect(packageJson.name).toBe('sc-trade');
  });

  it('the library is sc_trade_lib and main.rs starts it', () => {
    expect(cargoString(cargoSection(cargoToml, 'lib'), 'name')).toBe('sc_trade_lib');
    expect(read('src-tauri/src/main.rs')).toContain('sc_trade_lib::run();');
  });

  it('the identifier is unchanged: the user database folder depends on it', () => {
    expect(tauriConf.identifier).toBe('com.sctrade.app');
  });
});
