import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { packager } from "@electron/packager";

const [distArgument, outputArgument, platform, arch] = process.argv.slice(2);
if (!distArgument || !outputArgument || !platform || !arch) {
  throw new Error(
    "Usage: node scripts/package-electron.mjs <dist> <output-file> <darwin|win32|linux> <x64|arm64>",
  );
}
if (!new Set(["darwin", "win32", "linux"]).has(platform)) {
  throw new Error(`Unsupported Electron platform: ${platform}`);
}
if (!new Set(["x64", "arm64"]).has(arch)) {
  throw new Error(`Unsupported Electron architecture: ${arch}`);
}

const distDirectory = path.resolve(distArgument);
const outputFile = path.resolve(outputArgument);
const build = JSON.parse(await readFile(path.join(distDirectory, "offline-build.json"), "utf8"));
const variant = build.variant;
if (!new Set(["normal", "unlock-all"]).has(variant)) {
  throw new Error(`Unknown offline build variant: ${variant}`);
}

const appName = variant === "unlock-all" ? "Pokerogue Unlock All" : "Pokerogue Offline";
const productName = appName;
const bundleSuffix = variant === "unlock-all" ? "unlockall" : "normal";
const versionParts = String(build.upstreamVersion ?? "1.0.0").split(".").map(part => Number.parseInt(part, 10) || 0);
const appVersion = versionParts.slice(0, 3).join(".");
const buildVersion = versionParts.slice(0, 4).join(".");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "pokerogue-electron-"));
const appDirectory = path.join(temporaryDirectory, "app");
const packagedDirectory = path.join(temporaryDirectory, "packaged");

try {
  await mkdir(appDirectory, { recursive: true });
  await cp(path.resolve("desktop/main.mjs"), path.join(appDirectory, "main.mjs"));
  await writeFile(
    path.join(appDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: `pokerogue-offline-${bundleSuffix}`,
        productName,
        version: appVersion,
        type: "module",
        main: "main.mjs",
      },
      null,
      2,
    )}\n`,
  );

  const outputDirectories = await packager({
    appBundleId: `dev.vdustr.pokerogue.offline.${bundleSuffix}`,
    appCopyright: "PokéRogue contributors; unofficial offline distribution",
    appVersion,
    arch,
    asar: true,
    buildVersion,
    dir: appDirectory,
    electronVersion: "43.1.1",
    name: appName,
    out: packagedDirectory,
    overwrite: true,
    platform,
    prune: false,
  });
  if (outputDirectories.length !== 1) {
    throw new Error(`Expected one packaged directory, received ${outputDirectories.length}`);
  }

  await mkdir(path.dirname(outputFile), { recursive: true });
  await rm(outputFile, { force: true });
  const packagedPath = outputDirectories[0];
  const resourcesDirectory = platform === "darwin"
    ? path.join(packagedPath, `${appName}.app`, "Contents", "Resources")
    : path.join(packagedPath, "resources");
  await cp(distDirectory, path.join(resourcesDirectory, "game"), { recursive: true });
  const parentDirectory = path.dirname(packagedPath);
  const packagedName = path.basename(packagedPath);
  if (platform === "linux") {
    execFileSync("tar", ["-cJf", outputFile, "-C", parentDirectory, packagedName], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qry", "-y", outputFile, packagedName], {
      cwd: parentDirectory,
      stdio: "inherit",
    });
  }

  console.log(`Created ${outputFile}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
