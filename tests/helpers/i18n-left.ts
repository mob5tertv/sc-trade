// `npx vite-node tests/helpers/i18n-left.ts [file filter]`: prints what the dictionary test still finds, file by file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readings, sources } from './i18n-scan';

const filter = process.argv[2] ?? '';
const byFile = new Map<string, string[]>();
for (const problem of readings.flatMap((reading) => reading.problems)) {
  const file = problem.slice(0, problem.indexOf(':'));
  if (!file.includes(filter)) continue;
  byFile.set(file, [...(byFile.get(file) ?? []), problem]);
}
const total = [...byFile.values()].reduce((sum, list) => sum + list.length, 0);
for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${list.length}\t${file}`);
  if (filter === '') continue;
  const lines = readFileSync(join(__dirname, '..', '..', file), 'utf8').split(/\r?\n/);
  for (const problem of list) {
    const rest = problem.slice(file.length + 1);
    const at = Number(rest.slice(0, rest.indexOf(' ')));
    console.log(`  ${rest.slice(0, 60)}  |  ${lines[at - 1]?.trim().slice(0, 110)}`);
  }
}
console.log(`${total} left in ${byFile.size} of ${sources.length} files`);
