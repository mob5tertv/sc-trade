// Which sections of the expanded window are open. They are kept between runs in one setting
// (`openSections`): the ids of the open sections, separated by commas. Only the state is here; the
// section component and the layout come with the screens.

/** An id has to survive a trip through the comma-separated text. */
const isStorable = (id: string): boolean => id.trim() !== '' && !id.includes(',');

/** The open sections from the stored text. Anything that is not a text, and empty pieces, are ignored. */
export function parseOpenSections(text: string): Set<string> {
  if (typeof text !== 'string') return new Set();
  const ids = text.split(',').map((piece) => piece.trim()).filter((id) => id !== '');
  return new Set(ids);
}

/** The text to store: ids alphabetically, separated by commas, no empty ones. The same set always gives the same text. */
export function serializeOpenSections(open: Set<string>): string {
  return [...open]
    .filter(isStorable)
    .map((id) => id.trim())
    .sort()
    .join(',');
}

/** The set with `id` opened when it was closed and closed when it was open. The given set is not changed. */
export function toggledSection(open: Set<string>, id: string): Set<string> {
  const next = new Set(open);
  if (!isStorable(id)) return next;
  const key = id.trim();
  if (!next.delete(key)) next.add(key);
  return next;
}
