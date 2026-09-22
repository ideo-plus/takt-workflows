#!/bin/sh
# Copy the workflow bundle for one language into .takt/ so TAKT can load it.
# TAKT resolves project resources from .takt/{workflows,steps,facets} only,
# has no language-aware project layer, and refuses symlinked resource
# directories, so the active language is materialized by copying.
#
# Usage: scripts/use-lang.sh <en|ja>
set -eu
lang="${1:-}"
root="$(cd "$(dirname "$0")/.." && pwd)"
case "$lang" in
  en|ja) ;;
  *) echo "usage: $0 <en|ja>" >&2; exit 2 ;;
esac
for dir in workflows steps facets; do
  rm -rf "$root/.takt/$dir"
  cp -R "$root/$lang/$dir" "$root/.takt/$dir"
done
printf '%s\n' "$lang" > "$root/.takt/.lang"
echo "TAKT bundle language: $lang (copied $lang/{workflows,steps,facets} into .takt/)"
