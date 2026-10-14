import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const expectedVersion = require("electron/package.json").version;
const executable = process.argv[2] ?? require("electron");
const fixture = fileURLToPath(new URL("./fixtures/electron-security/", import.meta.url));
const runDirectory = await mkdtemp(path.join(os.tmpdir(), "pokerogue-electron-security-"));
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...environment } = process.env;

try {
  const child = spawn(executable, [fixture], {
    env: { ...environment, CONTRACT_RUN_DIR: runDirectory },
    stdio: "inherit",
    timeout: 90_000,
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const result = JSON.parse(await readFile(path.join(runDirectory, "results.json"), "utf8"));
  if (result.electron !== expectedVersion) {
    throw new Error(`Electron runtime ${result.electron} does not match installed version ${expectedVersion}`);
  }
  if (code !== 0 || result.results.length !== 4 || !result.results.every(test => test.pass)) {
    throw new Error(`Electron security contracts failed: ${JSON.stringify(result)}`);
  }
  console.log(`All four Electron security regression contracts passed on ${result.electron}`);
} finally {
  await rm(runDirectory, { recursive: true, force: true });
}
