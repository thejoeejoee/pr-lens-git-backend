import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { CanvasService } from "./canvas.ts";
import type { Config } from "./config.ts";
import { ApiError, invalidRequest, notFound, rateLimited } from "./errors.ts";
import {
  clientOf,
  headerOf,
  originOf,
  readBody,
  sendJson,
  sendText,
} from "./http.ts";
import { canvasPage, heroSvg, indexPage } from "./page.ts";
import { DrawingCache } from "./render/cache.ts";
import { bearerToken } from "./secrets.ts";
import { CachedStore } from "./store/cached.ts";
import { GitLabStore } from "./store/gitlab.ts";
import { MemoryStore } from "./store/memory.ts";
import { StoreThrottled } from "./store/types.ts";

/**
 * Seven routes and a health check, matched by hand.
 *
 * Every id in this file is a read capability, so nothing here puts one in a log
 * line. The paths are logged with the id replaced, which is the difference
 * between an access log and a list of everybody's canvases.
 */

const CANVAS = /^\/api\/canvas\/([^/]+)$/;
const ROTATE = /^\/api\/canvas\/([^/]+)\/rotate$/;
const PAGE = /^\/c\/([^/]+?)(\.svg)?$/;
const IMAGE = /^\/images\/([^/]+)\/([^/]+\.svg)$/;

export type App = { server: Server; service: CanvasService };

export const createApp = (config: Config): App => {
  const backing =
    config.store === "gitlab"
      ? new GitLabStore(
          config.gitlab ?? (() => { throw new Error("GitLab settings missing"); })(),
        )
      : new MemoryStore();

  const store = new CachedStore(backing, config.readCacheTtlMs);
  const drawings = new DrawingCache(config.renderCacheBytes, config.draw);
  const service = new CanvasService(config, store, drawings);

  const server = createServer((req, res) => {
    const started = Date.now();
    void route(req, res, config, service)
      .catch((error: unknown) => refuse(res, error))
      .finally(() => {
        if (config.logRequests) log(req, res, started);
      });
  });

  return { server, service };
};

