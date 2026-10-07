/**
 * Tells the newest of several overlapping requests from the older ones. `begin()` starts a request and
 * returns the question to ask once it has waited for its answer: "am I still the newest?". The answer of
 * a request that is not must be thrown away.
 */
export interface LatestRequest {
  begin(): () => boolean;
}

export function createLatestRequest(): LatestRequest {
  let latest = 0;
  return {
    begin() {
      const mine = ++latest;
      return () => mine === latest;
    },
  };
}
