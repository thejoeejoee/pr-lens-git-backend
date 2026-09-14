/**
 * Everything the server needs to know, read once at startup.
 *
 * A missing setting that has no safe default is a startup failure rather than
 * a 500 on the first request: a canvas server that cannot reach its store is
 * not half-working, it is not working.
 */

export type GitLabSettings = {
  baseUrl: string;
  project: string;
  token: string;
  branch: string;
  prefix: string;
  authorName: string;
  authorEmail: string;
};

export type Config = {
  host: string;
  port: number;
  /** Origin the answers' URLs are built from; undefined means "ask the request". */
  publicUrl: string | undefined;
  store: "gitlab" | "memory";
  gitlab: GitLabSettings | undefined;
  /** Largest push body accepted, in bytes. */
  maxBodyBytes: number;
  /** How long a read may be served from memory before the store is asked again. */
  readCacheTtlMs: number;
  /** Ceiling on rendered SVG bytes held in memory. */
  renderCacheBytes: number;
  /** False turns the server into a pure store: every answer carries `tiles: []`. */
  draw: boolean;
  mintsPerHourPerIp: number;
  pushesPerMinutePerCanvas: number;
  /** Cache-Control for the content-addressed image routes. */
  imageCacheControl: string;
  /** Cache-Control for /c/{id}.svg, which changes with every revision. */
  embedCacheControl: string;
  /** Whether to believe x-forwarded-for when identifying a client. */
  trustProxy: boolean;
  /** One line per request, with canvas ids redacted. */
  logRequests: boolean;
  /** Serve the explanatory page at `/`. Off answers NOT_FOUND there instead. */
  indexPage: boolean;
};

const str = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
};

const int = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer, got ${raw}`);
  return value;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be a boolean, got ${raw}`);
};

/** Trailing slashes off, so joining paths never doubles one. */
const origin = (url: string): string => url.replace(/\/+$/, "");

export const loadConfig = (): Config => {
  const store = str("STORE", "gitlab");
  if (store !== "gitlab" && store !== "memory")
    throw new Error(`STORE must be "gitlab" or "memory", got ${store}`);

  const publicUrl = process.env.PUBLIC_URL?.trim();

  return {
    host: str("HOST", "0.0.0.0"),
    port: int("PORT", 8787),
    publicUrl:
      publicUrl === undefined || publicUrl === ""
        ? undefined
        : origin(publicUrl),
    store,
    gitlab:
      store === "gitlab"
        ? {
            baseUrl: origin(str("GITLAB_URL", "https://gitlab.com")),
            // Numeric id or the path, which the store percent-encodes.
            project: str("GITLAB_PROJECT"),
            token: str("GITLAB_TOKEN"),
            branch: str("GITLAB_BRANCH", "main"),
            prefix: str("GITLAB_PREFIX", "canvases").replace(/^\/+|\/+$/g, ""),
            authorName: str("GITLAB_AUTHOR_NAME", "pr-lens-gitlab-backend"),
            authorEmail: str("GITLAB_AUTHOR_EMAIL", "pr-lens-gitlab-backend@localhost"),
          }
        : undefined,
    maxBodyBytes: int("MAX_BODY_BYTES", 4_000_000),
    readCacheTtlMs: int("READ_CACHE_TTL_MS", 5_000),
    renderCacheBytes: int("RENDER_CACHE_BYTES", 64_000_000),
    draw: bool("DRAW", true),
    mintsPerHourPerIp: int("MINTS_PER_HOUR_PER_IP", 60),
    pushesPerMinutePerCanvas: int("PUSHES_PER_MINUTE_PER_CANVAS", 30),
    imageCacheControl: str(
      "IMAGE_CACHE_CONTROL",
      "public, max-age=31536000, immutable",
    ),
    embedCacheControl: str(
      "EMBED_CACHE_CONTROL",
      "public, max-age=60, stale-while-revalidate=300",
    ),
    trustProxy: bool("TRUST_PROXY", false),
    logRequests: bool("LOG_REQUESTS", true),
    indexPage: bool("INDEX_PAGE", true),
  };
};
