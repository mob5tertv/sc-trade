export interface Searchable { id: number; code: string; name: string; aliases?: string[] }

const DEFAULT_LIMIT = 8;
const collator = new Intl.Collator('en');

// 0 = code starts with the query, 1 = a word of the name or alias starts with it, 2 = plain substring
type MatchLevel = 0 | 1 | 2;

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function startsAWord(text: string, query: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(query, from);
    if (at === -1) return false;
    if (at === 0 || !isWordChar(text[at - 1])) return true;
    from = at + 1;
  }
}

function matchLevel(item: Searchable, query: string): MatchLevel | null {
  const code = item.code.toLowerCase();
  if (code.startsWith(query)) return 0;
  const texts = [item.name, ...(item.aliases ?? [])].map(t => t.toLowerCase());
  if (texts.some(t => startsAWord(t, query))) return 1;
  if (code.includes(query) || texts.some(t => t.includes(query))) return 2;
  return null;
}

/**
 * Type-ahead search: code prefix, then word prefix in name or alias, then substring.
 * Within a level the `boostIds` come first, then alphabetically by name.
 */
export function search<T extends Searchable>(items: T[], query: string, boostIds?: Set<number>, limit = DEFAULT_LIMIT): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const ranked: { item: T; level: MatchLevel; boosted: boolean }[] = [];
  for (const item of items) {
    const level = matchLevel(item, q);
    if (level !== null) ranked.push({ item, level, boosted: boostIds?.has(item.id) ?? false });
  }
  ranked.sort((a, b) =>
    a.level - b.level
    || Number(b.boosted) - Number(a.boosted)
    || collator.compare(a.item.name, b.item.name)
    || a.item.id - b.item.id);
  return ranked.slice(0, limit).map(r => r.item);
}
