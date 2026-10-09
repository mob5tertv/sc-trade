import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..', '..');
const serverDir = join(root, 'site', 'server');
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** The code of the service, file by file. */
function sources(): Array<{ file: string; text: string }> {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  return walk(join(serverDir, 'src'))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => ({ file: relative(serverDir, file).replaceAll('\\', '/'), text: readFileSync(file, 'utf8') }));
}

describe('the package of the service (site/server)', () => {
  it('has one dependency, busboy, at an exact version — and the root package got none for it', () => {
    const own = json(join(serverDir, 'package.json'));
    expect(own.dependencies).toEqual({ busboy: '1.6.0' });
    expect(own.devDependencies).toBeUndefined();
    expect(own.type).toBe('module');
    expect(own.private).toBe(true);
    const rootPackage = json(join(root, 'package.json'));
    for (const group of ['dependencies', 'devDependencies']) expect(Object.keys(rootPackage[group])).not.toContain('busboy');
  });

  it('has a lock file that pins busboy and the one package busboy needs, both without scripts of their own', () => {
    const lock = json(join(serverDir, 'package-lock.json'));
    expect(lock.lockfileVersion).toBe(3);
    expect(Object.keys(lock.packages).sort()).toEqual(['', 'node_modules/busboy', 'node_modules/streamsearch']);
    for (const name of ['node_modules/busboy', 'node_modules/streamsearch']) {
      const entry = lock.packages[name];
      expect(entry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(entry.integrity).toMatch(/^sha512-/);
      expect(entry.hasInstallScript).toBeUndefined();
      expect(entry.dev).toBeUndefined();
    }
    expect(lock.packages['node_modules/busboy'].version).toBe('1.6.0');
  });

  it('says it runs on Node 18 and newer, which is what Ubuntu 24.04 installs', () => {
    expect(json(join(serverDir, 'package.json')).engines).toEqual({ node: '>=18' });
  });

  it('never commits what npm installed: node_modules is not in the repository', () => {
    expect(readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/)).toContain('node_modules');
  });

  it('is installed (npm run site:server:install): the tests of the service and the build of the site need it', () => {
    expect(existsSync(join(serverDir, 'node_modules', 'busboy', 'package.json')), 'run: npm run site:server:install').toBe(true);
  });
});

describe('the code of the service', () => {
  it('uses nothing that Node 18 does not have', () => {
    const newer = [
      /import\.meta\.(dirname|filename)/,
      /\.(toSorted|toReversed|toSpliced|isWellFormed|toWellFormed)\(/,
      /\b(Object|Map)\.groupBy\(/,
      /Promise\.(withResolvers|try)\(/,
      /Array\.fromAsync\(/,
      /\bURL\.(canParse|parse)\(/,
      /AbortSignal\.any\(/,
      /\bimport\s[^;]*\swith\s*\{/,
      /\b(await )?using\s+\w+\s*=/,
      /\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf)\(/,
      /\bflush:\s*true/,
      /\/[dgimsuy]*v[dgimsuy]*[;,)\s]/, // a regular expression with the flag "v"
      /node:(sqlite|test|sea)/,
      /process\.(loadEnvFile|getBuiltinModule)/,
      /\bstyleText\(|\bparseEnv\(/,
      /\bfs\.glob|\bglob(Sync)?\(/,
      /\bisUtf8\(|\bisAscii\(/, // Node 18.14 has them, 18.0 does not
      /\bparseArgs\(/, // marked experimental in Node 18
    ];
    for (const { file, text } of sources()) for (const pattern of newer) expect(text, `${file}: ${pattern}`).not.toMatch(pattern);
  });

  it('reaches for nothing outside: no process is started, no connection is made, nothing is sent anywhere', () => {
    for (const { file, text } of sources()) {
      expect(text, file).not.toMatch(/child_process|node:(https|http2|dgram|dns|tls|worker_threads|cluster|vm)\b/);
      expect(text, file).not.toMatch(/\bfetch\(|\.connect\(|\beval\(|new Function\(/);
      // mail is postponed: not a stub of it is in the code
      expect(text, file).not.toMatch(/mail|smtp|telegram|discord|webhook/i);
    }
  });

  it('listens on the server itself only: the address is written in the code, not read from the settings', () => {
    const service = sources().find(({ file }) => file === 'src/service.mjs')!.text;
    expect(service).toMatch(/server\.listen\(port, '127\.0\.0\.1'/);
    expect(service.match(/\.listen\(/g)).toHaveLength(1);
    expect(readFileSync(join(serverDir, 'src', 'config.mjs'), 'utf8')).not.toMatch(/'host'|"host"|\bhost:|0\.0\.0\.0/);
  });

  it('writes to its log through one function, which is never handed a thing a sender sent', () => {
    for (const { file, text } of sources()) {
      if (file === 'src/main.mjs' || file === 'src/configure.mjs') continue; // the start and the tool of setup.sh speak before any request
      const calls = text.match(/console\.(log|error|warn|info|debug)\(/g) ?? [];
      expect(calls, file).toEqual([]);
    }
    // the one place a line of the log is made: the time and a text put together by the code
    expect(sources().find(({ file }) => file === 'src/service.mjs')!.text).toMatch(/log = console\.log/);
  });
});
