# DDD Modeling Knowledge

## Project Files

A DDD project keeps its model and settings in files that live across tasks.

| File | Role |
|------|------|
| `.ddd.toml` (repository root) | Languages and the per-language choices: module layout and TypeScript code representation |
| `docs/ddd/domain-model.yaml` | The domain model declaration: the only definition of the business concepts |
| `docs/ddd/aggregate-mapping.yaml` | Where each model element lives in code, and the business vocabulary of domain packages |
| `docs/ddd/layer-structure.yaml` | Packages per bounded context, their roles and dependencies, ports, repositories, restoration paths |

### .ddd.toml

```toml
languages = ["rust", "typescript"]

[rust]
module_layout = "file"            # or "mod-rs"

[typescript]
module_layout = "named-file"      # or "index-file"
code_representation = "class"     # or "companion"
```

Keep only the tables of the languages listed. `file` and `named-file` are the usual choices for a new project.

### Domain model declaration

```yaml
bounded_contexts:
  - element_id: bc.billing
    name: Billing
    aggregates:
      - element_id: aggregate.invoice
        name: Invoice
        bounded_context: bc.billing
        root_element: entity.invoice
        states: [draft, issued]
        elements:
          - element_id: entity.invoice
            kind: entity
            name: Invoice
            aggregate: aggregate.invoice
            attributes:
              - { name: customer, type: primitive.customer-id, required: true }
              - { name: lines, type: vo.invoice-line, required: true, collection: true }
          - element_id: vo.invoice-line
            kind: value-object
            name: InvoiceLine
            aggregate: aggregate.invoice
            attributes: [{ name: amount, type: decimal, required: true }]
        invariants:
          - element_id: invariant.invoice.total-not-negative
            statement: The total of the lines is never negative.
        factory_rules:
          - element_id: factory.invoice.open
            target_element: entity.invoice
            preconditions: [A customer is given.]
            domain_errors:
              - { element_id: error.invoice.open.missing-customer, name: MissingCustomer, operation: factory.invoice.open, condition: No customer is given. }
        commands:
          - element_id: command.invoice.issue
            name: Issue
            effect: transition
            state_effect: transitions
            transitions: [transition.invoice.issue]
            idempotency: { strategy: none }
            domain_errors:
              - { element_id: error.invoice.issue.already-issued, name: AlreadyIssued, operation: command.invoice.issue, condition: The invoice is already issued. }
            events: [event.invoice.issued]
        events:
          - { element_id: event.invoice.issued, name: InvoiceIssued, produced_by: command.invoice.issue }
        transitions:
          - { element_id: transition.invoice.issue, from_state: draft, to_state: issued, command: command.invoice.issue }
    process_managers: []
lineage: []
```

Element IDs are `<kind>.<segments>` in lower kebab case. `bc`, `aggregate`, `entity`, `vo`, `primitive`, and `pm` take one segment; `invariant`, `command`, `event`, `transition`, and `factory` take the aggregate and a name; `error` takes the aggregate, the operation, and a name. A `lineage` entry (`lineage-0001`, relation `renamed`, `split`, `merged`, or `deprecated`) records how an ID changed.

### Aggregate mapping

```yaml
model_ref: docs/ddd/domain-model.yaml
aggregate_mappings:
  - aggregate_ref: aggregate.invoice
    programming_model: class
    persistence_method: state-sourcing
    reference_ids: [entity.invoice, vo.invoice-line, invariant.invoice.total-not-negative]
    replay_methods: []
    code: { language: rust, package: billing-domain, module: [invoice], type: Invoice, ports: [], repository: InvoiceRepository }
    operations:
      - operation_ref: factory.invoice.open
        code: { method: open, error_type: OpenInvoiceError }
        errors: [{ error_ref: error.invoice.open.missing-customer, code: { case: MissingCustomer } }]
      - operation_ref: command.invoice.issue
        code: { method: issue, error_type: IssueInvoiceError }
        errors: [{ error_ref: error.invoice.issue.already-issued, code: { case: AlreadyIssued } }]
domain_packages:
  - { term: billing, model_refs: [bc.billing], rationale: Everything a customer is billed for, code: { language: rust, package: billing-domain, module: [] } }
  - { term: invoice, model_refs: [aggregate.invoice], rationale: The invoice and its lines change together, code: { language: rust, package: billing-domain, module: [invoice] } }
```

`module` lists the segments below the package root, so the root is `[]`. Every level from the root down is declared. In TypeScript the case strings are the literal union members (`already-issued`); in Rust they are enum variants (`AlreadyIssued`).

### Layer structure

