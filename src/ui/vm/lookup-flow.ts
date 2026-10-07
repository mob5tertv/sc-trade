import type { RouteOption } from '../../core/routes';
import type { Suggestion, SuggestProgress, SuggestRun } from '../../data/suggest';

// How one lookup is answered, in two steps (spec 14.8, "Ответ сразу, уточнение потом"):
//  1. at once, from what the local data holds: no UEX request is made, so this step does NOT go through the UEX queue
//     and answers even while a sync is running. The answer is marked preliminary when distances are missing;
//  2. only when distances are missing: ONE run that fetches them inside the UEX queue, with its progress, and replaces
//     the answer. It is never repeated while distances are still missing afterwards (`Suggestion.missing`): UEX may
//     never answer some pair, and the next run is the player's next request.
// The newest request wins: the answer of a request that was superseded is dropped, and a step that has not started
// yet is not started. This module holds the order of things; `AppState.runLookup` holds the state they land in.

/** What the lookup flow needs from its owner. */
export interface LookupFlow {
  /** The suggestion of the request, with the data and the settings as they are when it is called. */
  suggest(run: SuggestRun): Promise<Suggestion>;
  /** The queue of everything that can touch UEX (`app.withUex`). */
  withUex<T>(job: () => Promise<T>): Promise<T>;
  /** Whether no newer lookup was asked since this one began. */
  isNewest(): boolean;
  /** Whether a lookup still makes sense (the cargo space is still set). */
  canRun(): boolean;
  /** What reaches the screen. The flow calls these only while the lookup is the newest one. */
  show: {
    answer(options: RouteOption[], preliminary: boolean): void;
    progress(progress: SuggestProgress): void;
    /** The first step failed: there is no answer to show. */
    failed(err: unknown): void;
    /** The second step failed: the preliminary answer stays on screen. */
    refineFailed(err: unknown): void;
  };
}

export async function answerLookup(flow: LookupFlow): Promise<void> {
  let first: Suggestion;
  try {
    first = await flow.suggest({ distances: 'cached' });
  } catch (err) {
    if (flow.isNewest()) flow.show.failed(err);
    return;
  }
  if (!flow.isNewest()) return;
  flow.show.answer(first.options, first.missing > 0);
  if (first.missing === 0) return;

  try {
    const second = await flow.withUex(async () => {
      // the player may have asked something else, or cleared the cargo space, while this waited for the queue
      if (!flow.isNewest() || !flow.canRun()) return null;
      return flow.suggest({
        distances: 'fetch',
        onProgress: (progress) => {
          if (flow.isNewest()) flow.show.progress(progress);
        },
      });
    });
    if (second !== null && flow.isNewest()) flow.show.answer(second.options, false);
  } catch (err) {
    if (flow.isNewest()) flow.show.refineFailed(err);
  }
}
