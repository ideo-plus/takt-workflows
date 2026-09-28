# DDD Model Policy

Keep one domain model declaration as the only definition of the business concepts, and make plans, code, and reviews reference it by stable ID instead of redefining it.

## Principles

| Principle | Criterion |
|-----------|-----------|
| One source of truth | Aggregates, elements, invariants, commands, factory rules, events, errors, and states are defined only in the domain model declaration |
| Model before code | A change that adds or alters business behavior updates the declaration first; code follows it |
| Every aggregate owns invariants | An aggregate without an invariant is not an aggregate boundary |
| Every operation owns its errors | Each command and factory rule declares its own domain errors; errors are never shared between operations |
| Stable identity | An element ID never changes; renaming changes the name only |
| Reference, do not redefine | Mappings, plans, code, and reviews cite model IDs |
| Mapping covers the model | Every aggregate, operation, and error of the model has a code location in the aggregate mapping |

## Domain Model Declaration

| Criterion | Judgment |
|-----------|----------|
| Code adds a business operation, domain error, invariant, state, or event that the declaration does not contain | REJECT. Declare it in the model first |
| An aggregate has no invariant | REJECT. Merge or demote the candidate |
| A command does not state its state effect (`transitions` or `none`), or the stated effect disagrees with its transitions | REJECT |
| A command or factory rule has no domain error, or names an error owned by another operation | REJECT |
| A command with `effect: accumulation` has no `command-id-memory` idempotency strategy | REJECT |
| An element ID is renamed, reused after retirement, or does not follow `<kind>.<segments>` | REJECT |
| A split, merge, or deprecation is not recorded in `lineage` | REJECT |
| A reference to another aggregate embeds it instead of citing its ID | REJECT |
| The model decides modules, packages, ports, repositories, or use-case procedures | REJECT. Those belong to the mapping and the code |

## Aggregate Mapping

| Criterion | Judgment |
|-----------|----------|
| An aggregate of the model has no mapping row | REJECT |
| An aggregate does not declare `programming_model` (`actor` or `class`) and `persistence_method` (`state-sourcing` or `event-sourcing`) | REJECT |
| A command or factory rule has no mapped method and error type, or a domain error has no mapped case | REJECT |
| An event-sourced aggregate applies events through methods not listed in `replay_methods` | REJECT |
| A mapping row redefines an element instead of citing its ID | REJECT |
| A package or module that holds domain code is missing from `domain_packages`, or its parent levels are missing | REJECT |
| A `domain_packages` entry has no business term, model references, or rationale | REJECT |

## Consistency Between Model and Code

| Criterion | Judgment |
|-----------|----------|
| Code implements the operations, errors, and replay methods exactly as the mapping names them | OK |
| Code and mapping disagree, and the code is updated without updating the mapping | REJECT |
| A reviewer finds a model gap that blocks correct code | Record the missing declaration; do not invent it in code |
| The model and an explicit project policy conflict | Do not silently override either; record the conflict, its scope, and the resolution |
