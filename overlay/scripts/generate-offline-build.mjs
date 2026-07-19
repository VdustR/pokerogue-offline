import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const variant = process.argv[2];
if (!new Set(["normal", "unlock-all"]).has(variant)) {
  throw new Error("Usage: node scripts/generate-offline-build.mjs <normal|unlock-all>");
}

const root = process.cwd();
const dist = path.join(root, "dist");
const overlayVersion = 1;

function gitRevision(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const upstreamRevision = gitRevision("rev-parse", "HEAD");
const assetRevision = gitRevision("-C", "assets", "rev-parse", "HEAD");
const localeRevision = gitRevision("-C", "locales", "rev-parse", "HEAD");
const revision = `${upstreamRevision.slice(0, 12)}-${assetRevision.slice(0, 8)}-${localeRevision.slice(0, 8)}-${variant}-v${overlayVersion}`;

await mkdir(dist, { recursive: true });
await writeFile(
  path.join(dist, "offline-build.json"),
  `${JSON.stringify(
    {
      variant,
      revision,
      upstreamRevision,
      assetRevision,
      localeRevision,
      overlayVersion,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
await writeFile(path.join(dist, "manifest.json"), '{"manifest":{}}\n');

const webManifestPath = path.join(dist, "manifest.webmanifest");
const webManifest = JSON.parse(await readFile(webManifestPath, "utf8"));
webManifest.scope = "./";
webManifest.start_url = "./";
await writeFile(webManifestPath, `${JSON.stringify(webManifest, null, 2)}\n`);

const files = [];
async function collectFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolutePath);
    } else if (!new Set(["service-worker.js", "offline-manifest.json"]).has(entry.name)) {
      const metadata = await stat(absolutePath);
      files.push({
        path: `./${path.relative(dist, absolutePath).split(path.sep).join("/")}`,
        size: metadata.size,
      });
    }
  }
}
await collectFiles(dist);
files.sort((left, right) => left.path.localeCompare(right.path));

const totalBytes = files.reduce((total, file) => total + file.size, 0);
await writeFile(
  path.join(dist, "offline-manifest.json"),
  `${JSON.stringify({ revision, variant, totalBytes, files })}\n`,
);

const serviceWorkerTemplate = await readFile(path.join(root, "scripts/offline/service-worker.js"), "utf8");
await writeFile(
  path.join(dist, "service-worker.js"),
  serviceWorkerTemplate.replaceAll("__OFFLINE_REVISION__", revision),
);

console.log(
  `Offline ${variant} build: ${files.length.toLocaleString()} files, ${(totalBytes / 1024 ** 2).toFixed(1)} MB`,
);
