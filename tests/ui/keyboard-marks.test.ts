import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELL_MARK, SAVES_ON_LEAVE_MARK } from '../../src/ui/keyboard';

// The keyboard rules (`src/ui/keyboard.ts`) count what the player typed as confirmed by Enter, by Esc or by the cursor
// leaving the field ONLY where the page says that the component saves at those events. The page says it with two marks,
// each written by the component that does the saving:
//  - the table gives the two fields of a cell of an open row the same `data-cell` (it saves the cell at Enter and when the
//    cursor leaves both);
//  - the settings mark the container of their fields (each field is saved at Enter and when it is left).
// A mark that is dropped or renamed on one side only must not pass silently: with the mark of the cell gone the keyboard
// would never go back after a price entered into a row, and a mark that the rules read but no component writes any more
// would be a rule about nothing. This test reads the components themselves, with the names the rules read.

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
