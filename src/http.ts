import type { IncomingMessage, ServerResponse } from "node:http";

import type { Config } from "./config.ts";
import { tooLarge } from "./errors.ts";

/**
 * Enough of a framework for five routes and two pages: read a capped body,
 * write a JSON answer, and work out which origin and which client a request
 * came from.
 */

/**
 * `no-store` on everything the API answers, so that nothing between the CLI and
 * this server keeps a document under an address that is meant to stay secret.
 * The picture routes opt out deliberately; they are content-addressed.
 */
const NO_STORE = "no-store";

export const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": NO_STORE,
    ...headers,
  });
  res.end(text);
};

export const sendText = (
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": NO_STORE,
    ...headers,
  });
  res.end(body);
};

/**
 * The body, or TOO_LARGE, and never more than the limit held in memory.
 *
 * Content-Length is trusted only to refuse early; the running total is what
 * actually enforces the cap, since a chunked request need not declare one.
 */
export const readBody = async (
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> => {
  const declared = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge(limit);
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) {
      req.destroy();
      throw tooLarge(limit);
    }
    chunks.push(part);
  }

  return Buffer.concat(chunks);
};

/**
 * The origin to build answers' URLs from.
 *
 * PUBLIC_URL wins when it is set, which is what a deployment behind a CDN or an
 * ingress wants. Without it the request's own host is used, so a laptop and a
 * port-forward work with no configuration at all.
 */
export const originOf = (req: IncomingMessage, config: Config): string => {
  if (config.publicUrl !== undefined) return config.publicUrl;

  const forwardedProto = header(req, "x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = header(req, "x-forwarded-host")?.split(",")[0]?.trim();

  const encrypted = "encrypted" in req.socket && req.socket.encrypted === true;
  const proto = config.trustProxy
    ? (forwardedProto ?? (encrypted ? "https" : "http"))
    : encrypted
      ? "https"
      : "http";
  const host =
    (config.trustProxy ? forwardedHost : undefined) ??
    header(req, "host") ??
    `localhost:${config.port}`;

  return `${proto}://${host}`;
};

/** Who to meter. Only believed through a proxy we were told to trust. */
export const clientOf = (req: IncomingMessage, config: Config): string => {
  if (config.trustProxy) {
    const forwarded = header(req, "x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded !== undefined && forwarded !== "") return forwarded;
  }
  return req.socket.remoteAddress ?? "unknown";
};

const header = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const headerOf = header;
