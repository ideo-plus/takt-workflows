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

An attribute's `type` is a language-independent scalar (`string`, `integer`, `decimal`, `boolean`, `date`, or `datetime`) or a model element ID. Use `integer` for integer identifiers. Do not use implementation-language types such as TypeScript `number` or Rust `u64` here; declare code types, locations, and methods in the aggregate mapping.

```yaml
bounded_contexts:
- element_id: bc.billing
  name: Billing
  aggregates:
  - element_id: aggregate.invoice
    name: Invoice
    bounded_context: bc.billing
    root_element: entity.invoice
    states:
    - draft
    - issued
    elements:
    - element_id: entity.invoice
      kind: entity
      name: Invoice
      aggregate: aggregate.invoice
    - element_id: vo.invoice-line
      kind: value-object
      name: InvoiceLine
      aggregate: aggregate.invoice
    - element_id: primitive.customer-id
      kind: domain-primitive
      name: CustomerId
      aggregate: aggregate.invoice
      attributes:
      - name: value
        type: string
        required: true
    - element_id: primitive.money
      kind: domain-primitive
      name: Money
      aggregate: aggregate.invoice
      attributes:
      - name: value
        type: decimal
        required: true
    invariants:
    - element_id: invariant.invoice.money-increment
      name: MoneyIncrement
      aggregate: aggregate.invoice
      element: primitive.money
      statement: monetary amounts are finite integer multiples of 100; negative discounts
        and zero are permitted
    - element_id: invariant.invoice.customer-id-format
      name: CustomerIdFormat
      aggregate: aggregate.invoice
      element: primitive.customer-id
      statement: a customer ID is C followed by six digits
    - element_id: invariant.invoice.total-not-negative
      name: TotalNotNegative
      aggregate: aggregate.invoice
      statement: the total of the lines is never negative
    - element_id: invariant.invoice.issued-has-lines
      name: IssuedHasLines
      aggregate: aggregate.invoice
      statement: an issued invoice has at least one line
    commands:
    - element_id: command.invoice.add-line
      name: AddLine
      aggregate: aggregate.invoice
      effect: accumulation
      state_effect: none
      domain_errors:
      - element_id: error.invoice.add-line.already-issued
        name: AlreadyIssued
        operation: command.invoice.add-line
        condition: the invoice is issued
      - element_id: error.invoice.add-line.negative-total
        name: NegativeTotal
        operation: command.invoice.add-line
        condition: the line would make the total negative
      event: event.invoice.line-added
      idempotency:
        strategy: command-id-memory
        retention: last-one
        rationale: a client sends the next add-line of an invoice only after the previous
          one is acknowledged, so an older add-line is never resent after a newer
          one
    - element_id: command.invoice.issue
      name: Issue
      aggregate: aggregate.invoice
      effect: transition
      state_effect: transitions
      transitions:
      - transition.invoice.issue
      domain_errors:
      - element_id: error.invoice.issue.already-issued
        name: AlreadyIssued
        operation: command.invoice.issue
        condition: the invoice is issued
      - element_id: error.invoice.issue.empty-lines
        name: EmptyLines
        operation: command.invoice.issue
        condition: the invoice has no line
      event: event.invoice.issued
      idempotency:
        strategy: none
    events:
    - element_id: event.invoice.opened
      name: Opened
      aggregate: aggregate.invoice
      produced_by: factory.invoice.open
    - element_id: event.invoice.line-added
      name: LineAdded
      aggregate: aggregate.invoice
      produced_by: command.invoice.add-line
    - element_id: event.invoice.issued
      name: Issued
      aggregate: aggregate.invoice
      produced_by: command.invoice.issue
    transitions:
    - element_id: transition.invoice.issue
      name: Issue
      aggregate: aggregate.invoice
      from_state: draft
      to_state: issued
      command: command.invoice.issue
    factory_rules:
    - element_id: factory.invoice.open
      name: Open
      target_element: entity.invoice
      preconditions:
      - invariant.invoice.total-not-negative
      domain_errors:
      - element_id: error.invoice.open.negative-total
        name: NegativeTotal
        operation: factory.invoice.open
        condition: the lines add up to a negative total
    - element_id: factory.invoice.parse-customer-id
      name: ParseCustomerId
      target_element: primitive.customer-id
      preconditions:
      - invariant.invoice.customer-id-format
      domain_errors:
      - element_id: error.invoice.parse-customer-id.invalid-format
        name: InvalidFormat
        operation: factory.invoice.parse-customer-id
        condition: the value is not C followed by six digits
    - element_id: factory.invoice.parse-money
      name: ParseMoney
      target_element: primitive.money
      preconditions:
      - invariant.invoice.money-increment
      domain_errors:
      - element_id: error.invoice.parse-money.invalid-increment
        name: InvalidIncrement
        operation: factory.invoice.parse-money
        condition: the amount is not a finite integer multiple of 100
lineage: []
```

