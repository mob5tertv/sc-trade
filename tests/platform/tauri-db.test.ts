import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Build 1.3.0-d closed every database of the application when the demo trip ended: `close()` of tauri-plugin-sql without the name
// of a database closes ALL its pools (commands.rs), the player's own with it, and every write after the demo failed (the author:
// «зашёл в настройку корабля, получил: Не удалось сохранить настройку»). A database is closed by its own name, and only the demo's.

const code = readFileSync(join(__dirname, '..', '..', 'src', 'platform', 'tauri-db.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('the databases of the window', () => {
  it('closes a database only by its own name: a close without one would close the player\'s database too', () => {
    const closes = [...code.matchAll(/\.close\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(closes).toEqual(['raw.path']);
  });
});
