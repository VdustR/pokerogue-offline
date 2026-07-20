import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const [appArgument] = process.argv.slice(2);
if (!appArgument) {
  throw new Error("Usage: node scripts/finalize-macos-electron-app.mjs <app-bundle>");
}
if (process.platform !== "darwin") {
  throw new Error("macOS Electron app signing must run on macOS");
}

const appPath = path.resolve(appArgument);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
execFileSync(
  "/usr/bin/codesign",
  ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
  { stdio: "inherit" },
);

execFileSync(
  process.execPath,
  [path.join(scriptDirectory, "verify-macos-electron-app.mjs"), appPath],
  { stdio: "inherit" },
);