Element IDs are `<kind>.<segments>` in lower kebab case. `bc`, `aggregate`, `entity`, `vo`, `primitive`, and `pm` take one segment; `invariant`, `command`, `event`, `transition`, and `factory` take the aggregate and a name; `error` takes the aggregate, the operation, and a name. A `lineage` entry (`lineage-0001`, relation `renamed`, `split`, `merged`, or `deprecated`) records how an ID changed.

A Domain Primitive (`kind: domain-primitive`) wraps one attribute and has a domain invariant narrower than its backing type. Declare invariants whose `element` names the primitive and a `parse` factory rule whose `preconditions` include every such invariant. Always provide both `of` and `parse`: `of` passes the unchanged input to `parse` and throws or panics on a caller contract violation; `parse` checks the invariants before initialization and returns its own error type in Result. Do not introduce a DP when the backing type alone expresses the valid domain. Resolve unspecified value rules as open questions rather than declaring an unconstrained DP. Attributes with `collection: true` use first-class collection types.

### Aggregate mapping

```yaml
model_ref: domain-model.yaml
aggregate_mappings:
- aggregate_ref: aggregate.invoice
  programming_model: class
  persistence_method: event-sourcing
  reference_ids:
  - entity.invoice
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
    type: Invoice
  operations:
  - operation_ref: factory.invoice.open
    code:
      method: open
      error_type: OpenInvoiceError
    errors:
    - error_ref: error.invoice.open.negative-total
      code:
        case: negative-total
  - operation_ref: factory.invoice.parse-customer-id
    code:
      method: parse
      error_type: ParseCustomerIdError
    errors:
    - error_ref: error.invoice.parse-customer-id.invalid-format
      code:
        case: invalid-format
  - operation_ref: factory.invoice.parse-money
    code:
      method: parse
      error_type: ParseMoneyError
    errors:
    - error_ref: error.invoice.parse-money.invalid-increment
      code:
        case: invalid-increment
  - operation_ref: command.invoice.add-line
    code:
      method: addLine
      success_type: AddInvoiceLineOutcome
      error_type: AddInvoiceLineError
    errors:
    - error_ref: error.invoice.add-line.already-issued
      code:
        case: already-issued
    - error_ref: error.invoice.add-line.negative-total
      code:
        case: negative-total
  - operation_ref: command.invoice.issue
    code:
      method: issue
      success_type: IssueInvoiceOutcome
      error_type: IssueInvoiceError
    errors:
    - error_ref: error.invoice.issue.already-issued
      code:
        case: already-issued
    - error_ref: error.invoice.issue.empty-lines
      code:
        case: empty-lines
  replay_methods:
  - event_ref: event.invoice.opened
    code:
      method: fromOpened
  - event_ref: event.invoice.line-added
    code:
      method: applyLineAdded
  - event_ref: event.invoice.issued
    code:
      method: applyIssued
domain_packages:
- term: Billing
  model_refs:
  - bc.billing
  rationale: owns the billing business
  code:
    language: typescript
    package: '@acme/billing-domain'
    module: []
- term: Invoice
  model_refs:
  - aggregate.invoice
  rationale: opens and issues invoices
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
- term: Invoice line
  model_refs:
  - vo.invoice-line
  rationale: one amount an invoice adds up
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
    - line
- term: Invoice lines
  model_refs:
  - vo.invoice-line
  rationale: the lines of one invoice and their total
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
    - lines
- term: Customer ID
  model_refs:
  - primitive.customer-id
  rationale: identifies the customer an invoice bills
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - customer-id
- term: Money
  model_refs:
  - primitive.money
  rationale: the amount of a line and the total of an invoice
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - money
```

