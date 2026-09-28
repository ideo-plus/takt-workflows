#!/bin/sh
# Install the workflow bundle for one language into a project's .takt/ directory,
# with all TAKT configuration closed to that project.
#
# TAKT loads project resources only from <project>/.takt/{workflows,steps,facets}.
# It has no language-aware project layer and refuses symlinked resource directories,
# so the bundle is materialized by copying. Only files that belong to this bundle
# (the file names under en/ and ja/) are replaced; other files in .takt/ are left alone.
#
# Configuration is written to the project, never to ~/.takt:
#   .takt/runtime.yaml  profiles + step assignments (from runtime.project.yaml, if absent)
#   .takt/config.yaml   language + rate-limit fallback (from config.project.yaml, if absent)
#   .takt/.gitignore    allowlists runtime.yaml, config.yaml and .takt-workflows for commit
#
# Usage: scripts/use-lang.sh <en|ja> [project-dir] [--no-config]
#   project-dir   target project (default: current directory)
#   --no-config   do not create runtime.yaml / config.yaml or edit .takt/.gitignore (alias: --no-runtime)
#
# Examples:
#   cd ~/work/my-app && /path/to/takt-workflows/scripts/use-lang.sh ja
#   /path/to/takt-workflows/scripts/use-lang.sh en ~/work/my-app
set -eu

bundle="$(cd "$(dirname "$0")/.." && pwd)"
lang=""
project=""
with_config=1
for arg in "$@"; do
  case "$arg" in
    --no-config|--no-runtime) with_config=0 ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) if [ -z "$lang" ]; then lang="$arg"; elif [ -z "$project" ]; then project="$arg"; else echo "too many arguments" >&2; exit 2; fi ;;
  esac
done
case "$lang" in
  en|ja) ;;
  *) echo "usage: $0 <en|ja> [project-dir] [--no-config]" >&2; exit 2 ;;
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

# Project-closed configuration.
notes=""
if [ "$with_config" -eq 1 ]; then
  if [ ! -e "$target/runtime.yaml" ]; then
    cp "$bundle/runtime.project.yaml" "$target/runtime.yaml"
    notes="$notes
  created .takt/runtime.yaml (profiles + step assignments) - review the models, then commit it"
  else
    notes="$notes
  kept existing .takt/runtime.yaml (compare with runtime.project.yaml when updating)"
  fi
  if [ ! -e "$target/config.yaml" ]; then
    { printf 'language: %s\n\n' "$lang"; cat "$bundle/config.project.yaml"; } > "$target/config.yaml"
    notes="$notes
  created .takt/config.yaml (language: $lang)"
  else
    current_lang="$(sed -n 's/^language:[[:space:]]*\([a-z]*\).*/\1/p' "$target/config.yaml" | head -n 1)"
    if [ -n "$current_lang" ] && [ "$current_lang" != "$lang" ]; then
      notes="$notes
  WARNING: .takt/config.yaml has language: $current_lang but the $lang bundle was installed;
           builtin facets will be $current_lang while this bundle's facets are $lang"
    else
      notes="$notes
  kept existing .takt/config.yaml"
    fi
  fi
else
  notes="$notes
  runtime.yaml / config.yaml not touched (--no-config)"
fi

# Make sure the configuration can be committed. TAKT's default .takt/.gitignore ignores
# everything except an allowlist that does not include runtime.yaml.
gitignore="$target/.gitignore"
if [ "$with_config" -eq 0 ]; then
  : # --no-config: leave .takt/.gitignore alone as well
elif [ ! -e "$gitignore" ]; then
  cat > "$gitignore" <<'EOF'
# Ignore everything by default
*

# This file itself
!.gitignore

# Project configuration
!config.yaml
!runtime.yaml
!.takt-workflows

# Facets and workflows (version-controlled)
!workflows/
!workflows/**
!steps/
!steps/**
!facets/
!facets/personas/
!facets/personas/**
!facets/policies/
!facets/policies/**
!facets/knowledge/
!facets/knowledge/**
!facets/instructions/
!facets/instructions/**
!facets/output-contracts/
!facets/output-contracts/**
EOF
  notes="$notes
  created .takt/.gitignore (TAKT default allowlist + runtime.yaml)"
else
  for entry in '!config.yaml' '!runtime.yaml' '!.takt-workflows'; do
    grep -qxF -- "$entry" "$gitignore" || { printf '%s\n' "$entry" >> "$gitignore"; notes="$notes
  added $entry to .takt/.gitignore"; }
  done
  grep -qxF -- '!workflows/**' "$gitignore" || notes="$notes
  note: .takt/.gitignore does not allowlist workflows/**; the bundle files will not be committed"
fi

version="${TAKT_WORKFLOWS_VERSION:-$(git -C "$bundle" rev-parse --short HEAD 2>/dev/null || echo unknown)}"
source="${TAKT_WORKFLOWS_SOURCE:-$bundle}"
printf 'lang: %s\nsource: %s\nversion: %s\n' "$lang" "$source" "$version" > "$target/.takt-workflows"

echo "takt-workflows ($lang, $version) installed into $target"
echo "  workflows/steps/facets copied$notes"
echo "  next: git add .takt && git commit   (TAKT runs tasks in worktree clones; untracked files are invisible)"
echo "        takt workflow doctor flash-default"
