import {
  type CanvasRecord,
  type Store,
  type Stored,
  type WriteResult,
} from "./types.ts";

/**
 * The same contract, held in a Map. This exists so the routes can be tested
 * without a GitLab project, and so `STORE=memory` gives someone a server to
 * point the CLI at before they have decided where canvases should live. It
 * forgets everything when the process ends, which is the whole of its warning
 * label.
 */
export class MemoryStore implements Store {
  readonly #records = new Map<string, Stored>();
  #etag = 0;

  #next(): string {
    this.#etag += 1;
    return String(this.#etag);
  }

  async read(id: string): Promise<Stored | null> {
    const held = this.#records.get(id);
    // Copied out, so a caller mutating a record cannot rewrite history.
    return held === undefined
      ? null
      : { record: structuredClone(held.record), etag: held.etag };
  }

  async create(record: CanvasRecord): Promise<WriteResult> {
    if (this.#records.has(record.id)) return "conflict";
    this.#records.set(record.id, {
      record: structuredClone(record),
      etag: this.#next(),
    });
    return "written";
  }

  async replace(record: CanvasRecord, etag: string): Promise<WriteResult> {
    const held = this.#records.get(record.id);
    if (held === undefined || held.etag !== etag) return "conflict";
    this.#records.set(record.id, {
      record: structuredClone(record),
      etag: this.#next(),
    });
    return "written";
  }

  async remove(id: string, etag: string): Promise<WriteResult> {
    const held = this.#records.get(id);
    if (held === undefined || held.etag !== etag) return "conflict";
    this.#records.delete(id);
    return "written";
  }

  async ping(): Promise<void> {}
}
