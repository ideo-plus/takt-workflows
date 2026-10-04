# DDD Domain Layer Policy

Judges the code of the domain layer (aggregates, Entities, value objects, Domain Primitives, events, domain services): agreement with the declarations, construction and restoration, state changes, idempotency, where decisions are made, and business failures. Where use-case code makes its decisions is also judged here, under "Getters and Decisions". How a language expresses these rules belongs to the language policies; how declarations are written belongs to the domain model policy.

## Agreement with the Declarations

| Criterion | Judgment |
|-----------|----------|
| A type, field, method, error type or case, success type, event, or replay method in code differs from the domain model and aggregate mapping | REJECT. Follow the declarations; if a declaration is wrong, fix the declaration first |
| Code creates a business operation, domain error, invariant, state, or event that the declarations do not contain | REJECT. Declare it first |

## Construction and Restoration

| Criterion | Judgment |
|-----------|----------|
| Domain state is readable or writable from outside through public fields | REJECT |
| Code of any layer builds an aggregate or Entity outside its type through a literal, a default value, a cast, or a public constructor | REJECT. Go through the full constructor that takes the whole state |
| A factory builds an instance before validating its input, or builds an empty instance and fills it later | REJECT |
| An `init`, `setup`, `initialize`, `reset`, or `configure` method completes construction | REJECT |
| State is reconstructed from a database/file representation without a validating restore factory | REJECT. Validate and restore persisted representations. An aggregate retained in memory is returned directly (cloned in Rust), without reconstruction |
| A restore factory rejects a corrupt state by throwing | OK. A corrupt state is not a business failure |
| A factory the mapping binds to an operation returns the bare value although the operation has declared errors | REJECT |

## State Changes and Events

| Criterion | Judgment |
|-----------|----------|
| A method that changes the state of an aggregate root is neither the method of a declared command nor a declared replay method | REJECT. A method that changes a value, Entity, or collection inside the aggregate is a part the commands call, not a command |
| A setter or a generic update method exists | REJECT |
| A method is treated as replay only because of its name (`apply`, `on_event`, and so on) | REJECT. Replay is only a method declared in `replay_methods` |
| Replay makes a new business decision or rejects a stored event as a business failure | REJECT. Replay only applies facts; a corrupt history aborts restoration |
| Whether a domain type (aggregate, Entity, value object, Domain Primitive, collection) changes in place or becomes a new instance | Decided by the language policy |
| Interior mutability or a shared reference hides a business state change | REJECT |
| A command that changes state does not return the one event it produced, or returns a list of events | REJECT. Return the one declared `event` |
| State changes before a business failure is detected, or a failed command returns an event | REJECT. Check first, then change; a failed command changes nothing |

## Idempotency (commands with `command-id-memory`)

| Criterion | Judgment |
|-----------|----------|
| The command IDs the aggregate remembers do not follow the command's declared `retention` (`last-one`: the last one; `multiple`: the latest `retention_count`; `time-window`: those within `retention_window`) | REJECT |
| An applied command ID is checked after state or invariant rejections | REJECT. Check the remembered command ID first |
| A retry of an applied command ID changes state, returns an event, or returns a rejection | REJECT. Change nothing and return a duplicate success without an event |
| The ID of a rejected command is remembered | REJECT. Remember applied commands only |

## Getters and Decisions

| Criterion | Judgment |
|-----------|----------|
| Domain-layer or use-case-layer code reads a domain object's state through a getter and compares, calculates, or branches on it | REJECT. Move the decision into an operation of the object that owns the state |
| Use-case code passes a getter result unchanged to a repository port method, directly or through an immutable local | OK |
| A query method returns a copy or a read-only value for display or persistence | OK |

## Business Failures

Business failures are part of the operation's contract. Generic guidance to throw exceptions for business rule violations does not apply to domain operations.

| Criterion | Judgment |
|-----------|----------|
| A command or factory reports an expected business failure by throwing | REJECT. Return a Result with the operation's own error type |
| A Domain Primitive's of validates the unchanged input through parse and throws or panics on its failure | OK. Invalid input to of violates the caller contract; validation is never skipped |
| A Domain Primitive lacks of or parse, initializes before checking its invariants, or initializes a different value from the one checked | REJECT. Provide both APIs. of returns the unchanged input's checked parse result; direct initialization belongs only after parse rejects invalid input |
| The error type of an operation contains cases of another operation, or is widened to a string, `any`, `unknown`, or a catch-all variant | REJECT |
| One error type is shared by several operations | REJECT |
| Unexpected runtime failures and corrupt state are thrown or panicked | OK. They are not business failures |

## Values, Entities, and Collections

| Criterion | Judgment |
|-----------|----------|
| A value with domain invariants narrower than its backing type (an amount, an identifier, a quantity) is passed as a bare primitive across domain boundaries | REJECT. Wrap it in a Domain Primitive with those invariants. Do not introduce a DP when the backing type alone expresses its valid domain |
| A value object has identity-based equality, or an Entity has value-based equality | REJECT |
| A factory that builds a Domain Primitive from an outside value accepts it without checking the declared value rule | REJECT. Return a value that breaks the rule as that factory's error in a Result |
| A domain type holds a collection (an array, `Set`, `Map`, `Vec`, `HashSet`, `HashMap`, and so on) bare beside other state | REJECT. Wrap it in a first-class collection type and put the operations and decisions on the collection in that type. A type whose whole state is the collection is a first-class collection |
| A domain service holds state, persists data, or decides something an aggregate can own | REJECT |

## Ownership

| Criterion | Judgment |
|-----------|----------|
| A received mutable array, map, or object is kept without copying | REJECT |
| A method returns the mutable collection or object held in state | REJECT. Return a copy or a read-only value |
