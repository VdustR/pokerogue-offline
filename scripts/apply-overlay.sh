#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <upstream-directory>" >&2
  exit 2
fi

builder_dir="$(cd "$(dirname "$0")/.." && pwd)"
upstream_dir="$(cd "$1" && pwd)"
patch_file="$builder_dir/patches/upstream.patch"
overlay_dir="$builder_dir/overlay"

git -C "$upstream_dir" apply --check "$patch_file"
git -C "$upstream_dir" apply "$patch_file"

while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$overlay_dir/"}"
  target_file="$upstream_dir/$relative_path"
  if [[ -e "$target_file" ]]; then
    echo "Overlay target already exists upstream: $relative_path" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$target_file")"
  cp "$source_file" "$target_file"
done < <(find "$overlay_dir" -type f -print0)

echo "Offline overlay applied successfully."
