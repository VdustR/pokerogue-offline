import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node scripts/verify-upstream-safe-area.mjs <upstream-directory>");

// Use Git's tracked-source boundary, but never treat a Git error as no matches.
const files = execFileSync("git", ["-C", directory, "ls-files", "-z", "--", "*.css", "*.html", "*.scss", "*.ts", "*.tsx"], { encoding: "utf8" }).split("\0").filter(Boolean);
// Full-file identity also binds selectors, nesting and at-rules. Substring
// matching could approve a reviewed rule attached to an unreviewed selector.
const reviewedCssSha256 = "5a7a8cf1b55606e61df664bdb7f20456f808f0282cdf7c84b131b9b4b9e74afa";
for (const file of files) {
  const source = readFileSync(path.join(directory, file), "utf8");
  if (!source.includes("safe-area-inset")) continue;
  if (file === "index.css" && createHash("sha256").update(source).digest("hex") === reviewedCssSha256) continue;
  throw new Error(`Unreviewed upstream safe-area usage in ${file}; review Android native cutout ownership before updating.`);
}
console.log("Upstream safe-area contract verified.");
