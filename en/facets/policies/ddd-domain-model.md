# DDD Domain Model Policy

Defines what the declarations under `docs/ddd/` (domain model, aggregate mapping, layer structure) contain, and the order of declarations and code. Whether code agrees with the declarations is judged by the domain layer policy.

## Domain Model (`docs/ddd/domain-model.yaml`)

| Criterion | Judgment |
|-----------|----------|
| An aggregate, element, invariant, command, factory rule, event, error, or state is defined outside the domain model (in the mapping, a plan, code, or a review) | REJECT. Define it in the domain model; cite its model ID everywhere else |
| An aggregate has no invariant | REJECT. Merge or demote the candidate |
| A command does not state its state effect (`transitions` or `none`), or the stated effect disagrees with its transitions | REJECT |
| A command declares no event or more than one (`events: [...]`), or its `event` is produced by another command | REJECT. A command produces exactly one event (`event: <event ID>`) |
| A command or factory rule has no domain error, or names an error owned by another operation | REJECT |
| A command with `effect: accumulation` has no `command-id-memory` idempotency strategy | REJECT |
| A command with `retention: last-one` has no `rationale` stating why an older command is never resent after a newer one (`C1 → C2 → retry C1`) | REJECT. Choose `multiple` or `time-window` when it can be |
| A Domain Primitive lacks a domain invariant narrower than the backing type or a parse factory rule whose preconditions include all its invariants | REJECT. Initialize DP values from their invariants; use the backing type directly when it alone expresses the domain |
| An element attribute holds an element of another aggregate as its type instead of its ID | REJECT. Refer to other aggregates by ID |
| An element ID is renamed, reused after retirement, or does not follow `<kind>.<segments>` | REJECT. A rename changes only `name` |
| A split, merge, or deprecation is not recorded in `lineage` | REJECT |
| The model decides modules, packages, ports, repositories, or use-case procedures | REJECT. Write them in the aggregate mapping and the layer structure |

## Aggregate Mapping (`docs/ddd/aggregate-mapping.yaml`)

| Criterion | Judgment |
|-----------|----------|
| An aggregate of the model has no mapping row | REJECT |
| An aggregate does not declare `programming_model` (`actor` or `class`) and `persistence_method` (`state-sourcing` or `event-sourcing`) | REJECT |
| A command or factory rule has no method and error type, a command has no `success_type`, or a domain error has no case | REJECT |
| An event-sourced aggregate does not declare the methods that apply its events in `replay_methods` | REJECT |
| A package or module that holds domain code, or one of its parent levels, is missing from `domain_packages` | REJECT |
| A `domain_packages` entry has no business term, model references, or rationale | REJECT |

## Layer Structure (`docs/ddd/layer-structure.yaml`)

| Criterion | Judgment |
|-----------|----------|
| A package the change places code in, its dependencies, ports, repositories, or restoration paths are not declared | REJECT. An aggregate-only context with `persistence_backend: none` may explicitly declare empty `ports` and `repositories`; dependency rows and restoration paths remain required. A shared package outside the context, such as the language extensions, has no `packages` row; it appears only in the `depends_on` of the packages that use it |
| A port is not classified as `repository`, `external-client`, or `es-infrastructure` | REJECT |

## Order of Declarations and Code

| Criterion | Judgment |
|-----------|----------|
| Code changes business behavior before the declarations do | REJECT. Update the declarations first |
| A declaration needed to write correct code is missing | Record the missing declaration; do not invent it in code |
| The model and an explicit project rule conflict | Neither silently wins. Record the conflict, its scope, and its resolution |
