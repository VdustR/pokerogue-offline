import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const guard = new URL("./verify-upstream-safe-area.mjs", import.meta.url).pathname;
const reviewed = readFileSync(new URL("./fixtures/upstream-safe-area.css", import.meta.url), "utf8");

function check(files, expectedSuccess) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pokerogue-safe-area-"));
  try {
    execFileSync("git", ["init", "-q", directory]);
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(directory, name), content);
    execFileSync("git", ["-C", directory, "add", "."]);
    const result = spawnSync(process.execPath, [guard, directory], { encoding: "utf8" });
    assert.equal(result.status === 0, expectedSuccess, result.stdout + result.stderr);
    if (!expectedSuccess) assert.match(result.stderr, /safe-area/);
    for (const [name, content] of Object.entries(files)) {
      assert.equal(readFileSync(path.join(directory, name), "utf8"), content, "Guard must not mutate source");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("accepts only the reviewed CSS or legacy no-inset source", () => {
  check({ "index.css": reviewed, "other.css": ".other { color: red; }" }, true);
  check({ "index.css": "body { margin: 0; }" }, true);
});

test("rejects new files, selectors, declarations, duplicates, and partial migrations", () => {
  check({ "index.css": reviewed, "extra.ts": 'const inset = "safe-area-inset-left";' }, false);
  check({ "index.css": reviewed.replace("body {", ".other {") }, false);
  check({ "index.css": reviewed.replace("body {", "#app,\nbody {") }, false);
  check({ "index.css": "@media (orientation: portrait) {\n" + reviewed + "\n}" }, false);
  check({ "index.css": "/*\n" + reviewed + "\n*/" }, false);
  check({ "index.css": reviewed.replace("padding-top: env", "margin-top: env") }, false);
  check({ "index.css": reviewed + reviewed }, false);
  check({ "index.css": reviewed.replace("#configToolbar {", "#toolbar {") }, false);
  check({ "index.css": reviewed + "\n#app { padding: env(safe-area-inset-bottom); }" }, false);
});

test("Git errors fail closed", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pokerogue-no-git-"));
  try {
    const result = spawnSync(process.execPath, [guard, directory], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a git repository/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
