#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <dist-directory> <output-directory> <artifact-name>" >&2
  exit 2
fi

dist_dir="$(cd "$1" && pwd)"
mkdir -p "$2"
output_dir="$(cd "$2" && pwd)"
artifact_name="$3"

(
  cd "$dist_dir"
  zip -q -1 -r "$output_dir/$artifact_name.zip" .
)
(
  cd "$output_dir"
  shasum -a 256 "$artifact_name.zip" > "$artifact_name.zip.sha256"
)

echo "Created $output_dir/$artifact_name.zip"
