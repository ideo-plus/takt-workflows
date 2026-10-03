# DDD Interface Adapter Layer Policy

Judges the code of the interface adapter layer (repository implementations, exchanges with external systems, the query side, read-model updaters). Rebuilding aggregates belongs to the domain layer policy; dependency direction and the separation of command and query sides belong to the layer dependency policy; port classification belongs to the domain model policy (layer structure).

## Ports and Repositories

| Criterion | Judgment |
|-----------|----------|
| A repository port is not named `<Aggregate>Repository`, or its name contains a storage medium (`Postgres`, `Dynamo`, `InMemory`, `Http`, and so on) | REJECT |
| A repository implementation is prefixed by its medium and ends with the port name (`PostgresInvoiceRepository`) | OK |
| A repository port lacks the baseline verbs `find_by_id`, `store`, `delete_by_id` (in the language's spelling) without a stated reason | REJECT |
| A method of a repository port does not return `Result` (`store` returns `void` or `()`) | REJECT. Loading and storing can fail; return `Result<…, RepositoryError>`. `RepositoryError` is an infrastructure failure declared beside the port, not a business error |
| The lookup reports a missing aggregate as a failure of the port | REJECT. Return `undefined` (`None` in Rust) as a success; the use case turns the absence into its own error |
| A repository port offers screen-oriented searches | REJECT. Put them on the query side |
| One repository handles several aggregate types | REJECT |
| An external model is used inside the domain without stating whether it is adopted or translated | REJECT |

## Persistence

| Criterion | Judgment |
|-----------|----------|
| `store` overwrites unconditionally although concurrent updates are possible | REJECT. Use an expected version or an equivalent constraint |
| Event-sourced persistence rewrites or deletes existing events | REJECT |
| Uniqueness is decided by reading first instead of by a storage constraint | REJECT |
| Database-specific errors leak to the use-case layer untranslated | REJECT |

## Read-Model Updaters and the Query Side

| Criterion | Judgment |
|-----------|----------|
| A read-model updater ignores gaps or duplicates by comparing numbers only | REJECT. Tell apart event IDs, per-aggregate sequence numbers, and delivery sequence numbers |
| The delay of a read model is hidden from callers that depend on it | REJECT. State the delay |

## Adapter Tests

| Criterion | Judgment |
|-----------|----------|
| No in-memory implementation exists to test the port contract | Warning |
| The port contract tests cover success only | REJECT. Cover conflicts and failures too |
