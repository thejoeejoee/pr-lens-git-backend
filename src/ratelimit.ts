/**
 * A sliding window per key, held in memory.
 *
 * In memory means per instance, so two replicas allow twice the rate. That is
 * the right trade here: the contract calls metering optional, and the point of
 * the limit is to keep one client from filling the store with commits, not to
 * be an accounting system. A shared counter would add a dependency the rest of
 * this server does not have.
 */
export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #hits = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Zero as a limit turns the meter off entirely. */
  get enabled(): boolean {
    return this.#limit > 0;
  }

  take(key: string): { ok: true } | { ok: false; retryAt: Date } {
    if (!this.enabled) return { ok: true };

    const now = Date.now();
    const since = now - this.#windowMs;
    const kept = (this.#hits.get(key) ?? []).filter((at) => at > since);

    if (kept.length >= this.#limit) {
      this.#hits.set(key, kept);
      // The window frees up when its oldest hit falls out of it.
      const oldest = kept[0] ?? now;
      return { ok: false, retryAt: new Date(oldest + this.#windowMs) };
    }

    kept.push(now);
    this.#hits.set(key, kept);

    // Keys accumulate one entry per client address, so sweep the dead ones
    // occasionally rather than growing forever.
    if (this.#hits.size > 10_000) this.#sweep(since);

    return { ok: true };
  }

  #sweep(since: number): void {
    for (const [key, hits] of this.#hits) {
      const kept = hits.filter((at) => at > since);
      if (kept.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, kept);
    }
  }
}
