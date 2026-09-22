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
- Any provider for T0. OpenCode → local Ollama server → Ollama Cloud is a verified option.

### Install
The bundle ships in two languages with identical structure, `en/` and `ja/`, mirroring TAKT's own `builtins/{en,ja}` layout. Pick the one that matches the `language` in your TAKT config and copy it into `.takt/`:

```sh
git clone https://github.com/ideo-plus/takt-workflows.git
cd takt-workflows
scripts/use-lang.sh en      # or: ja  (copies en/{workflows,steps,facets} into .takt/)
```

To use the bundle in another project, copy `<lang>/workflows`, `<lang>/steps`, and `<lang>/facets` into that project's `.takt/` directory. TAKT resolves project resources only from `.takt/`, has no language-aware project layer, and refuses symlinked resource directories, so the active language is always a copy.

### Run
1. Define the tier profiles in `~/.takt/runtime.yaml` (see [Usage](#usage)).
2. Assign the profiles to steps in `<project>/.takt/runtime.yaml`.
3. Validate and run:

```sh
takt workflow doctor flash-default    # schema and reference check
takt workflow inspect flash-default   # resolved provider/model per step
takt -w flash-default -t "Add ... with tests"
```

## Usage

### Tiers
| Tier | Used for | What to put there | Verified example (provider / model) |
|---|---|---|---|
| T0 | `write_tests`, first `implement` | Flash-class model (DGX Spark, Ollama Cloud, LM Studio) | `opencode` / `ollama/glm-5.3-flash:cloud` |
| T1 | `reimplement`, `fix`, review companions, facet selector | Mid-size model with structured output | `codex` / `gpt-5.6-sol` |
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
    # T0: verified with OpenCode -> local ollama server -> Ollama Cloud
    t0-test-code:       { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t0-production-code: { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t1: { provider: codex,  model: gpt-5.6-sol }
    t2: { provider: claude, model: claude-opus-5 }
    # T3 (optional): planning and sign-off on different vendors, so the model that wrote the plan does not approve it
    t3-plan:  { provider: claude, model: claude-fable-5-1 }
    t3-judge: { provider: codex,  model: gpt-6-astra }
```

### `<project>/.takt/runtime.yaml` — step assignments
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
- `runtime.yaml` is outside the `.takt/.gitignore` allowlist on purpose: it is per-environment and never committed.
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
- **Two languages, one structure.** `en/` and `ja/` must stay in sync: same file names, and the same YAML apart from `description`, rule `condition` text, and comments. The workflow YAMLs are the builtin `en` / `ja` workflows with the same edits applied, so change both when you change structure. `.takt/{workflows,steps,facets}` are generated by `scripts/use-lang.sh` and are not tracked.
- Design notes and the `runtime.yaml` template: header comment of [`en/workflows/flash-default.yaml`](en/workflows/flash-default.yaml).
- Before submitting a change, run `scripts/use-lang.sh <lang>` followed by `takt workflow doctor flash-default` and `takt workflow inspect flash-default` for both languages.

## License
Not yet specified.
