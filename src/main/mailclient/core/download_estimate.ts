// #63: how long the first download still takes, from its rate since it last (re)started.
//
// Counted in messages, not bytes: the download goes newest first and stores a message above
// `lazyAboveBytes` as its skeleton, so bytes on the wire say little about what is left, while the
// message count is what the progress already shows. A rate needs some time and some messages
// behind it before it means anything; until then there is no estimate.

export type RateSample = { at: number; done: number };

/** Below this the rate is noise (the first batch, a reconnect). */
export const ESTIMATE_MIN_MS = 30_000;
export const ESTIMATE_MIN_MESSAGES = 20;

/** Seconds left at the rate from `start` to `now`; null while it cannot tell. */
export function secondsLeft(start: RateSample, now: RateSample, total: number | null): number | null {
  if (!total) return null;
  const elapsed = now.at - start.at;
  const gained = now.done - start.done;
  if (elapsed < ESTIMATE_MIN_MS || gained < ESTIMATE_MIN_MESSAGES) return null;
  const left = total - now.done;
  if (left <= 0) return null;
  return Math.ceil((left * elapsed) / gained / 1000);
}
