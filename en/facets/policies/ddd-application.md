# DDD Application Layer Policy

Keep use cases as orchestrators that load, ask the domain to decide, and persist, with every step safe to re-execute.

## Principles

| Principle | Criterion |
|-----------|-----------|
| Orchestrate, do not decide | Business decisions are made by domain operations; the use case loads, calls, and stores |
| IDs and values in | A command-side `execute` receives IDs and value objects, never an aggregate |
| One use case per request | A use case does not call another use case |
| Safe to repeat | Each step states why re-executing it is safe |
| Explicit recovery | Multi-aggregate flows recover through a Process Manager or an explicit re-execution strategy |
| Write model decides | Updates are never decided from query-side read models |

## Use-Case Shape

| Criterion | Judgment |
|-----------|----------|
| A command-side `execute` receives an aggregate, an Entity, or a request DTO that wraps primitives | REJECT. Receive IDs and value objects; convert requests to them at the adapter. Generic guidance to pass input DTOs applies to query-side use cases only |
| A use case calls another use case's `execute` | REJECT |
| A use case reads a domain getter and compares, calculates, or branches on it | REJECT. Move the decision into a domain operation |
| A getter result is passed unchanged to a repository port method, directly or through an immutable local | OK |
| A use case uses a database or RPC client directly | REJECT. Go through a port |
| A port is held in a field or parameter typed as the port | OK |

## Consistency and Re-Execution

| Criterion | Judgment |
|-----------|----------|
| A step has no stated reason why re-executing it is safe | REJECT |
| An additive (accumulating) command has no request-ID memory, or remembers only the last request | REJECT |
| An unknown persistence outcome is retried without reconciliation by request ID or equivalent evidence | REJECT |
| First success, duplicate success, and rejection are not distinguishable to the caller | REJECT |
| Events or new state are published before persistence succeeds | REJECT |
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
| A command-side use case depends on a query-side package | REJECT |
