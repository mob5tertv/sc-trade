import type { Reference, Terminal } from '../../core/types';

// How a terminal is named on the screen: one short name everywhere (the field of the location, the title of the section, the lists, the
// mini line, the sentences of the lookups) and the full official name only in tooltips, where it has always stood.

/**
 * The name players know a terminal by: the nickname ('TDD Area 18'). UEX leaves it empty on rare rows; then the display name
 * and, failing that, the name.
 */
export const terminalName = (t: Terminal): string => t.nickname || t.displayname || t.name;

/** The official name for a tooltip: the display name ('Area 18 TDD', 'ARC-L1 Wide Forest Station'), else the nickname, else the name. */
export const terminalFullName = (t: Terminal): string => t.displayname || t.nickname || t.name;

/** A terminal of the reference by its id, named as everywhere (`terminalName`); the reference may lack it (a game patch), then it is shown by id. */
export function terminalLabel(ref: Reference, id: number): string {
  const t = ref.terminals.get(id);
  return (t && terminalName(t)) || `#${id}`;
}
