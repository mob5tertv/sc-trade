// A deadline around a job that may never answer (a page that stopped responding, a protocol call nobody replies to).

/** The job did not finish in time. */
export class DeadlineError extends Error {}

/**
 * The value of `job`, or a `DeadlineError` naming `what` when it has not finished after `ms`. The timer is cleared as
 * soon as the job is done, so it never holds the process open.
 * @template T
 * @param {Promise<T>} job
 * @param {number} ms
 * @param {string} what
 * @returns {Promise<T>}
 */
export function withDeadline(job, ms, what) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`${what} did not finish in ${ms / 1000} s`)), ms);
  });
  return Promise.race([job, expired]).finally(() => clearTimeout(timer));
}
