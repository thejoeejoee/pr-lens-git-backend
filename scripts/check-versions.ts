#!/usr/bin/env node
import { readFileSync } from "node:fs";

/**
 * One version, three places.
 *
 * package.json names the npm package, Chart.yaml's `version` names the chart and
 * its `appVersion` names the image the chart installs. A release that lets them
 * drift is the worst kind: `helm upgrade` succeeds and silently deploys the
 * previous image.
 *
 * This lives in the package rather than in the workflow so that both routes to
 * the registry run it — the release job calls it, and so does `prepublishOnly`
 * when somebody publishes from a laptop.
 *
 *   node scripts/check-versions.ts [--tag v1.2.3]
 */

/**
 * A top-level scalar out of Chart.yaml, tolerating the trailing
 * `# x-release-please-version` annotation that tells release-please to rewrite
 * the line.
 */
const field = (yaml: string, name: string): string | undefined => {
  const match = new RegExp(
    `^${name}:\\s*"?([^"\\s#]+)"?\\s*(?:#.*)?$`,
    "m",
  ).exec(yaml);
  return match?.[1];
};

const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex === -1 ? undefined : process.argv[tagIndex + 1];

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};
const chartYaml = readFileSync(
  "charts/pr-lens-git-backend/Chart.yaml",
  "utf8",
);

const found = {
  "package.json version": pkg.version,
  "Chart.yaml version": field(chartYaml, "version"),
  "Chart.yaml appVersion": field(chartYaml, "appVersion"),
  ...(tag === undefined ? {} : { "the tag": tag.replace(/^v/, "") }),
};

const disagree = new Set(Object.values(found));

if (disagree.size !== 1) {
  console.error("These do not name the same version:");
  for (const [where, version] of Object.entries(found))
    console.error(`  ${where}: ${version ?? "(not found)"}`);
  process.exit(1);
}

console.log(`all three at ${pkg.version}${tag === undefined ? "" : `, matching ${tag}`}`);
