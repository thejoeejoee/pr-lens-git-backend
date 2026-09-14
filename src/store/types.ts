/**
 * What a canvas is, on disk or in a repository: a counter, a document per
 * count — only the latest is reachable — and the hash of the one token that
 * may change either.
 */
export type CanvasRecord = {
  id: string;
  rev: number;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  /** Null between minting and the first push, when a fetch answers NOT_FOUND. */
  document: unknown;
};

/**
 * A record and the store's own word for "the version I handed you". The
 * revision counter cannot play that part: two pushes racing on rev 3 both read
 * rev 3, and only the store knows which write landed first.
 */
export type Stored = { record: CanvasRecord; etag: string };

export type WriteResult = "written" | "conflict";

export interface Store {
  /** Null for an id the store has never held. */
  read(id: string): Promise<Stored | null>;
  /** "conflict" means the id is taken, which for a fresh mint means try again. */
  create(record: CanvasRecord): Promise<WriteResult>;
  /** "conflict" means the record changed since `etag` was read. */
  replace(record: CanvasRecord, etag: string): Promise<WriteResult>;
  remove(id: string, etag: string): Promise<WriteResult>;
  /** A cheap round trip, for the health route. */
  ping(): Promise<void>;
}

export const isCanvasRecord = (value: unknown): value is CanvasRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<CanvasRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.rev === "number" &&
    Number.isInteger(record.rev) &&
    typeof record.tokenHash === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    "document" in record
  );
};

/**
 * The store is reachable but is asking to be left alone for a moment. Worth a
 * class of its own because it is the one store failure the contract can say
 * something useful about: it becomes RATE_LIMITED with a time to come back.
 */
export class StoreThrottled extends Error {
  readonly retryAt: Date;

  constructor(retryAt: Date, message: string) {
    super(message);
    this.name = "StoreThrottled";
    this.retryAt = retryAt;
  }
}

/** Anything else the store could not do. Leaves as a bare 500. */
export class StoreUnavailable extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "StoreUnavailable";
  }
}
