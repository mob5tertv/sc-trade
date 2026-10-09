import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELL_MARK, PICKED_MARK, SAVES_ON_LEAVE_MARK } from '../../src/ui/keyboard';

// The keyboard rules (`src/ui/keyboard.ts`) count what the player typed as confirmed by Enter, by Esc or by the cursor
// leaving the field ONLY where the page says that the component saves at those events. The page says it with two marks,
// each written by the component that does the saving:
//  - the table gives the two fields of a cell of an open row the same `data-cell` (it saves the cell at Enter and when the
//    cursor leaves both);
//  - the settings mark the container of their fields (each field is saved at Enter and when it is left).
// A mark that is dropped or renamed on one side only must not pass silently: with the mark of the cell gone the keyboard
// would never go back after a price entered into a row, and a mark that the rules read but no component writes any more
// would be a rule about nothing. This test reads the components themselves, with the names the rules read.
//
// A third mark is of another kind: with `data-picked` a search box says what is picked in it. For the rules the box holds
// that pick and nothing else: what is typed over it is a query, which does not keep the keyboard at the window
// (`entryText` in `vm/keyboard-idle.ts`). With the mark gone a stray key in the empty «Товар» would keep the keyboard for
// good again.

const root = resolve(__dirname, '..', '..');
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8');

/** How many times `mark` is written as an attribute of an element (after a blank, before `=`, a blank or the end of the tag). */
const written = (markup: string, mark: string): number => (markup.match(new RegExp(`\\s${mark}(?=[=\\s>/])`, 'g')) ?? []).length;

describe('the marks by which the page says where Enter, Esc and leaving save a field', () => {
  it('have the names the keyboard rules read', () => {
    expect(CELL_MARK).toBe('data-cell');
    expect(SAVES_ON_LEAVE_MARK).toBe('data-saves-on-leave');
  });

  it('the table marks both fields of a cell of the open row, with the key of the cell', () => {
    const table = source('src/ui/components/TerminalTable.svelte');
    expect(written(table, CELL_MARK)).toBe(2);
    expect((table.match(new RegExp(`\\s${CELL_MARK}=\\{key\\}`, 'g')) ?? []).length).toBe(2);
  });

  it('the settings mark the container of their fields', () => {
    const settings = source('src/ui/SettingsView.svelte');
    expect(written(settings, SAVES_ON_LEAVE_MARK)).toBe(1);
    expect(settings).toMatch(new RegExp(`<div class="groups"[^>]*\\s${SAVES_ON_LEAVE_MARK}[\\s>]`));
  });

  it('no other component claims either mark', () => {
    const others = ['src/ui/components/TradeDialog.svelte', 'src/ui/components/QuickEntry.svelte', 'src/ui/components/SearchBox.svelte'];
    for (const path of others) {
      expect(written(source(path), CELL_MARK), path).toBe(0);
      expect(written(source(path), SAVES_ON_LEAVE_MARK), path).toBe(0);
    }
  });
});

describe('the mark by which a search box says what is picked in it', () => {
  it('has the name the keyboard rules read', () => {
    expect(PICKED_MARK).toBe('data-picked');
  });

  it('is written by the search box on its field, once: the text the box shows when nothing is typed over it (empty: nothing is picked)', () => {
    const box = source('src/ui/components/SearchBox.svelte');
    expect(written(box, PICKED_MARK)).toBe(1);
    expect(box).toMatch(new RegExp(`<input[^>]*\\s${PICKED_MARK}=\\{value \\?\\? ''\\}`));
  });

  it('is written by no other component: a field that is no search box holds what stands in it', () => {
    const others = [
      'src/ui/components/TerminalTable.svelte', 'src/ui/components/TradeDialog.svelte', 'src/ui/components/QuickEntry.svelte',
      'src/ui/SettingsView.svelte', 'src/ui/Header.svelte',
    ];
    for (const path of others) expect(written(source(path), PICKED_MARK), path).toBe(0);
  });

  it('the quick entry gives its commodity box a pick at all times (an empty one before a commodity is chosen), so the box drops a query when it is left', () => {
    // a search box with no value to go back to keeps a query that was typed and not picked when the cursor leaves it; the
    // commodity box of the quick entry must not: the return of the keyboard leaves no stray letter behind
    const entry = source('src/ui/components/QuickEntry.svelte');
    expect(entry).toMatch(/<SearchBox[^>]*\svalue=\{chosen \? `\$\{chosen\.code\} \$\{chosen\.name\}` : ''\}/);
  });
});
