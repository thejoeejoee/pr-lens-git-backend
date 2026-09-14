import { readFileSync } from "node:fs";

/**
 * The running version, read from the package rather than repeated here.
 *
 * `../package.json` resolves the same from `src/` in development and from
 * `dist/` in the image, because the image copies package.json next to dist/ —
 * which it has to anyway, since "type": "module" is what makes dist/*.js ESM.
 */
const read = (): string => {
  try {
    const json = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(json) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
};

export const VERSION = read();
