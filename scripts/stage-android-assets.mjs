import { copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [normalArgument, unlockAllArgument] = process.argv.slice(2);
if (!normalArgument || !unlockAllArgument) {
  throw new Error("Usage: node scripts/stage-android-assets.mjs <normal-dist> <unlock-all-dist>");
}

const editions = [
  { expectedVariant: "normal", source: path.resolve(normalArgument), sourceSet: "normal" },
  { expectedVariant: "unlock-all", source: path.resolve(unlockAllArgument), sourceSet: "unlockAll" },
];

for (const edition of editions) {
  const build = JSON.parse(await readFile(path.join(edition.source, "offline-build.json"), "utf8"));
  if (build.variant !== edition.expectedVariant) {
    throw new Error(`Expected ${edition.expectedVariant} build, received ${build.variant}`);
  }

  const target = path.resolve("android/app/src", edition.sourceSet, "assets/www");
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(edition.source, target, { recursive: true });
  console.log(`Staged ${edition.expectedVariant} Android assets at ${target}`);
}

const launcherIconSource = path.join(editions[0].source, "logo512.png");
const launcherIconTarget = path.resolve("android/app/src/main/res/drawable-nodpi/pokerogue_logo.png");
await mkdir(path.dirname(launcherIconTarget), { recursive: true });
await copyFile(launcherIconSource, launcherIconTarget);
console.log(`Staged the official PokéRogue launcher icon at ${launcherIconTarget}`);