`model_ref` is relative to `docs/ddd`. `success_type` names what a command returns on success: in TypeScript the outcome type holding the new instance and the event, in Rust the event, or an outcome enum when the command recognizes resent commands. A factory rule's success is the aggregate type. `module` lists the segments below the package root, so the root is `[]`. Every level from the root down is declared. In TypeScript the case strings are the literal union members (`already-issued`); in Rust they are enum variants (`AlreadyIssued`).

### Layer structure

```yaml
model_ref: domain-model.yaml
layer_structures:
- context_ref: bc.billing
  cqrs: false
  packages:
  - role: command
    code:
      language: typescript
      package: '@acme/billing-domain'
  - role: command
    code:
      language: typescript
      package: '@acme/billing-use-case'
  - role: command
    code:
      language: typescript
      package: '@acme/billing-interface-adapter'
  dependencies:
  - code:
      language: typescript
      package: '@acme/billing-domain'
    depends_on:
    - language: typescript
      package: '@acme/language-extensions'
  - code:
      language: typescript
      package: '@acme/billing-use-case'
    depends_on:
    - language: typescript
      package: '@acme/billing-domain'
    - language: typescript
      package: '@acme/language-extensions'
  - code:
      language: typescript
      package: '@acme/billing-interface-adapter'
    depends_on:
    - language: typescript
      package: '@acme/billing-domain'
    - language: typescript
      package: '@acme/billing-use-case'
    - language: typescript
      package: '@acme/language-extensions'
  ports:
  - name: InvoiceRepository
    kind: repository
    verbs:
    - findById
    - store
  repositories:
  - name: InvoiceRepository
    aggregate_ref: aggregate.invoice
    io_unit: single
    verbs:
    - findById
    - store
    store_semantics: append-only
  restoration_paths:
  - aggregate_ref: aggregate.invoice
    via: event-replay
  persistence_backend: in-memory
```

`packages` lists the context's own packages with the CQRS side each stands on (`role`). A shared package outside the context, such as the language extensions (`@acme/language-extensions`), stands on no side, so it has no `packages` row and appears only in the `depends_on` of the packages that use it. A dependency row lists every package its `package.json` or `Cargo.toml` depends on directly.

An aggregate-only context with no persistence still declares its package, dependency row, and restoration path. It may explicitly declare `ports: []`, `repositories: []`, and `persistence_backend: none`.


Event Sourcing declares `via: event-replay` regardless of the storage medium. Its repository keeps ordered, append-only domain events and snapshots of the aggregate itself. Loading applies the events after the latest snapshot through the aggregate's declared replay methods. The memory maps are one map of event streams and one map whose values are the aggregate itself as snapshots, not state-storage wrappers that copy the aggregate's state into another type.

## Choosing Factory Names

Choose the name from its purpose and declare the implementation name in the aggregate mapping's `code.method`. These are this project's conventions, adapted to each language.

| Name | Meaning and use |
|------|-----------------|
| `of` | Construct a VO from one value or several components; not restricted to several arguments. A DP validates backing input and panics/throws on a caller contract violation |
| `parse` | Interpret and validate input, returning a Result with an operation-owned error. Typed numeric input such as `ReservationId::parse(value: u64)` is valid |
| `from` | Convert a meaningfully distinct type. Do not use this name for a same-type copy or only wrapping DP backing input |
| `create` | Create an Entity or domain object; prefer a business name such as `reserve` or `open` when it expresses the operation |
| `generate` | Generate a value through computation or an algorithm, deterministic or random. Generated DP values also pass invariant validation |
| `valueOf` | A technical API convention for obtaining an object representing a value; caching is an implementation choice. Standardize new domain APIs on `of`/`parse` |
| `getInstance` | Acquire the instance to use. State sharing, caching, and singleton guarantees separately in its contract |
| `newInstance` | Construct a fresh instance. Prefer `of`/`create`/business names in the domain and review freshness in the implementation |

