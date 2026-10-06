/**
 * A queue that runs jobs one after another, in the order they were added, whether the previous job
 * succeeded or failed. Every caller gets the result (or the error) of its own job.
 *
 * Every request to UEX in the application goes through one such queue (see `app.withUex`):
 * the network is throttled, so requests are strictly sequential project-wide.
 */
export interface RequestQueue {
  <T>(job: () => Promise<T>): Promise<T>;
  /** Jobs added and not finished yet, the running one included. */
  pending(): number;
}

export function createRequestQueue(): RequestQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    pending++;
    const turn = tail.then(job);
    tail = turn.then(
      () => undefined,
      () => undefined,
    ).then(() => {
      pending--;
    });
    return turn;
  };
  return Object.assign(enqueue, { pending: () => pending });
}
