import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const variant = process.argv[2];
if (!new Set(["normal", "unlock-all"]).has(variant)) {
  throw new Error("Usage: node scripts/finalize-offline-build.mjs <normal|unlock-all>");
}

const root = process.cwd();
const dist = path.join(root, "dist");

function gitRevision(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const upstreamRevision = gitRevision("rev-parse", "HEAD");
const assetRevision = gitRevision("-C", "assets", "rev-parse", "HEAD");
const localeRevision = gitRevision("-C", "locales", "rev-parse", "HEAD");
const upstreamPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

await mkdir(dist, { recursive: true });
await writeFile(path.join(dist, "manifest.json"), '{"manifest":{}}\n');
await writeFile(
  path.join(dist, "offline-build.json"),
  `${JSON.stringify(
    {
      variant,
      upstreamVersion: upstreamPackage.version,
      upstreamRevision,
      assetRevision,
      localeRevision,
      builtAt: new Date().toISOString(),
      delivery: ["electron", "android"],
    },
    null,
    2,
  )}\n`,
);

console.log(`Finalized ${variant} app build at ${upstreamRevision}.`);
