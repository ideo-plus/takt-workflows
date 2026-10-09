# takt-workflows
A collection of [TAKT](https://github.com/nrslib/takt) workflows, facets, and hands-on know-how for running them, packaged so any project can install and verify them.

[English](README.md) | [日本語](README.ja.md)

## Workflows
| Workflow | What it does |
|---|---|
| [`flash-default`](#flash-default) | The builtin `default` development workflow with model tiers: tests and implementation start on a cheap Flash-class model and escalate to stronger models only when a step fails. |
| [`ddd-rust-default`, `ddd-typescript-default`](#ddd-rust-default--ddd-typescript-default) | The builtin `default` development workflow for Rust or TypeScript code that follows domain-driven design conventions, with a domain model declared in the repository and a DDD reviewer. |

More workflows will be added to this collection over time.

See the [code showcase](showcase/README.md) for event-sourced meeting-room reservations and eligibility decisions over two independent Aggregates in TypeScript and Rust. Each example records its original generation conditions and verification after the corrections.

## Highlights
- **Install into the project you work in.** A one-line installer copies a bundle into the project's `.takt/`. No clone inside your repository.
- **Configuration stays in the project.** Models and step assignments live in the project's committed `.takt/runtime.yaml`, so projects do not affect each other through `~/.takt`.
- **English and Japanese bundles.** `en/` and `ja/` have the same structure, like TAKT's own builtins.
- **Verified end to end.** A sandbox script runs a workflow in a throwaway project, on TAKT's mock provider or on real providers, and checks which model each step actually used.

## Quickstart

### Requirements
- TAKT 0.67 or later (`npm i -g takt`, or pin it per project with [mise](https://mise.jdx.dev): `"npm:takt" = "0.67.0"` under `[tools]` in the project's `mise.toml`, listed before `node` so it wins over a `takt` installed globally into that node)
- The providers named in the workflow's `runtime.yaml` (see the workflow's section below)
- For the launcher: `claude` (2.1.280 or later) and `codex` on PATH, with authenticated account configuration directories for both

### Add it to the project you work in
Run the one-line installer inside the project. It downloads the bundle as a tarball (no git clone), copies `<lang>/{workflows,steps,facets}` into the project's `.takt/` and three executable launchers into `.takt/bin/`, and creates `.takt/runtime.yaml` and `.takt/config.yaml` if they do not exist:

```sh
cd ~/work/my-app
curl -fsSL https://raw.githubusercontent.com/ideo-plus/takt-workflows/main/scripts/install.sh | sh -s -- ja    # or: en
```

Pin a version with `--ref` (any branch, tag, or commit): `... | sh -s -- ja --ref v0.1.0`. The installed language and ref are recorded in `.takt/.takt-workflows`.

Prefer a local checkout? Clone this repository **outside** the project (a clone inside a git repository becomes an embedded repository that git does not track) and run the same installer from it:

```sh
git clone https://github.com/ideo-plus/takt-workflows.git ~/src/takt-workflows
cd ~/work/my-app && ~/src/takt-workflows/scripts/use-lang.sh ja
```

### Commit, configure, run
```sh
git add .takt .claude && git commit -m "chore: add takt-workflows bundle"
takt workflow doctor flash-default
.takt/bin/run-takt.sh --claude-account <dir> --codex-account <dir> --pipeline --auto-pr -w flash-default -t "Add ... with tests"
```

- Commit what the installer wrote: `workflows/`, `steps/`, `facets/`, `tools/`, `bin/`, `runtime.yaml`, `config.yaml`, `.takt-workflows`, and `.claude/settings.json`. TAKT runs tasks in worktree clones of the repository, so untracked files under `.takt/` are invisible to a run. The installer adds `runtime.yaml` and `bin/` to the `.takt/.gitignore` allowlist.
- The installer merges Read deny rules for `.takt/tools`, `.takt/facets`, `.takt/workflows`, and `.takt/steps` into `.claude/settings.json`, which TAKT's Claude steps load. A step then runs ddd-lint instead of reading its sources and does not reread the facets it was given; reports and quality gate logs under `.takt/` stay readable. Your interactive Claude Code sessions in the project get the same rules; remove them from `.claude/settings.json` if you edit the bundle there.
- Before the first run, check that the models in `.takt/runtime.yaml` are available in your environment.
- To update the bundle or switch language, run the installer again. It replaces only its own files, keeps your `runtime.yaml` and `config.yaml`, and leaves other workflows in `.takt/` untouched.

Run the launcher from your project's root. Replace each `<dir>` with the corresponding account configuration directory; either account option can come first. Remaining arguments go directly to TAKT. The launcher selects the adjacent `takt-claude.sh` and `takt-codex.sh`, resolves the real CLIs to absolute paths, and stops before starting TAKT if either CLI is missing or Claude is older than 2.1.280. Accounts, CLI paths and versions, and the TAKT configuration directory are printed to standard error. If mise is available, TAKT runs through `mise exec` to use the project's pinned version. If the project has a mise configuration but mise is not found, the launcher stops instead of running an unpinned TAKT.

### Install or update only the launchers
From the project root:

```sh
curl -fsSL https://raw.githubusercontent.com/ideo-plus/takt-workflows/main/scripts/install.sh | sh -s -- en --launchers-only
# Or from a local checkout:
~/src/takt-workflows/scripts/use-lang.sh en /path/to/project --launchers-only
```

The language argument (`en` or `ja`) is still required. This mode replaces only `.takt/bin/{run-takt,takt-claude,takt-codex}.sh` and adds their `.takt/.gitignore` permissions. Other files in `bin/` are kept. Workflows, steps, facets, tools, runtime and config files, Claude settings, and the installation record are left untouched.

## Configuration stays in the project
All TAKT configuration for the bundle lives in the project and is committed with it.

| File | Contents | Template |
|---|---|---|
| `.takt/runtime.yaml` | Profiles (provider and model) and the step assignments of each workflow | [`runtime.project.yaml`](runtime.project.yaml) |
| `.takt/config.yaml` | Language and the rate-limit fallback chain | [`config.project.yaml`](config.project.yaml) |

The launcher sets `TAKT_CONFIG_DIR` to `<project>/.takt/home`, overriding any inherited value so other projects' global settings stay out. `.takt/.gitignore` ignores this directory. If you invoke TAKT directly, set the same value yourself, for example with direnv:

```sh
# .envrc
export TAKT_CONFIG_DIR="$PWD/.takt/home"
```

- Without `TAKT_CONFIG_DIR`, an existing `~/.takt/runtime.yaml` still applies: project profiles override global profiles of the same name, project `defaults` and `targets` replace the global ones, and `companion.enabled: false` in the global file disables companions for every project.
- TAKT accepts a non-loopback `base_url` (for example a DGX Spark on the LAN) only in the runtime.yaml of the `TAKT_CONFIG_DIR` layer. With a project-local `TAKT_CONFIG_DIR`, that setting also stays in the project.
- Every profile referenced from a `ladder` must define both `provider` and `model`.
- Top models hit rate limits sooner. The fallback chain in `.takt/config.yaml` re-runs a step that hits a limit on the next provider instead of failing it.

## flash-default
The builtin `default` workflow (scenario-based planning, test-first implementation, parallel peer review, adjudication, a convergent fix loop, and a final gate) with its implementation steps split into model tiers.

### Tiers
| Tier | Used for | What to put there | Verified example (provider / model) |
|---|---|---|---|
| T0 | `write_tests`, first `implement` | Flash-class model (DGX Spark, Ollama Cloud, LM Studio) | `opencode` / `ollama/glm-5.3-flash:cloud` (tests), `opencode` / `opencode-go/gpt-5.6-luna` (implement) |
| T1 | `reimplement`, `fix`, review companions, facet selector | Mid-size model with structured output | `claude` / `claude-sonnet-5` |
| T2 | `reimplement_final`, `fix` escalation, default for every other step | Strongest general model | `claude` / `claude-opus-5-5` |
| T3 (optional) | `plan`, `replan`, adjudication, `final-gate` | Top model for low-token, high-leverage judgment steps | `claude` / `claude-fable-5-1` (plan), `codex` / `gpt-6.1-sol` with `reasoning_effort: high` (judge) |

The examples are the exact profiles used in the verified full runs. `gpt-6.1-sol` is the top Codex model (`gpt-6-astra` ranks next); it needs TAKT 0.67 or later, as the Codex CLI that TAKT 0.66 bundles rejects it for ChatGPT accounts. T1 needs a provider with structured output: `claude`, `claude-sdk`, `claude-terminal`, `codex`, or `opencode`.

### `.takt/runtime.yaml`
```yaml
version: 1
companion:
  enabled: true
provider:
  defaults: { profile: t2 }
  profiles:
    # T0: Flash-class models for closed, well-specified work
    t0-test-code:       { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t0-production-code: { provider: opencode, model: opencode-go/gpt-5.6-luna }
    # T1: mid-size model with structured output (companions and the facet selector need it)
    t1: { provider: claude, model: claude-sonnet-5 }
    # T2: strongest general model; default for every step not listed below
    t2: { provider: claude, model: claude-opus-5-5 }
    # T3 (optional): planning and sign-off on different vendors
    t3-plan:  { provider: claude, model: claude-fable-5-1 }
    t3-judge: { provider: codex,  model: gpt-6.1-sol, options: { reasoning_effort: high } }
  targets:
    steps:
      # T3 (optional): remove these four lines to run them on t2 instead
      development-core/plan:                     { profile: t3-plan }
      development-core/replan:                   { profile: t3-plan }
      peer-review/review-adjudication:           { profile: t3-judge }
      peer-review/final-gate:                    { profile: t3-judge }
      # Tiers
      development-core/write_tests:              { ladder: [t0-test-code, t1, t2] }
      flash-implement-dynamic/implement:         { profile: t0-production-code }
      flash-implement-dynamic/reimplement:       { profile: t1 }
      flash-implement-dynamic/reimplement_final: { profile: t2 }
      flash-remediation-dynamic/fix:             { ladder: [t1, t2] }
    internal_agents:
      selector: { profile: t1 }
    companions:
      ai-antipattern-review-companion: { profile: t1 }
      testing-review-companion:        { profile: t1 }
      review-companion-moderator:      { profile: t1 }
```

To switch T0 to a DGX Spark later, change only the two `t0-*` profiles.

## ddd-rust-default / ddd-typescript-default
The builtin `default` workflow for code that follows domain-driven design conventions, in Rust or TypeScript. The conventions: an always-valid domain model, state changed only by declared commands, business failures returned as `Result` with an error type per operation, use cases that only orchestrate, repositories per aggregate, command and query sides kept apart, and packages named by the ubiquitous language. The standard knowledge uses Event Sourcing: repositories return replayed aggregates and append domain events; Domain Primitives validate the same invariants before initialization in both `of` and `parse`.

| Step | What changes |
|---|---|
| plan / replan | The planner derives events, commands, aggregates, and invariants, and writes the exact changes to `.ddd.toml` and `docs/ddd/*.yaml` into the plan |
| implement / reimplement / fix | The coder applies those model changes first, then implements names exactly as the aggregate mapping states. Before the step completes, ddd-lint runs as a command quality gate; any finding sends the step back to the coder |
| review | A DDD reviewer always runs beside the builtin reviewers; the backend and CQRS+ES reviewers are not used |

The project keeps its DDD model across tasks:

| File | Contents |
|---|---|
| `.ddd.toml` | Languages, module layout (Rust `file` / `mod-rs`, TypeScript `named-file` / `index-file`), TypeScript representation (`class` / `companion`) |
| `docs/ddd/domain-model.yaml` | Aggregates, invariants, commands, factory rules, errors, events, states |
| `docs/ddd/aggregate-mapping.yaml` | Where each element lives in code, and the business term of each domain package |
| `docs/ddd/layer-structure.yaml` | Packages, dependencies, ports, repositories, restoration paths per bounded context |

The first run creates them when they are missing; commit them with the code.

```sh
takt -w ddd-rust-default -t "Add ... "        # or ddd-typescript-default
```

Builtin facets are reused where they agree with the DDD conventions (coding, testing, review, ai-antipattern, contract-change, implementation-semantics, architecture). The builtin backend and CQRS+ES facets are not used: they assume Axon on Kotlin, and state that business errors are thrown and that use cases decide from read models. Where a reused builtin states a generic rule the DDD conventions override (business errors as exceptions, input DTOs for command-side use cases, not exporting infrastructure, directory examples), the DDD policies say so explicitly. A command returns the one event it produced. Aggregate mutability follows the language: a Rust command changes the aggregate through `&mut self`, which the borrow checker keeps exclusive, and returns its event; TypeScript aggregates are immutable, and a command returns a new instance together with its event.

### ddd-lint
The installer copies the linter to `.takt/tools/ddd-lint/` (about 13 MB, with a bundled TypeScript compiler and Rust extractor); commit it with the rest of `.takt/`. It checks the model files and the code of every language `.ddd.toml` lists: the shape of the model (invariants, one error set per operation, one event per command, command-ID memory for accumulating commands, with a rationale when only the last command ID is kept), that the mapping covers the model, the layer declaration, hidden state and construction only through the full constructor, TypeScript immutability, that each mapped operation is a method returning `Result<success_type, error_type>` (a Rust command takes `&mut self`), getter use, dependency direction, repository ports declared in the use-case layer and never in the domain layer, use case types named `<Verb><Object>UseCase`, packages named by the ubiquitous language, and module layout.

- Requires [Bun](https://bun.sh) 1.4 or later on `PATH`, and `workflow_command_gates.custom_scripts: true` in `.takt/config.yaml`. The installer writes it into a new `config.yaml`; add it to an existing one, or the DDD workflows do not load.
- The Rust extractor ships for macOS arm64. On any other platform run `bun .takt/tools/ddd-lint/build-extractor.ts` once (needs `cargo`) and commit `.takt/tools/ddd-lint/bin/`.
- Run it by hand with `bun .takt/tools/ddd-lint/ddd-lint.ts` (`--json` for machine-readable output).

## Verify in a sandbox
[`scripts/sandbox-verify.sh`](scripts/sandbox-verify.sh) installs the bundle into a throwaway git project with an empty `TAKT_CONFIG_DIR`, so only the project configuration is used. It runs one workflow (`--workflow`, default `flash-default`) and checks the run log.

```sh
scripts/sandbox-verify.sh --mode mock    # TAKT's mock provider: no network, a few seconds
scripts/sandbox-verify.sh --mode real    # the providers in runtime.project.yaml: about an hour
scripts/sandbox-verify.sh --mode real --workflow ddd-rust-default   # checks the result with cargo test
```

- The run exits 0 and completes.
- Every step runs on the provider and model that `runtime.yaml` assigns to it. A `ladder` step may run on any of its rungs.
- The happy path is visited: `plan`, `write_tests`, `implement`, `review-adjudication`, `final-gate`.
- The companions run on their assigned profile.
- Real mode only: test files are created and the check command passes in the sandbox (`--check-cmd`; `node --test` by default, `cargo test` for `ddd-rust-default`).
- DDD workflows: the DDD reviewer runs, `.ddd.toml` and the model files under `docs/ddd/` are written, and the project passes ddd-lint. In mock mode the coder writes the ddd-lint sample project, so the quality gate runs for real.

The report is written to `report.md` in the sandbox, which is kept on failure or with `--keep`. `--lang`, `--task`, and `--timeout` change the language, the task, and the time limit. `--runtime` and `--config` replace the installed `.takt/runtime.yaml` and `.takt/config.yaml`, so a run can use providers other than the ones `runtime.project.yaml` names (for example a local proxy account) without editing the templates. Mock mode keeps the routing (each profile becomes the mock provider with the profile name as model) and scripts the judge to take the happy path, so it checks the wiring, not model quality.

## Getting help
- Issues: https://github.com/ideo-plus/takt-workflows/issues
- TAKT itself: [nrslib/takt](https://github.com/nrslib/takt)

## For workflow developers

### Repository conventions
- **Two languages, one structure.** `en/` and `ja/` must stay in sync: same file names, and the same YAML apart from `description`, rule `condition` text, and comments. When a workflow copies a builtin, it is the builtin `en` / `ja` file with the same edits applied, so change both when you change structure.
- **Builtins are referenced, not copied.** Copy a builtin workflow only when you must change its steps. Builtin facets are referenced through one-line `{extends:...}` files with a `builtin-` prefix.
- **Templates.** `runtime.project.yaml` and `config.project.yaml` are what the installer copies into projects. In this repository, `.takt/{workflows,steps,facets}` are generated by `scripts/use-lang.sh` (run from the repository root) and are not tracked.
- **Tool versions.** `mise.toml` pins the versions CI installs (TAKT, Node, Bun); run `mise install` once, and inside this repository `takt` is the pinned TAKT whatever is installed globally. Change `mise.toml` and `.github/workflows/ci.yml` together.
- **Verification.** Before submitting a change, run `scripts/sandbox-verify.sh --mode mock --lang <en|ja>` for both languages; CI runs it too. When you change facets or tiers, also run `--mode real`.

### flash-default design notes
- **Only two builtins are copied.** `development-implement-dynamic` and `development-remediation-dynamic` become `flash-implement-dynamic` / `flash-remediation-dynamic` to add the tier steps; `flash-default` calls the builtin `development-core` with different arguments.
- **Escalation is modelled as steps, not `promotion`.** `promotion: [{at: N}]` only advances a `ladder`, and a child workflow's iteration counter resets on every `workflow_call`, so `implement → reimplement → reimplement_final` are separate steps. `write_tests` and `fix` keep a real ladder because they loop inside one workflow.
- **`write_tests` promotion via step fragment.** `steps/development-core-write-tests.yaml` shadows the builtin fragment and adds `promotion`, so `development-core` itself is not copied. This shadowing applies to every workflow in a project that uses `development-core`.
- **T0 context budget.** Policy + knowledge + instruction injected into `write_tests`, `implement`, and `reimplement` stay under 25 KB (`coding-lite`, `testing-lite`, `implementation-semantics`). Do not add full builtin policies to T0 steps.
- More design notes and the `runtime.yaml` template: header comment of [`en/workflows/flash-default.yaml`](en/workflows/flash-default.yaml).

### ddd workflows design notes
- **ddd-lint.** `tools/ddd-lint/` is a Bun program with its own tests (`cd tools/ddd-lint && bun install && bun run typecheck && bun test`). `test/samples/` holds complete TypeScript and Rust sample projects; the code examples of the `ddd-typescript` and `ddd-rust` knowledge are copies of them, the `ddd-modeling` examples must lint clean against them, and the mock sandbox writes them as the coder's output. The Rust extractor is built from `rust-extractor/` by `build-extractor.ts`.
- **Facets.** Policies own the verdicts: `ddd-domain-model` (model declaration and mapping), `ddd-domain-layer`, `ddd-use-case-layer`, `ddd-interface-adapter-layer`, `ddd-layer-dependency`, `ddd-domain-packaging`, `ddd-module-layout`, and one language policy (`ddd-rust` or `ddd-typescript`). Each rule lives in exactly one policy, and each policy opens with the scope it owns; the language policies do not repeat rules, they read them in the language's syntax and add the rules only that language has. Knowledge holds the choices and examples: `ddd-modeling` (project file shapes, modeling options) and `ddd-rust` / `ddd-typescript`. One root per language keeps the language facets out of the other language's prompts.
- **Copied builtins.** `ddd-implement` and `ddd-remediation` drop the dynamic facet pool, which could inject the conflicting builtin backend knowledge, and add the ddd-lint gate to implement, reimplement, fix, and fix-retry; only the success transition runs it. `ddd-review` removes the backend and CQRS+ES reviewers and adds `steps/ddd-reviewer.yaml` as a fixed reviewer. The copies are generated from the builtin workflows; their section maps declare every facet a builtin parent passes in.

## License
Apache License 2.0. See [LICENSE](LICENSE).
