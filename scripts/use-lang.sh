#!/bin/sh
# Install the workflow bundle for one language into a project's .takt/ directory.
#
# TAKT loads project resources only from <project>/.takt/{workflows,steps,facets}.
# It has no language-aware project layer and refuses symlinked resource directories,
# so the bundle is materialized by copying. Only files that belong to this bundle
# (the file names under en/ and ja/) are replaced; other files in .takt/ are left alone.
#
# Usage: scripts/use-lang.sh <en|ja> [project-dir] [--no-runtime]
#   project-dir   target project (default: current directory)
#   --no-runtime  do not create <project>/.takt/runtime.yaml from runtime.project.yaml
#
# Examples:
#   cd ~/work/my-app && /path/to/takt-workflows/scripts/use-lang.sh ja
#   /path/to/takt-workflows/scripts/use-lang.sh en ~/work/my-app
set -eu

bundle="$(cd "$(dirname "$0")/.." && pwd)"
lang=""
project=""
with_runtime=1
for arg in "$@"; do
  case "$arg" in
    --no-runtime) with_runtime=0 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) if [ -z "$lang" ]; then lang="$arg"; elif [ -z "$project" ]; then project="$arg"; else echo "too many arguments" >&2; exit 2; fi ;;
  esac
done
case "$lang" in
  en|ja) ;;
  *) echo "usage: $0 <en|ja> [project-dir] [--no-runtime]" >&2; exit 2 ;;
esac
project="${project:-.}"
[ -d "$project" ] || { echo "project directory not found: $project" >&2; exit 2; }
project="$(cd "$project" && pwd)"
target="$project/.takt"
mkdir -p "$target"

# Remove files owned by this bundle (either language) so a language switch leaves no stale files.
for l in en ja; do
  (cd "$bundle/$l" && find workflows steps facets -type f) | while IFS= read -r rel; do
    rm -f "$target/$rel"
  done
done

# Copy the selected language.
for dir in workflows steps facets; do
  (cd "$bundle/$lang" && find "$dir" -type d) | while IFS= read -r d; do mkdir -p "$target/$d"; done
  (cd "$bundle/$lang" && find "$dir" -type f) | while IFS= read -r rel; do
    cp "$bundle/$lang/$rel" "$target/$rel"
  done
done

# Step assignments for this bundle (profiles live in ~/.takt/runtime.yaml).
runtime_note="kept existing .takt/runtime.yaml"
if [ "$with_runtime" -eq 1 ]; then
  if [ ! -e "$target/runtime.yaml" ]; then
    cp "$bundle/runtime.project.yaml" "$target/runtime.yaml"
    runtime_note="created .takt/runtime.yaml from runtime.project.yaml"
  fi
else
  runtime_note="runtime.yaml not touched (--no-runtime)"
fi

version="${TAKT_WORKFLOWS_VERSION:-$(git -C "$bundle" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
source="${TAKT_WORKFLOWS_SOURCE:-$bundle}"
printf 'lang: %s\nsource: %s\nversion: %s\n' "$lang" "$source" "$version" > "$target/.takt-workflows"

echo "takt-workflows ($lang, $version) installed into $target"
echo "  workflows/steps/facets copied; $runtime_note"
echo "  next: commit .takt/workflows, .takt/steps, .takt/facets (TAKT worktree runs clone the repository),"
echo "        define the profiles in ~/.takt/runtime.yaml, then run: takt workflow doctor flash-default"
