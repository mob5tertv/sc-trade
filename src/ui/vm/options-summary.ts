import type { SuggestProgress } from '../../data/suggest';

/** What the summary of the "Варианты" section is made of. */
export interface OptionsSummaryInput {
  /** The title of the request (`lookupTitle`). */
  title: string;
  /** The answer on screen comes from the distances that were already known; the missing ones are being fetched. */
  preliminary: boolean;
  /** How many of the distances are fetched, while they are. */
  progress: SuggestProgress | null;
}

/**
 * The one line in the header of the "Варианты" section: the title of the request. A preliminary answer is marked
 * with ≈ before it, and while the distances are fetched their count follows: '≈ Куда везти с HUR-L1 · расстояния 7/15'.
 */
export function optionsSummary({ title, preliminary, progress }: OptionsSummaryInput): string {
  if (title === '') return '';
  const mark = preliminary ? '≈ ' : '';
  const count = progress !== null && progress.total > 0 ? ` · расстояния ${progress.done}/${progress.total}` : '';
  return `${mark}${title}${count}`;
}
