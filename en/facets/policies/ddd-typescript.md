# DDD TypeScript Policy

Always provide of(value: T): VO and parse(value: T): Result<VO, Parse…Error> on every Domain Primitive. parse rejects invariant violations with an input-dependent guard before initializing that input. of calls parse with the unchanged input, throws on a caller contract violation, and returns the checked value on success. Direct initialization uses this checked path in both class and companion representations.

Defines how the rules of the other DDD policies are judged in TypeScript code, and the rules only TypeScript has (code representation, immutability, where `Result` lives, package boundaries, checkable syntax). When the reading breaks a rule, that rule's verdict applies. Module layout belongs to the module layout policy.

## Reading the Rules

| Rule (policy) | How TypeScript code is judged |
|---------------|-------------------------------|
| Do not expose state (domain layer) | State is held in `#` fields or a factory closure. Any other property (including `private`, `protected`, `readonly`, and parameter properties) is public |
| Do not build outside the type (domain layer) | With the `class` representation, `new` appears only inside the type's own class body. With the `companion` representation, instances are written only inside the full-constructor factory, never with a spread, `as`, or `satisfies` |
| Go through the primary constructor (domain layer) | A class has one private constructor implementation assigning every instance field; overload declarations are not implementations. A companion has one factory assembling its state closure and instance. Other construction paths delegate to it, directly or through auxiliaries |
| Whether a domain type changes in place or becomes a new instance (domain layer) | A new instance; follow "Immutability" below |
| Return business failures as a Result (domain layer) | An expected failure is returned as `{ ok: false, error: "<case>" }`. An operation's error type is the exported union of exactly its case strings |
| Agreement with the declarations (domain layer) | Mapped factories, commands, and independent Service operations state `Result<success_type, error_type>` as their return type; a factory's success type is its constructed element. A function bound to no operation (`replay`, a value object's `of`) may return the value itself |
| Duplicate success (domain layer idempotency) | The success type has a `kind: "applied"` case (the new instance and the event) and a `kind: "duplicate"` case (the unchanged instance only) |

## Code Representation

| Criterion | Judgment |
|-----------|----------|
| An aggregate, Entity, Domain Primitive, or value object is written in a representation other than the one `.ddd.toml` chooses (`class` or `companion`) | REJECT |
| A domain class uses accessors (`get`/`set`), `extends`, `implements`, decorators, `declare`, `abstract` members, or computed member names | REJECT |
| A companion domain type is not a `type T = { … }` literal paired with a `const T = { … }` of the same name in one file, or is an `interface` paired with a `const` | REJECT |
| A companion type literal holds anything other than the brand and method signatures, or a computed member other than the brand key `[brand]` | REJECT |
| A companion type has no non-exported top-level `const brand: unique symbol = Symbol("T")`, uses `Symbol.for`, or exports the brand | REJECT |

## Immutability

References are shared freely, so no domain instance, aggregates and Entities included, changes after construction. A command builds the changed state into a new instance through the full constructor and returns it.

| Criterion | Judgment |
|-----------|----------|
| A `#` field or closure state is written outside the constructor or the full-constructor factory (including inside a command or a replay method) | REJECT |
| A changing method (`push`, `splice`, `sort`, `set`, `add`, `delete`) is called on state | REJECT |
| A `#` field is not declared `readonly` | REJECT |
| A command's success type does not hold both the new instance and the event (`Result<void, E>`, `Result<Invoice, E>`) | REJECT. Export a type holding both (`IssueInvoiceOutcome`) beside the error type |
| A use case stores, or keeps using, the instance it loaded instead of the one the command returned | REJECT |

## Where `Result` Lives

| Criterion | Judgment |
|-----------|----------|
| A domain package declares its own `Result`, or uses a Result library (neverthrow, Effect, fp-ts) | REJECT |
| A domain package does not import `Result` with `import type` by package name from the language-extensions package listed in `dependencies` | REJECT |

## Package Boundaries

| Criterion | Judgment |
|-----------|----------|
| Another package is reached by a relative path, a `paths` alias, or a subpath its `exports` do not publish | REJECT |
| A `tsconfig.json` sets `baseUrl` or `paths` into another package | REJECT |
| A package entry uses `export *` | REJECT. Publish each name |
| A relative specifier inside a package omits the `.ts` extension | REJECT |

## Checkable Syntax

| Criterion | Judgment |
|-----------|----------|
| Domain sources use destructuring, object spreads, decorators, `import =`, `export =`, dynamic `import()`, namespaces, or dynamic callees | REJECT |
| An object literal is annotated with a composite type that names a domain type (`{ lines: readonly InvoiceLine[] }`, `Record<string, Invoice>`) | REJECT. Annotate the collection's own variable instead |
| A receiver of a domain method, a use-case `execute` parameter, or a receiver of `execute` or of a getter has no annotation naming one type | REJECT |
