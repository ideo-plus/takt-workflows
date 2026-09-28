# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A growing collection of TAKT (0.66) workflows, facets, and operational know-how, distributed as a bundle, not an application. Users install it into *their own* project's `.takt/`; TAKT never reads this repository directly. The first workflow is `flash-default`: the builtin `default` workflow with its implementation steps split into model tiers (T0 Flash-class → T1 → T2, optional T3 for plan/judge steps). `ddd-rust-default` / `ddd-typescript-default` make coders write Rust / TypeScript that follows domain-driven design conventions. More workflows will be added (see `TODO.md`); keep repository-wide mechanisms (installer, project-closed config, sandbox verification) generic, and keep workflow-specific notes under that workflow.

## Commands

```sh
node --test 'scripts/**/*.test.mjs'                          # script unit tests (node:test, no package.json)
node --test scripts/check-facet-budget.test.mjs              # a single test file
(cd tools/ddd-lint && bun install && bun run typecheck && bun test)   # ddd-lint (Bun); needs the Rust extractor for this platform
bun tools/ddd-lint/build-extractor.ts                        # build the Rust extractor for this platform (cargo)
python3 scripts/gen-ddd-workflows.py                         # regenerate ddd-implement / ddd-remediation / ddd-review
scripts/use-lang.sh ja                                       # materialize ja/ into this repo's .takt/ (needed before takt commands here)
takt workflow doctor flash-default flash-implement-dynamic flash-remediation-dynamic
takt workflow inspect flash-default                          # resolved provider/model per step
scripts/sandbox-verify.sh --mode mock --lang ja              # end-to-end check in a throwaway project, seconds, no network
scripts/sandbox-verify.sh --mode real --lang ja --keep       # same with real providers, about an hour
scripts/sandbox-verify.sh --mode mock --workflow ddd-rust-default   # any workflow; real Rust runs use cargo test
node scripts/check-facet-budget.mjs 25000 <files...>          # T0 injected-facet size check
```

CI (`.github/workflows/ci.yml`) runs the mock sandbox for every workflow in `en` and `ja`, the T0 budget check for `flash-default`, the script tests, and the ddd-lint typecheck and tests.

## Architecture

- **`en/` and `ja/` are parallel bundles** (`workflows/`, `steps/`, `facets/`), mirroring TAKT's `builtins/{en,ja}`. They must stay structurally identical; only `description`, rule `condition` text, comments, and facet prose differ. TAKT has no language-aware project layer and rejects symlinked resource dirs, so `scripts/use-lang.sh <lang> [project-dir]` *copies* one language into `<project>/.takt/`. In this repo `.takt/{workflows,steps,facets}` are generated and untracked.
- **Only two builtin workflows are copied** (`development-implement-dynamic` → `flash-implement-dynamic`, `development-remediation-dynamic` → `flash-remediation-dynamic`). `flash-default` calls the builtin `development-core` via `workflow_call` with different args. Builtin facets are referenced through one-line `{extends:<builtin>}` files prefixed `builtin-`; the section maps in the copied workflows exist because TAKT's trust boundary rejects facet args from builtin parents unless the child declares them.
- **Tier escalation is steps, not `promotion`.** A child workflow's iteration counter resets on every `workflow_call`, so `promotion: {at: N}` never fires across replan cycles. Implementation escalates via `implement → reimplement → reimplement_final`. `write_tests` and `fix` loop within one workflow and use real ladders; `write_tests` gets its promotion from the project-layer step fragment `steps/development-core-write-tests.yaml` (shadows the builtin fragment for every workflow in the project).
- **Workflow YAML never names models.** Providers/models live in `runtime.yaml` (`provider.profiles` + `provider.targets.steps` keyed `<workflow>/<step>`). Configuration is project-closed: templates `runtime.project.yaml` and `config.project.yaml` are copied into the target project's `.takt/` by the installer and meant to be committed (TAKT runs tasks in worktree clones). Do not point users at `~/.takt`; full isolation is `TAKT_CONFIG_DIR` set to a project-local dir.
- **T0 context budget:** policy + knowledge + instruction injected into `write_tests` / `implement` / `reimplement` stays under 25 KB (`coding-lite`, `testing-lite`, `implementation-semantics`).
- **English facets keep Japanese contract strings verbatim** (plan table columns 「実装箇所」「完了証拠」, required report headings). They are produced/consumed by the Japanese builtins; translating them breaks downstream steps.
- **Distribution:** `scripts/install.sh` downloads a tarball (`--ref` pins a tag/branch/commit) and runs `use-lang.sh`; nothing is cloned into the user's project.
- **DDD workflows:** policies own the verdicts (`ddd-model`, `ddd-domain`, `ddd-use-case`, `ddd-interface-adapter`, `ddd-structure`, `ddd-rust` / `ddd-typescript`), knowledge holds shapes and examples (`ddd-modeling`, `ddd-rust`, `ddd-typescript`). Builtin backend and CQRS+ES facets are deliberately unused (Axon/Kotlin assumptions conflict); where a reused builtin conflicts (business errors as exceptions, input DTOs, infrastructure exports, directory examples) the DDD policy states the override. `ddd-implement` / `ddd-remediation` / `ddd-review` are generated from the builtin workflows (dynamic facet pool removed; backend and CQRS+ES reviewers replaced by `steps/ddd-reviewer.yaml`); keep them generated rather than hand-edited. The generator also adds the ddd-lint command quality gate to implement / reimplement / fix / fix-retry (success transition only), which needs `workflow_command_gates.custom_scripts: true` in the project config. Project model files live in `docs/ddd/*.yaml` plus `.ddd.toml`.
- **ddd-lint (`tools/ddd-lint/`):** a Bun CLI the installer copies to `<project>/.takt/tools/ddd-lint/`. It checks the model files and the Rust / TypeScript code (vendored TypeScript compiler; Rust facts from a native `syn` extractor built from `rust-extractor/`, shipped for darwin-arm64 only). `test/samples/` are complete sample projects; the `ddd-typescript` / `ddd-rust` knowledge code examples must equal them and the `ddd-modeling` examples must lint clean against them (`bun test` enforces both), and the mock sandbox writes them as the coder's output. When a convention changes, change the policy, the linter rule, the samples, and the knowledge together.
- **Sandbox verification:** `scripts/sandbox-verify.sh` creates a git project in a temp dir with an empty `TAKT_CONFIG_DIR`, installs, runs `takt --pipeline --skip-git -w flash-default`, then `scripts/sandbox-check.mjs verify` compares `step_start` / `companion_call` events in `.takt/runs/*/logs/*.jsonl` with `runtime.yaml`. Mock mode rewrites every profile to `{provider: mock, model: <profile name>}` and scripts the judge (`[STEP-NAME:N]` tags), the dynamic parallel selector, the coder, and the companions to take the happy path.

## Conventions

- Communicate with the user in Japanese (replies, questions, progress reports, and PR comments addressed to them). Code, commit messages, and `.takt/` facets stay in English as described below.
- User-facing docs come in pairs, `README.md` (English) and `README.ja.md` (Japanese), with headings in each document's language. Write for users first and put developer notes after. Do not repeat the same information in a table and a section.
- Model ids in examples carry versions (`claude-opus-5-5`, not `opus`). Tier examples in the README are the profiles that passed a real full run.
- Changes go through a branch and PR; merge once CI is green.
