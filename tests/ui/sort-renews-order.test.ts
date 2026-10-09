import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// EVERY click on «Товар» or «ROI» of the table is the player's request for an order, and it renews the places that are held while a row is open (`resortedPlaces`),
// also a click that changes neither the key nor the direction of the sort (the default order, «Товар» clicked again after a sale had sent the open row elsewhere).
// So the request is not read from a CHANGE of the sort (that signal does not come then): the table counts the clicks. This reads the component for that wiring; the behaviour
// itself is the scene `open-row-sort` (the sweep runs it).

const table = readFileSync(resolve(__dirname, '..', '..', 'src/ui/components/TerminalTable.svelte'), 'utf8');

describe('the table renews the held order at every click on a sort header', () => {
  it('both headers press through `sortClicked`, which asks the owner and counts the click', () => {
    expect(table).toMatch(/onclick=\{\(\) => sortClicked\(key\)\}/);
    expect(table).not.toMatch(/onclick=\{\(\) => onSort\(key\)\}/);
    expect(table).toMatch(/function sortClicked\(key: TerminalSortKey\): void \{[^}]*onSort\?\.\(key\)[^}]*sortClicks \+= 1/);
  });

  it('takes the places again from the freshly sorted rows when a click was counted, not when the sort changed', () => {
    expect(table).toMatch(/\$effect\(\(\) => \{[^}]*sortClicks[^}]*resortedPlaces\(/);
    expect(table).not.toMatch(/lastSort/);
    expect(table).not.toMatch(/sort\.key\}:\$\{sort\.dir/);
  });
});
