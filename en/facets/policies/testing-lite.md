# Testing policy (lite)

## Principles

| Principle | Criterion |
|-----------|-----------|
| Given-When-Then | Structure every test in three stages |
| One concept per test | Do not mix several concerns in one test |
| Verify behavior | Test behavior, not implementation details |
| Do not turn internals into contracts | Line counts, source wording, imports, helper names, file layout, and reference identity are not substitutes for an observable contract |
| Independent and repeatable | No dependence on other tests, execution order, time, or randomness; same result every run |
| Mocks match the real contract | Mocks of external SDKs and APIs match the real contract; do not freeze a wrong assumption in a test |

## Placement (choosing the test layer)

- Prefer unit tests for logic and integration tests for boundaries. Do not overuse E2E tests for what a unit test can cover.
- If an existing unit, integration, or E2E test already detects the same failure, do not add a duplicate in another layer or per consumer.
- If a project-specific testing policy (AGENTS.md, CLAUDE.md, etc.) defines the responsibilities of each test layer, it takes precedence.

## Verifying observable contracts

Map every assertion to an invariant stated by the source of truth, an invariant derived directly and necessarily from it, or an observable existing contract outside the scope of the change. Do not add an assertion whose mapping you cannot show.

| Criterion | Verdict |
|-----------|---------|
| The expected return value, exception, or side effect is verified directly | OK |
| Both sides of a boundary change are verified: success/failure, allow/deny | OK |
| Only reads configuration or internal state without going through the operation, or substitutes internal state for a contract that is really a different effect | REJECT |
| Infers input classification, behavior, error kind, wording, or internal representation from defensive code and freezes it as a new test contract | REJECT |
| Concludes that a forbidden or non-inherited value is unused only because an exact string is absent | REJECT |
