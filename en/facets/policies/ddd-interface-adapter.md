# DDD Interface Adapter Policy

Keep ports named by responsibility, repositories scoped to one aggregate, restoration through the domain's own factories, and the command and query sides apart.

## Principles

| Principle | Criterion |
|-----------|-----------|
| Ports by responsibility | A port is named for what the inner layer needs, not for the technology behind it |
| One aggregate per repository | A repository stores and loads one aggregate type |
| Restore through the domain | Adapters rebuild aggregates only through the domain's restore factory |
| Safe persistence | Storing re-persists state safely or appends to immutable history |
| Sides stay apart | The command side and the query side do not depend on each other |
| Clients live here | Database and RPC clients belong to this layer |

## Ports and Repositories

| Criterion | Judgment |
|-----------|----------|
| A repository port is not named `<Aggregate>Repository`, or its name contains a storage medium (`Postgres`, `Dynamo`, `InMemory`, `Http`, and so on) | REJECT |
| A repository implementation is named with a medium prefix and ends with the port name (`PostgresInvoiceRepository`) | OK |
| A repository port lacks the baseline verbs `find_by_id`, `store`, and `delete_by_id` (in the language's casing) without a stated reason | REJECT |
| A repository port offers screen-oriented search | REJECT. Put it on the query side |
| A repository handles several aggregate types | REJECT |
| A port is not classified as `repository`, `external-client`, or `es-infrastructure` in the layer structure | REJECT |
| A port declared in an inner layer is implemented in this layer and wired at the composition root | OK |
| An external model is used inside the domain without an explicit decision to adopt or translate it | REJECT |

## Restoration and Persistence

| Criterion | Judgment |
|-----------|----------|
| An adapter builds a domain object with a literal, `new`, a cast, a default value, or a constructor other than the restore factory | REJECT |
| Stored data is mapped into a domain object without validation | REJECT |
| `store` overwrites unconditionally where concurrent updates are possible | REJECT. Use an expected version or an equivalent constraint |
| Event-sourced persistence rewrites or deletes existing events | REJECT |
| Uniqueness is decided by reading first instead of by a storage constraint | REJECT |
| Database-specific errors leak to the use-case layer untranslated | REJECT |

## Command and Query Sides

| Criterion | Judgment |
|-----------|----------|
| A command-side package depends on a query-side package, or the reverse | REJECT |
| Query-side code imports a domain type or a repository port | REJECT. Use DAOs and DTOs |
| A read-model updater depends on both sides | OK |
| A read-model updater ignores gaps or duplicates by comparing sequence numbers only | REJECT. Distinguish event IDs, per-aggregate sequence, and delivery sequence |
| Read-model staleness is hidden from callers that need it | REJECT. State the propagation delay |

## Testing Adapters

| Criterion | Judgment |
|-----------|----------|
| A port has no in-memory implementation used to test its contract | Warning |
| Port contract tests cover success only | REJECT. Cover conflicts and failures |