Rust uses snake_case, including `value_of`, `get_instance`, and `new_instance`. Rust `from` is infallible; a fallible conversion uses `try_from` and Result. A fallible TypeScript `from` returns a Result with an operation-owned error. TypeScript instance `valueOf()` is a language conversion hook, separate from a static factory.

The naming linter checks the structure of `of`, `parse`, `from`, and Rust `try_from`. Review caching, freshness, and algorithmic meaning. ES `replay` and declared replay methods remain dedicated history application paths.

Primary references: [LocalDate.of](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html), [Integer.valueOf/parseInt](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Integer.html), [Calendar implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/util/Calendar.java), [UUID.randomUUID](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/UUID.html), [Rust From](https://doc.rust-lang.org/std/convert/trait.From.html), and [ECMAScript valueOf](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.prototype.valueof). The Java three-argument date example is `LocalDate.of(year, month, day)`; the standard UUID generation example is `UUID.randomUUID()`.

## Deriving the Model

The model is derived from behavior, not from data tables: stories give past-tense domain events, each event has the command and actor that produce it, events that change the same state group into an aggregate, and the aggregate's invariant explains why they belong together.

| Condition | Meaning / options |
|-----------|-------------------|
| A candidate cannot state an invariant it protects | Merge it into another aggregate or demote it to a value or Entity |
| Two candidates must change together to keep a rule true | One aggregate, or a Process Manager if they must stay separate |
| A flow crosses aggregates | Process Manager candidate; the steps and compensations are recorded in the model |
| An operation never changes state | `state_effect: none`, which is a valid declaration |
| A term exists only in code, not in the business vocabulary | Clarify it before naming a package after it |

## Modules

Divide a domain package into Modules in Evans's sense. A Module is part of the model, not a technical bucket that holds code by kind. Put cohesive concepts in one Module and keep the dependencies between Modules few. Name a Module from the ubiquitous language (declared as a business term in `domain_packages` of the aggregate mapping), so the list of Modules tells how the domain is organized. When the model changes, regroup the Modules too.

A Module may hold one Aggregate or several cohesive Aggregates. Choose by the business reason for understanding the concepts together, not by their count. Sharing a Module does not merge the boundaries that protect each Aggregate's invariants and consistency. Vernon's `team` Module contains the `ProductOwner`, `Team`, and `TeamMember` Aggregates together with `MemberService`.

Support both detailed study within a Module and a view of relationships between Modules that omits their internal details. If a partition obscures conceptual relationships, reconsider the grouping or the model itself. When fewer dependencies conflict with conceptual clarity, favor conceptual clarity.

Strive for unidirectional, acyclic dependencies between peer Modules. Avoid cycles between parents and children too, but assess the business need for relationships such as a parent creating a child that refers to the parent's identity. Complete independence and dependency counts alone are not the goal.

Modules organize one model internally. A Bounded Context defines where the model's terms and rules have consistent meaning. When terminology is ambiguous and there is no clear reason for separate models, first consider separate Modules within the same Context. Do not create Contexts merely because the number of Modules or Aggregates grows.

Record Module design decisions in `model_refs` and `rationale` of the aggregate mapping's `domain_packages`: which concepts are grouped, why they should be understood together, dependencies on other Modules, and reasons for splitting, merging, or renaming. Physical file placement follows the module layout policy.

Primary sources: Eric Evans, *Domain-Driven Design*, Chapter 5, "Modules (a.k.a. Packages)" (pp. 109–114), Chapter 7, "Modules in the Shipping Model" (pp. 179–181), and Chapter 14, "Bounded Contexts Are Not Modules" (p. 336). Vaughn Vernon, *Implementing Domain-Driven Design*, Chapter 9, Table 9.1 in "Designing with Modules" (pp. 334–335), "Modules of the Agile Project Management Context" (pp. 340–342), and "Module before Bounded Context" (p. 344). The file layout below is this project's application of these principles.

| Type | Where it goes |
|------|---------------|
| A type that belongs to one concept (the aggregate root, its identifier, a value object such as a line, a command ID the aggregate remembers) | Under that concept's Module (`invoice/`) |
| A value several concepts use (an amount) | A Module named by its responsibility (`money`) |
| An ID that refers to another aggregate (a customer ID) | The Module of the concept it refers to (`customer-id`) |

While the concepts are few, a handful of Modules at the package root is enough. With the IDs wrapped, it looks like this (TypeScript, `named-file`):

```text
packages/command/billing-domain/src/
  index.ts
  invoice.ts          # the invoice: aggregate root, errors, events
  invoice/
    invoice-id.ts     # identifies the invoice
    command-id.ts     # the add-line command ID the invoice remembers
    line.ts           # a line
    lines.ts          # the lines
  customer-id.ts      # identifies the customer billed
  money.ts            # the amount of a line and the total of an invoice
```

Once the concepts grow and the root no longer shows how the domain is organized, regroup cohesive concepts into Modules. For example, when credit is handled, the customer ID moves with the credit limit into a `customer` Module, and handling payments brings a `payment` Module. Do not make Modules that group types by kind, such as `ids`, `primitives`, or `value-objects`. Rust is the same: under the `file` layout, `invoice.rs` and `invoice/invoice_id.rs`.

## Two Axes per Aggregate

This workflow standardizes persistence on Event Sourcing.

The repository public boundary is the aggregate. findById (Rust: find_by_id) returns the aggregate it builds by replaying the events after the latest snapshot onto it, as Result<Aggregate | undefined, RepositoryError> (Rust: Result<Option<Aggregate>, RepositoryError>). store receives the newly produced domain event, which carries the aggregate ID, and the aggregate right after it as the snapshot (store(event, snapshot)), and returns Result<void, RepositoryError> (Rust: Result<(), RepositoryError>) after appending it; it takes no separate aggregate ID. Keep loadEvents and history replay inside the adapter. Declare this boundary in the plan API and acceptance conditions.

Keep State Sourcing examples and storage routes out of the standard knowledge.

Execution model and persistence are independent choices, and both are independent of the TypeScript code representation.

| Axis | Values | Meaning |
|------|--------|---------|
| `programming_model` | `class` | The aggregate is an object called by the use case |
| | `actor` | The aggregate receives messages; multi-aggregate flows need a Process Manager |
| `persistence_method` | `event-sourcing` | Events are appended; state is rebuilt by replaying declared methods |

A root factory validates every invariant before creating a complete aggregate and its creation event. The creation event's produced_by refers to the aggregate root factory. The factory returns the aggregate, which exposes the creation event through a read-only operation. Restoration applies the first creation event through the same replay factory. Do not build an incomplete aggregate and finish initialization later.

Every command that changes state returns the one event it produced, whichever the persistence method. With event sourcing the command changes the state through a declared replay method, and restoring replays the stored events through the same method; the replay method decides nothing.

## Idempotency and Recovery

| Condition | Meaning / options |
|-----------|-------------------|
| `effect: transition` | Repeating the command finds the target state already reached; the transition itself guards it |
| `effect: accumulation` | Repeating adds twice; remember command IDs (`command-id-memory`): the last one (`last-one`) when the rationale states why an older command is never resent after a newer one, otherwise several IDs (`multiple`) or a time window (`time-window`) |
| Only the last command ID is remembered | Does not stop the resend of C1 after C2 |
| The persistence outcome is unknown | Reconcile by command ID before retrying |
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
| domain | Aggregates, Entities, value objects, Domain Primitives, stateless domain services | infrastructure |
| use-case | Ports (repository ports and the other ports the layer structure declares); loading, calling domain operations, storing, recovery; command-side `execute(ID, values)`; query use cases | domain, infrastructure |
| interface-adapter | Controllers, repository implementations, DAOs, database and RPC clients | use-case, domain, infrastructure |
| infrastructure | Language extensions only, such as `Result` in TypeScript | none |
| composition root | Wiring of implementations to ports | every layer |
| read-model updater | Projecting events into read models | both sides |

The query side has use-case and interface-adapter layers only; it has no domain layer of its own.
