import type { CanvasRecord, Store, Stored, WriteResult } from "./types.ts";

/**
 * A read-through cache in front of any store, and the reason this server can
 * sit behind a CDN without hammering its backend.
 *
 * A stale read is safe because it is never the basis of a write: every write
 * carries the etag the read came with, the store compares it, and a stale etag
 * comes back as a conflict. The only thing staleness can cost is a conflict
 * report carrying the wrong revision, so a conflict re-reads past the cache
 * before it answers.
 *
 * Its own writes refresh the entry, so a single instance is always coherent
 * with itself; only a second instance can see the window, and only for the TTL.
 */
export class CachedStore implements Store {
  readonly #inner: Store;
  readonly #ttlMs: number;
  readonly #entries = new Map<string, { at: number; value: Stored | null }>();
  /** Coalesces a thundering herd on one id into a single backend read. */
  readonly #inflight = new Map<string, Promise<Stored | null>>();

  constructor(inner: Store, ttlMs: number) {
    this.#inner = inner;
    this.#ttlMs = ttlMs;
  }

  #put(id: string, value: Stored | null): void {
    if (this.#ttlMs <= 0) return;
    this.#entries.set(id, { at: Date.now(), value });
  }

  #drop(id: string): void {
    this.#entries.delete(id);
  }

  async read(id: string): Promise<Stored | null> {
    if (this.#ttlMs > 0) {
      const held = this.#entries.get(id);
      if (held !== undefined && Date.now() - held.at < this.#ttlMs)
        return held.value;
      if (held !== undefined) this.#drop(id);
    }

    const running = this.#inflight.get(id);
    if (running !== undefined) return running;

    const fetching = this.#inner
      .read(id)
      .then((value) => {
        this.#put(id, value);
        return value;
      })
      .finally(() => {
        this.#inflight.delete(id);
      });

    this.#inflight.set(id, fetching);
    return fetching;
  }

  /** Straight to the backend. What a conflict reports has to be the truth. */
  async readFresh(id: string): Promise<Stored | null> {
    this.#drop(id);
    return this.read(id);
  }

  async create(record: CanvasRecord): Promise<WriteResult> {
    const result = await this.#inner.create(record);
    this.#drop(record.id);
    return result;
  }

  async replace(record: CanvasRecord, etag: string): Promise<WriteResult> {
    const result = await this.#inner.replace(record, etag);
    this.#drop(record.id);
    return result;
  }

  async remove(id: string, etag: string): Promise<WriteResult> {
    const result = await this.#inner.remove(id, etag);
    this.#drop(id);
    return result;
  }

  async ping(): Promise<void> {
    return this.#inner.ping();
  }
}
