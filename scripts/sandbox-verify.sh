#!/bin/sh
# Run a workflow (default: flash-default) end to end in a throwaway sandbox and verify that it behaves
# as configured: every step and companion runs on the provider/model that .takt/runtime.yaml
# assigns to it, the happy path is taken, and (real mode) the produced tests pass.
#
# The sandbox is a fresh git project with this bundle installed by scripts/use-lang.sh.
# TAKT_CONFIG_DIR points at an empty directory inside the sandbox, so nothing from ~/.takt
# is used: the run must succeed with the project's own .takt/ configuration alone.
#
# Usage: scripts/sandbox-verify.sh [--mode real|mock] [--lang ja|en] [--workflow NAME]
#                                  [--task TEXT] [--check-cmd CMD]
#                                  [--dir DIR] [--keep] [--timeout SECONDS]
#   --mode real   (default) use the profiles in runtime.project.yaml; calls real providers
#   --mode mock   same routing, but every profile uses TAKT's mock provider; no network,
#                 deterministic, takes about a minute (a scripted judge drives the happy path)
#   --lang        bundle language to install (default: ja)
#   --workflow    workflow to run (default: flash-default; e.g. ddd-rust-default, ddd-typescript-default)
#   --check-cmd   real mode: command that must pass in the sandbox project afterwards
#                 (default: `node --test`; use `cargo test` for Rust tasks)
#   --task        task text for the run (default: a small TypeScript module with node:test tests,
#                 or a small Rust crate for ddd-rust-default)
#   --dir         sandbox directory (default: a new temporary directory)
#   --keep        keep the sandbox even when verification passes (it is always kept on failure)
#   --timeout     abort the run after this many seconds (default: 5400 real, 600 mock)
#
# Exit status: 0 verified, 1 verification failed, 2 usage or setup error.
set -eu

bundle="$(cd "$(dirname "$0")/.." && pwd)"
mode=real
lang=ja
workflow=flash-default
check_cmd=""
task=""
dir=""
keep=0
timeout_s=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="${2:?--mode needs a value}"; shift 2 ;;
    --lang) lang="${2:?--lang needs a value}"; shift 2 ;;
    --task) task="${2:?--task needs a value}"; shift 2 ;;
    --workflow) workflow="${2:?--workflow needs a value}"; shift 2 ;;
    --check-cmd) check_cmd="${2:?--check-cmd needs a value}"; shift 2 ;;
    --dir) dir="${2:?--dir needs a value}"; shift 2 ;;
    --timeout) timeout_s="${2:?--timeout needs a value}"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$mode" in real|mock) ;; *) echo "--mode must be real or mock" >&2; exit 2 ;; esac
case "$lang" in en|ja) ;; *) echo "--lang must be en or ja" >&2; exit 2 ;; esac
command -v takt >/dev/null 2>&1 || { echo "takt is not on PATH" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "node is not on PATH" >&2; exit 2; }
[ -n "$timeout_s" ] || { [ "$mode" = real ] && timeout_s=5400 || timeout_s=600; }
if [ "$workflow" = ddd-rust-default ]; then
  [ -n "$check_cmd" ] || check_cmd="cargo test --quiet"
  [ -n "$task" ] || task='Create a Cargo workspace with a domain crate `billing-domain` under `packages/command/billing-domain` that models an invoice aggregate: an invoice is opened for a customer with invoice lines, a line can be added while the invoice is a draft, and an issued invoice cannot take more lines. The total of the lines must never be negative, and issuing an invoice without lines must fail. Write unit tests for the aggregate; they must pass with `cargo test` run from the repository root.'
fi
[ -n "$check_cmd" ] || check_cmd="node --test"
[ -n "$task" ] || task='Add a Node.js ES module `src/slug.mjs` (no dependencies, no package.json) that exports `slugify(text)`: lowercase the text, replace every run of characters other than a-z and 0-9 with a single hyphen, and trim leading and trailing hyphens. `slugify("  Hello, World!  ")` returns "hello-world" and `slugify("")` returns "". Throw a TypeError when the argument is not a string. Write unit tests with the built-in `node:test` runner in `test/slug.test.mjs`; they must pass with `node --test` run from the repository root.'

if [ -z "$dir" ]; then
  dir="$(mktemp -d 2>/dev/null || mktemp -d -t takt-sandbox)"
else
  mkdir -p "$dir"
  [ -z "$(ls -A "$dir")" ] || { echo "sandbox directory is not empty: $dir" >&2; exit 2; }
fi
dir="$(cd "$dir" && pwd)"
project="$dir/project"
export TAKT_CONFIG_DIR="$dir/takt-home"
mkdir -p "$project" "$TAKT_CONFIG_DIR"
echo "sandbox: $dir  (mode=$mode, lang=$lang, workflow=$workflow)"

# 1. A fresh project, as a user would have it.
git -C "$project" init -q
printf '# sandbox project\n' > "$project/README.md"
printf 'node_modules/\n' > "$project/.gitignore"
git -C "$project" add -A
git -C "$project" -c user.email=sandbox@example.invalid -c user.name=sandbox commit -q -m "chore: initial commit"

# 2. Install the bundle with project-closed configuration.
"$bundle/scripts/use-lang.sh" "$lang" "$project" > "$dir/install.log"

# 3. Mock mode: same step routing, every profile on the mock provider (model = profile name),
#    and a scripted judge that selects the happy-path rule of every step.
if [ "$mode" = mock ]; then
  node "$bundle/scripts/sandbox-check.mjs" mockify --project "$project" --scenario "$dir/mock-scenario.json"
  export TAKT_MOCK_SCENARIO="$dir/mock-scenario.json"
  export TAKT_MOCK_CALL_LOG="$dir/mock-calls.jsonl"
fi

git -C "$project" add -A .takt
git -C "$project" -c user.email=sandbox@example.invalid -c user.name=sandbox commit -q -m "chore: add takt flash-default workflow bundle"

# 4. Static validation in the sandbox.
if ! (cd "$project" && takt workflow doctor "$workflow") > "$dir/doctor.log" 2>&1; then
  echo "takt workflow doctor failed; see $dir/doctor.log" >&2
  exit 1
fi

# 5. Run the workflow.
echo "running $workflow (timeout ${timeout_s}s); log: $dir/run.log"
start="$(date +%s)"
set +e
if command -v timeout >/dev/null 2>&1; then
  (cd "$project" && timeout "$timeout_s" takt --pipeline --skip-git -w "$workflow" -t "$task") > "$dir/run.log" 2>&1
else
  (cd "$project" && takt --pipeline --skip-git -w "$workflow" -t "$task") > "$dir/run.log" 2>&1
fi
rc=$?
set -e
elapsed=$(( $(date +%s) - start ))

# 6. Verify.
set +e
node "$bundle/scripts/sandbox-check.mjs" verify --project "$project" --mode "$mode" \
  --run-log "$dir/run.log" --exit-code "$rc" --elapsed "$elapsed" --report "$dir/report.md" \
  --workflow "$workflow" --check-cmd "$check_cmd"
verdict=$?
set -e

if [ "$verdict" -eq 0 ] && [ "$keep" -eq 0 ]; then
  rm -rf "$dir"
  echo "sandbox removed (pass --keep to keep it)"
else
  echo "sandbox kept: $dir  (report: $dir/report.md)"
fi
exit "$verdict"
