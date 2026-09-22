# takt-workflows
Tiered development workflows for [TAKT](https://github.com/nrslib/takt): start test generation and implementation on a cheap Flash-class model, and escalate to stronger models only when a step fails.

[English](README.md) | [日本語](README.ja.md)

## Highlights
- **Cheap first, strong when needed.** `write_tests` and the first `implement` run on a Flash-class model (T0). Re-implementation, fixes, and review run on mid (T1) and top (T2) models only when the cheap attempt does not pass.
- **Swap models without touching the workflow.** Which provider and model each tier uses lives in `runtime.yaml`, so the same workflow runs on a DGX Spark, on Ollama Cloud, or on any other provider.
- **Same quality gates as TAKT's `default`.** Scenario-based planning, test-first implementation, parallel peer review, adjudication, a convergent fix loop, and a final gate are all kept.

## Quickstart

### Requirements
- TAKT 0.66 or later (`npm i -g takt`)
- One provider with structured output for T1: `claude`, `claude-sdk`, `claude-terminal`, `codex`, or `opencode`
- Any provider for T0. OpenCode → local Ollama server → Ollama Cloud, and OpenCode → OpenCode Go, are verified options.

### Add it to the project you work in
Run the one-line installer inside the project. It downloads the bundle as a tarball (no git clone), copies `<lang>/{workflows,steps,facets}` into the project's `.takt/`, and creates `.takt/runtime.yaml` (step assignments) if there is none:

```sh
cd ~/work/my-app
curl -fsSL https://raw.githubusercontent.com/ideo-plus/takt-workflows/main/scripts/install.sh | sh -s -- ja    # or: en
```

Pin a version with `--ref` (any branch, tag, or commit): `... | sh -s -- ja --ref v1.0.0`. The installed language and ref are recorded in `.takt/.takt-workflows`.

Prefer a local checkout? Clone this repository **outside** the project (a clone inside a git repository becomes an embedded repository that git does not track) and run the same installer from it:

```sh
git clone https://github.com/ideo-plus/takt-workflows.git ~/src/takt-workflows
cd ~/work/my-app && ~/src/takt-workflows/scripts/use-lang.sh ja
```

### Commit, configure, run
```sh
git add .takt && git commit -m "chore: add takt flash-default workflow bundle"
takt workflow doctor flash-default
takt -w flash-default -t "Add ... with tests"
```

- Commit the copied files. TAKT runs tasks in worktree clones of the repository, so untracked files under `.takt/` are invisible to a run; TAKT's default `.takt/.gitignore` already tracks `workflows/`, `steps/`, and `facets/`.
- Define the tier profiles once per machine in `~/.takt/runtime.yaml` (see [Usage](#usage)).
- To update the bundle or switch language, run the installer again. It replaces only its own files and leaves other workflows in `.takt/` untouched.

## Usage

### Tiers
| Tier | Used for | What to put there | Verified example (provider / model) |
|---|---|---|---|
| T0 | `write_tests`, first `implement` | Flash-class model (DGX Spark, Ollama Cloud, LM Studio) | `opencode` / `ollama/glm-5.3-flash:cloud` (tests), `opencode` / `opencode-go/gpt-5.6-luna` (implement) |
| T1 | `reimplement`, `fix`, review companions, facet selector | Mid-size model with structured output | `claude` / `claude-sonnet-5` |
| T2 | `reimplement_final`, `fix` escalation, default for every other step | Strongest general model | `claude` / `claude-opus-5` |
| T3 (optional) | `plan`, `replan`, adjudication, `final-gate` | Top model for low-token, high-leverage judgment steps | `claude` / `claude-fable-5-1` (plan), `codex` / `gpt-6-astra` (judge) |

The examples are the exact profiles used in the verified full runs of this workflow; the `runtime.yaml` snippets use the same names.

### `~/.takt/runtime.yaml` — profiles (environment specific, not committed)
```yaml
version: 1
companion:
  enabled: true                       # required for the review companions
provider:
  defaults: { profile: t2 }
  profiles:
    # T0: Ollama Cloud through the local ollama server, and OpenCode Go, both via OpenCode
    t0-test-code:       { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t0-production-code: { provider: opencode, model: opencode-go/gpt-5.6-luna }
    t1: { provider: claude, model: claude-sonnet-5 }
    t2: { provider: claude, model: claude-opus-5 }
    # T3 (optional): planning and sign-off on different vendors, so the model that wrote the plan does not approve it
    t3-plan:  { provider: claude, model: claude-fable-5-1 }
    t3-judge: { provider: codex,  model: gpt-6-astra }
```

### `<project>/.takt/runtime.yaml` — step assignments
This is [`runtime.project.yaml`](runtime.project.yaml), which the installer copies into the project when no `.takt/runtime.yaml` exists.

```yaml
version: 1
provider:
  defaults: { profile: t2 }
  targets:
    steps:
      development-core/plan:                     { profile: t3-plan }
      development-core/replan:                   { profile: t3-plan }
      peer-review/review-adjudication:           { profile: t3-judge }
      peer-review/final-gate:                    { profile: t3-judge }
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

### Things to know
- Every profile referenced from a `ladder` must define both `provider` and `model`.
- When both files define `targets`, the project file replaces the global one. `profiles` are merged, project wins.
- A non-loopback `base_url` (for example a DGX Spark on the LAN) is only accepted in the global `~/.takt/runtime.yaml`.
- `~/.takt/runtime.yaml` (profiles) is per machine and never committed. `<project>/.takt/runtime.yaml` (step assignments) only names profiles, so a team can share it: add `!runtime.yaml` to the project's `.takt/.gitignore`, which ignores it by default.
- To switch T0 to a DGX Spark later, change only the two `t0-*` profiles.
- Top models hit rate limits sooner. Set `rate_limit_fallback.switch_chain` in `~/.takt/config.yaml` (for example `[{provider: claude, model: claude-opus-5}, {provider: codex, model: gpt-5.6-sol}]`) so a step that hits a limit is re-run on the next provider instead of failing.

## Getting help
- Issues: https://github.com/ideo-plus/takt-workflows/issues
- TAKT itself: [nrslib/takt](https://github.com/nrslib/takt)

## For workflow developers
- **Builtins are referenced, not copied.** Only `development-implement-dynamic` and `development-remediation-dynamic` are copied (as `flash-implement-dynamic` / `flash-remediation-dynamic`) to add the tier steps. Builtin facets are referenced through one-line `{extends:...}` files with a `builtin-` prefix.
- **Escalation is modelled as steps, not `promotion`.** `promotion: [{at: N}]` only advances a `ladder`, and a child workflow's iteration counter resets on every `workflow_call`, so `implement → reimplement → reimplement_final` are separate steps. `write_tests` and `fix` keep a real ladder because they loop inside one workflow.
- **`write_tests` promotion via step fragment.** `.takt/steps/development-core-write-tests.yaml` shadows the builtin fragment and adds `promotion`, so `development-core` itself is not copied. Note that this shadowing applies to every workflow in this project that uses `development-core`.
- **T0 context budget.** Policy + knowledge + instruction injected into `write_tests`, `implement`, and `reimplement` stay under 25 KB (`coding-lite`, `testing-lite`, `implementation-semantics`). Do not add full builtin policies to T0 steps.
- **Two languages, one structure.** `en/` and `ja/` must stay in sync: same file names, and the same YAML apart from `description`, rule `condition` text, and comments. The workflow YAMLs are the builtin `en` / `ja` workflows with the same edits applied, so change both when you change structure. In this repository, `.takt/{workflows,steps,facets}` are generated by `scripts/use-lang.sh` (run from the repository root) and are not tracked. `runtime.project.yaml` is the step-assignment template the installer copies into projects.
- Design notes and the `runtime.yaml` template: header comment of [`en/workflows/flash-default.yaml`](en/workflows/flash-default.yaml).
- Before submitting a change, run `scripts/use-lang.sh <lang>` followed by `takt workflow doctor flash-default` and `takt workflow inspect flash-default` for both languages.

## License
Not yet specified.