```yaml
model_ref: docs/ddd/domain-model.yaml
layer_structures:
  - context_ref: bc.billing
    cqrs: true
    packages:
      - { role: command, code: { language: rust, package: billing-domain } }
      - { role: query, code: { language: rust, package: billing-query } }
      - { role: rmu, code: { language: rust, package: billing-rmu } }
    dependencies:
      - { code: { language: rust, package: billing-domain }, depends_on: [] }
      - { code: { language: rust, package: billing-query }, depends_on: [] }
      - { code: { language: rust, package: billing-rmu }, depends_on: [{ language: rust, package: billing-domain }, { language: rust, package: billing-query }] }
    ports:
      - { name: InvoiceRepository, kind: repository, verbs: [find_by_id, store, delete_by_id] }
    repositories:
      - { name: InvoiceRepository, aggregate_ref: aggregate.invoice, io_unit: single, verbs: [find_by_id, store, delete_by_id], store_semantics: upsert }
    restoration_paths:
      - { aggregate_ref: aggregate.invoice, via: full-constructor }
    persistence_backend: PostgreSQL
```

## Deriving the Model

The model is derived from behavior, not from data tables: stories give past-tense domain events, each event has the command and actor that produce it, events that change the same state group into an aggregate, and the aggregate's invariant explains why they belong together.

| Condition | Meaning / options |
|-----------|-------------------|
| A candidate cannot state an invariant it protects | Merge it into another aggregate or demote it to a value or Entity |
| Two candidates must change together to keep a rule true | One aggregate, or a Process Manager if they must stay separate |
| A flow crosses aggregates | Process Manager candidate; the steps and compensations are recorded in the model |
| An operation never changes state | `state_effect: none`, which is a valid declaration |
| A term exists only in code, not in the business vocabulary | Clarify it before naming a package after it |

## Two Axes per Aggregate

Execution model and persistence are independent choices, and both are independent of the TypeScript code representation.

| Axis | Values | Meaning |
|------|--------|---------|
| `programming_model` | `class` | The aggregate is an object called by the use case |
| | `actor` | The aggregate receives messages; multi-aggregate flows need a Process Manager |
| `persistence_method` | `state-sourcing` | The current state is stored; `store` re-persists it with an expected version |
| | `event-sourcing` | Events are appended; state is rebuilt by replaying declared methods |

State sourcing can still emit domain events. Event sourcing separates deciding (a command checks rules and yields events) from applying (a replay method changes state from a fact and decides nothing).

## Idempotency and Recovery

| Condition | Meaning / options |
|-----------|-------------------|
| `effect: transition` | Repeating the command finds the target state already reached; the transition itself guards it |
| `effect: accumulation` | Repeating adds twice; remember command IDs (`command-id-memory`) with a retention of several IDs or a time window |
| Only the last command ID is remembered | Does not stop the resend of C1 after C2 |
| The persistence outcome is unknown | Reconcile by request ID before retrying |
| A multi-aggregate flow fails midway | Earlier commits remain; recover by re-execution or compensation, which is a new business operation |

| Recovery policy | Meaning |
|-----------------|---------|
| `caller-retry` | The caller retries the whole use case safely |
| `step-backoff` | A failed step retries with backoff |
| `both` | Both mechanisms apply |

A use case declared in a plan states: `use_case_id` (`uc.<slug>`), `name`, `target_aggregates`, `commands`, `re_execution_basis`, `recovery_policy`, `multi_aggregate_strategy` (`process-manager` with a `pm.*` reference, or `re-execution` with a rationale) when it targets several aggregates, and `read_model_exposure`.

## CQRS and Read Models

| Condition | Meaning / options |
|-----------|-------------------|
| Queries need shapes the aggregate does not have | Query side with DAOs and DTOs, updated by a read-model updater |
| The read model is updated asynchronously | It may be stale; state the delay where callers depend on it |
| Events arrive out of order or twice | Track the per-aggregate sequence and processed event IDs; commit the update and the processed marker atomically |
| An update needs a fact from another aggregate | Load that aggregate or let a Process Manager coordinate; the read model is not a source of decisions |

## Layers

| Layer | Holds | Depends on |
|-------|-------|------------|
| domain | Aggregates, Entities, value objects, Domain Primitives, stateless domain services, ports the domain needs | infrastructure |
| use-case | Loading, calling domain operations, storing, recovery; command-side `execute(ID, values)`; query use cases | domain, infrastructure |
| interface-adapter | Controllers, repository implementations, DAOs, database and RPC clients | use-case, domain, infrastructure |
| infrastructure | Language extensions only, such as `Result` in TypeScript | none |
| composition root | Wiring of implementations to ports | every layer |
| read-model updater | Projecting events into read models | both sides |

The query side has use-case and interface-adapter layers only; it has no domain layer of its own.
