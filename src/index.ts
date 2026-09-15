#!/usr/bin/env node
import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";

/**
 * Start up, and refuse to start up badly.
 *
 * The store is pinged before the socket opens, so a bad token or a missing
 * project is a startup failure with a sentence about it rather than a server
 * that accepts a push and then loses it.
 */
const main = async (): Promise<void> => {
  const config = loadConfig();
  const { server, service, index } = createApp(config);

  await service.ping().catch((error: unknown) => {
    throw new Error(
      `the ${config.store} store did not answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  // Same reasoning one file down: a page that was meant to be replaced and is
  // not there is a mistake worth hearing about at startup, not on the first
  // visit. Once it has been read, a later disappearance is survivable.
  await index?.warm().catch((error: unknown) => {
    throw new Error(
      `INDEX_MARKDOWN_FILE ${config.indexMarkdownFile} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });

  console.log(
    `[pr-lens-gitlab-backend] listening on http://${config.host}:${config.port}, store=${config.store}, draw=${config.draw}`,
  );
  if (config.publicUrl === undefined)
    console.log(
      "[pr-lens-gitlab-backend] PUBLIC_URL is unset, so answers name whichever host the request arrived on",
    );

  const stop = (signal: string): void => {
    console.log(`[pr-lens-gitlab-backend] ${signal}, closing`);
    server.close(() => process.exit(0));
    // A connection that will not close must not hold the process for ever.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
};

await main().catch((error: unknown) => {
  console.error(
    `[pr-lens-gitlab-backend] cannot start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
