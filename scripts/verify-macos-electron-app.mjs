import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [appArgument] = process.argv.slice(2);
if (!appArgument) {
  throw new Error("Usage: node scripts/verify-macos-electron-app.mjs <app-bundle>");
}
if (process.platform !== "darwin") {
  throw new Error("macOS Electron app verification must run on macOS");
}

const appPath = path.resolve(appArgument);
const contentsPath = path.join(appPath, "Contents");
const infoPlistPath = path.join(contentsPath, "Info.plist");
let iconFile = "";
try {
  iconFile = execFileSync(
    "/usr/bin/plutil",
    ["-extract", "CFBundleIconFile", "raw", "-o", "-", infoPlistPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
} catch {
  // The explicit error below also covers a missing or unreadable Info.plist key.
}

if (!iconFile) {
  throw new Error(`macOS app still uses the default Electron icon: ${iconFile || "<missing>"}`);
}
const normalizedIconFile = iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`;
if (normalizedIconFile === "electron.icns") {
  throw new Error(`macOS app still uses the default Electron icon: ${iconFile}`);
}
const iconPath = path.join(contentsPath, "Resources", normalizedIconFile);
await access(iconPath);
const iconMetadata = execFileSync(
  "/usr/bin/sips",
  ["-g", "pixelWidth", "-g", "pixelHeight", iconPath],
  { encoding: "utf8" },
);
if (!/pixelWidth:\s+\d+/.test(iconMetadata) || !/pixelHeight:\s+\d+/.test(iconMetadata)) {
  throw new Error(`macOS app icon is not readable: ${iconPath}`);
}

execFileSync(
  "/usr/bin/codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", appPath],
  { stdio: "inherit" },
);

console.log(`Verified macOS Electron app icon and bundle signature: ${appPath}`);