const route = async (
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  service: CanvasService,
): Promise<void> => {
  const method = req.method ?? "GET";
  // Only the path matters; a query string is never part of a route here.
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  const query = new URL(req.url ?? "/", "http://localhost").searchParams;
  const origin = originOf(req, config);

  // Somebody pasted the host into a browser. Tell them what this is, in terms
  // that are true of any deployment: nothing here names the store's project or
  // any canvas, so the page is the same for everyone and may be cached as such.
  if (path === "/" && (method === "GET" || method === "HEAD")) {
    if (!config.indexPage) throw notFound();
    sendText(
      res,
      200,
      "text/html; charset=utf-8",
      indexPage(origin, { store: config.store, draws: config.draw }),
      { "cache-control": "public, max-age=300" },
    );
    return;
  }

  // Liveness is about this process; readiness is about the store behind it.
  // Keeping them apart means a container health check does not spend a GitLab
  // API call every few seconds.
  if (path === "/healthz" && (method === "GET" || method === "HEAD")) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path === "/readyz" && (method === "GET" || method === "HEAD")) {
    await service.ping();
    sendJson(res, 200, { ok: true, store: config.store });
    return;
  }

  if (path === "/api/canvas") {
    if (method !== "POST") return notAllowed(res, "POST");
    const minted = await service.mint(clientOf(req, config), origin);
    sendJson(res, 201, minted);
    return;
  }

  const rotate = ROTATE.exec(path);
  if (rotate?.[1] !== undefined) {
    if (method !== "POST") return notAllowed(res, "POST");
    const body = await jsonBody(req, config.maxBodyBytes);
    const rotated = await service.rotate(
      rotate[1],
      bearerToken(headerOf(req, "authorization")),
      body,
      origin,
    );
    sendJson(res, 200, rotated);
    return;
  }

  const canvas = CANVAS.exec(path);
  if (canvas?.[1] !== undefined) {
    const id = canvas[1];

    if (method === "GET" || method === "HEAD") {
      sendJson(res, 200, await service.fetch(id, origin));
      return;
    }

    if (method === "PUT") {
      // The contract's first three checks, in its order: a usable If-Match
      // before the body is read at all, then the size, then the syntax.
      const ifMatch = parseIfMatch(headerOf(req, "if-match"));
      const body = await jsonBody(req, config.maxBodyBytes);
      const pushed = await service.push(
        id,
        bearerToken(headerOf(req, "authorization")),
        ifMatch,
        body,
        origin,
      );
      sendJson(res, 200, pushed);
      return;
    }

    if (method === "DELETE") {
      const deleted = await service.remove(
        id,
        bearerToken(headerOf(req, "authorization")),
      );
      sendJson(res, 200, deleted);
      return;
    }

    return notAllowed(res, "GET, PUT, DELETE");
  }

  const page = PAGE.exec(path);
  if (page?.[1] !== undefined) {
    if (method !== "GET" && method !== "HEAD") return notAllowed(res, "GET");
    const held = await service.canvas(page[1]);

    if (page[2] === ".svg") {
      const theme = query.get("theme") === "dark" ? "dark" : "light";
      const hero = heroSvg(held, theme);
      if (hero === undefined) throw notFound();

      // The embed's address does not change when the picture does, so it is
      // revalidated rather than frozen, and the render's own hash is the tag.
      const etag = `"${hero.contentHash}"`;
      if (headerOf(req, "if-none-match") === etag) {
        res.writeHead(304, {
          etag,
          "cache-control": config.embedCacheControl,
        });
        res.end();
        return;
      }

      sendText(res, 200, "image/svg+xml; charset=utf-8", hero.svg, {
        "cache-control": config.embedCacheControl,
        etag,
      });
      return;
    }

    sendText(res, 200, "text/html; charset=utf-8", canvasPage(origin, held));
    return;
  }

  const image = IMAGE.exec(path);
  if (image?.[1] !== undefined && image[2] !== undefined) {
    if (method !== "GET" && method !== "HEAD") return notAllowed(res, "GET");
    const svg = await service.image(image[1], image[2]);
    // A file name that is not the current revision's is simply not here; it is
    // never a stale picture served under a fresh name.
    if (svg === undefined) throw notFound();

    sendText(res, 200, "image/svg+xml; charset=utf-8", svg, {
      // The hash is in the file name, so these bytes can never change.
      "cache-control": config.imageCacheControl,
      etag: `"${image[2]}"`,
    });
    return;
  }

  throw notFound();
};

/**
 * `If-Match` carries the revision the writer last saw, as a plain integer,
 * quotes tolerated. Absent or unparseable is the contract's first refusal.
 */
const parseIfMatch = (header: string | undefined): number => {
  const match = /^(?:W\/)?"?(\d+)"?$/.exec((header ?? "").trim());
  const rev = match?.[1];
  if (rev === undefined)
    throw invalidRequest(
      "If-Match must carry the revision you last saw, as an integer",
    );
  return Number(rev);
};

const jsonBody = async (
  req: IncomingMessage,
  limit: number,
): Promise<unknown> => {
  const raw = await readBody(req, limit);
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalidRequest("The body is not JSON");
  }
};

const notAllowed = (res: ServerResponse, allow: string): void => {
  sendJson(res, 405, notFound().body(), { allow });
};

/**
 * A refusal the contract names, or nothing at all.
 *
 * An internal fault deliberately leaves without an envelope: the client reads a
 * bare 500 as the server being unavailable, which is the truth, whereas a made
 * up code would be a lie it would try to act on.
 */
const refuse = (res: ServerResponse, error: unknown): void => {
  if (res.headersSent) {
    res.end();
    return;
  }

  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body());
    return;
  }

  if (error instanceof StoreThrottled) {
    const throttled = rateLimited(error.retryAt, error.message);
    sendJson(res, throttled.status, throttled.body());
    return;
  }

  console.error("[pr-lens-gitlab-backend] unhandled", error);
  sendJson(res, 500, {});
};

/** Paths with their ids removed, because an id is a capability. */
const redact = (path: string): string =>
  path
    .replace(CANVAS, "/api/canvas/:id")
    .replace(ROTATE, "/api/canvas/:id/rotate")
    .replace(PAGE, "/c/:id$2")
    .replace(IMAGE, "/images/:id/:file");

const log = (req: IncomingMessage, res: ServerResponse, started: number): void => {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  console.log(
    `${req.method ?? "GET"} ${redact(path)} ${res.statusCode} ${Date.now() - started}ms`,
  );
};
