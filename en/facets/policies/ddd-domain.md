# DDD Domain Layer Policy

Keep the domain model always valid: state is hidden, built only through a full constructor, changed only by declared commands, and business failures are returned as values owned by each operation.

## Principles

| Principle | Criterion |
|-----------|-----------|
| Always valid | An object that exists satisfies its invariants; no invalid state is built or exposed |
| One way in | Aggregates and Entities are built only through a full constructor that takes the whole state |
| Commands change state | Only methods for declared commands, or declared replay methods, change state |
| Tell, don't ask | Business decisions happen inside the object that owns the data, not by reading its getters |
| Failures are values | Expected business failures are returned as a Result with the operation's own error type |
| No partial change | A rejected operation leaves the state exactly as it was |
| Own your state | Mutable input is copied in; state is never handed out by reference |

## Construction and Restoration

| Criterion | Judgment |
|-----------|----------|
| Domain state is readable or writable from outside through public fields | REJECT |
| An aggregate or Entity is built outside its type through a literal, a default value, a cast, or a public constructor | REJECT |
| A factory builds an instance before validating its input, or builds an empty instance and fills it later | REJECT |
| An `init`, `setup`, `initialize`, `reset`, or `configure` method completes construction | REJECT |
| Persisted state is rebuilt without validating the whole state | REJECT. Restore through a restore factory that validates and builds through the full constructor |
| A restore factory rejects a corrupt state by throwing | OK. A corrupt state is not a business failure |
| A factory that the mapping binds to an operation returns the bare value although the operation has declared errors | REJECT |

## State Changes

| Criterion | Judgment |
|-----------|----------|
| A method changes state but is not the method mapped to a declared command | REJECT |
| A setter or a generic update method exists on an aggregate or Entity | REJECT |
| A method is treated as replay only because of its name (`apply`, `on_event`, and so on) | REJECT. Replay is allowed only for methods declared in `replay_methods` of an event-sourced aggregate |
| An aggregate or Entity changes state inside a command | Decided by the language policy. Rust changes it through `&mut self`, which the borrow checker keeps exclusive; TypeScript returns a new instance, because references are shared freely |
| A value object or Domain Primitive changes after construction | REJECT |
| Interior mutability or a shared reference hides a business state change | REJECT |
| Replay makes a new business decision or rejects a stored event as a business failure | REJECT. Replay only applies facts; a corrupt history aborts restoration |

## Getters and Decisions

| Criterion | Judgment |
|-----------|----------|
| Domain code reads another domain object's state through a getter to decide something | REJECT. Ask that object to do the work |
| A comparison or calculation on domain state happens outside the owning object | REJECT |
| A query method returns a copy or a read-only value for display or persistence | OK |

## Business Failures

Business failures are part of the operation's contract. Generic guidance to throw exceptions for business rule violations does not apply to domain operations in this model.

| Criterion | Judgment |
|-----------|----------|
| A command or factory reports an expected business failure by throwing | REJECT. Return a Result |
| The error type of an operation contains cases of another operation, or is widened to a string, `any`, `unknown`, or a catch-all variant | REJECT |
| One error type is shared by several operations | REJECT |
| The error cases differ from the cases the mapping declares for the operation | REJECT |
| State is changed before a business failure is detected | REJECT. Check first, then change |
| Unexpected runtime failures and corrupt state are thrown or panicked | OK. They are not business failures |

## Values, Entities, and Collections

| Criterion | Judgment |
|-----------|----------|
| A primitive with business meaning (an amount, an identifier, a quantity) is passed as a bare primitive across domain boundaries | REJECT. Wrap it in a Domain Primitive |
| A value object has identity-based equality, or an Entity has value-based equality | REJECT |
| A collection with invariants is a bare list inside several owners | REJECT. Give it a dedicated type |
| An aggregate holds another aggregate instead of its ID | REJECT |
| A domain service holds state, persists data, or decides something an aggregate can own | REJECT |

## Ownership

| Criterion | Judgment |
|-----------|----------|
| A received mutable array, map, or object is kept without copying | REJECT |
| A method returns the mutable collection or object held in state | REJECT. Return a copy or a read-only value |
