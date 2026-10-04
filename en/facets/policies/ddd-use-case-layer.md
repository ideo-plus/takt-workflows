# DDD Use-Case Layer Policy

For a State Sourcing single-aggregate repository, load returns Result<Aggregate | undefined, RepositoryError> (Rust: Result<Option<Aggregate>, RepositoryError>), and store returns Result<void, RepositoryError> (Rust: Result<(), RepositoryError>). Do not create operation-specific Result aliases, persistence DTOs or return wrappers that add no meaning. Reusable generic aliases are allowed. Infrastructure failures use the common RepositoryError rather than per-operation error types.

Event Sourcing loads domain event streams and appends newly produced events. Do not impose the State Sourcing aggregate-storage signature on these event operations. Report infrastructure failures through the common RepositoryError; publish a successful event only after its append succeeds.

Judges the code of the use-case layer. A use case orchestrates: it loads, calls domain operations, and stores. This policy covers the shape of a use case, re-execution and publishing, multiple aggregates, and decisions from read models. Where decisions are made and command-ID memory belong to the domain layer policy; allowed dependencies belong to the layer dependency policy.

## Use-Case Shape

| Criterion | Judgment |
|-----------|----------|
| A command-side `execute` receives an aggregate, an Entity, or a request DTO that wraps primitives | REJECT. Receive IDs and value objects; convert requests to them at the adapter. Generic guidance to pass input DTOs applies to query-side use cases only |
| A use case calls another use case's `execute` | REJECT |
| A port is held in a field or parameter typed as the port | OK |
| A field or parameter that holds a port is not named after the port (`invoice_repository` or `#invoiceRepository` for `InvoiceRepository`), for example a plural of the aggregate such as `invoices` | REJECT |
| The type whose method is `execute` is not named `<Verb><Object>UseCase` (`IssueInvoiceUseCase`) | REJECT. A use case written as a bare function has no type to name |

## Re-Execution and Publishing

| Criterion | Judgment |
|-----------|----------|
| A step has no stated reason why re-executing it is safe | REJECT |
| An unknown persistence outcome is retried without reconciliation by command ID or equivalent evidence | REJECT |
| A command's first success, duplicate success, and rejection are not returned in a form the caller can tell apart | REJECT |
| Events or new state are published before persistence succeeds | REJECT |
| The `Result` of a repository port is dropped, or an event is returned although the store failed | REJECT. Return the failure as an error of the use case |
| Upsert is presented as sufficient proof of idempotency | REJECT. State the idempotency strategy |

## Multiple Aggregates

| Criterion | Judgment |
|-----------|----------|
| One transaction changes several aggregates without an explicit strategy | REJECT |
| A multi-aggregate use case has no Process Manager and no re-execution rationale | REJECT |
| All target aggregates use `programming_model: actor` and no Process Manager is used | REJECT |
| A flow promises automatic rollback across aggregates | REJECT. Compensation is a new business operation |

## Read Models

| Criterion | Judgment |
|-----------|----------|
| An update decision uses a query-side read model | REJECT. Decide from the restored aggregate; protect it with expected versions or constraints |
