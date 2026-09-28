# DDD TypeScript Policy

Apply the DDD layer rules to TypeScript with one code representation per project, runtime-private state, method-specific Result errors, and explicit package boundaries.

## Principles

| Principle | Criterion |
|-----------|-----------|
| One representation | The project settings choose `class` or `companion`; every aggregate, Entity, Domain Primitive, and value object uses it |
| Runtime-private state | State is hidden by `#` fields or a factory closure; `private`, `protected`, and `readonly` do not hide state |
| Result from infrastructure | `Result` is declared once in the infrastructure language-extensions package |
| Closed error unions | Each mapped operation returns its own union of string literals |
| Explicit boundaries | Packages are reached only by package name and published `exports` |
| Checkable code | Domain sources avoid constructs that cannot be decided from syntax and stated types |

## Class Representation

| Criterion | Judgment |
|-----------|----------|
| State is held in a property that is not a `#` field (including `private`, `protected`, `readonly`, or parameter properties) | REJECT |
| The constructor is not `private`, or does not take the whole state | REJECT |
| `new` of a domain type appears outside its own class body | REJECT |
| A domain class uses accessors (`get`/`set`), `extends`, `implements`, decorators, `declare`, `abstract` members, or computed member names | REJECT |

## Companion Representation

| Criterion | Judgment |
|-----------|----------|
| The domain type is not a `type T = { … }` literal paired with a `const T = { … }` of the same name in one file | REJECT |
| The type literal holds anything other than the brand and method signatures | REJECT |
| The type has no non-exported top-level `const brand: unique symbol = Symbol("T")`, or uses `Symbol.for`, or exports the brand | REJECT |
| An instance is built outside the full-constructor factory, or with a spread, `as`, or `satisfies` | REJECT |
| The domain type is an `interface` paired with a `const` | REJECT |
| A computed member other than the brand key `[brand]` | REJECT |

## Commands and State

| Criterion | Judgment |
|-----------|----------|
| A method that changes state is not named by a command slug of the model (`command.invoice.add-line` is `addLine`) and is not a declared replay method | REJECT |
| A collection in state is mutated in place instead of replaced (`[...lines, line]`) | REJECT |
| A domain method calls a getter of another domain object | REJECT |
| A receiver of a domain method has no annotation naming one type | REJECT |

## Result and Errors

| Criterion | Judgment |
|-----------|----------|
| A domain package declares its own `Result`, or uses a Result library (neverthrow, Effect, fp-ts) | REJECT |
| `Result` is imported into a domain package other than by package name with `import type` from the language-extensions package listed in `dependencies` | REJECT |
| A mapped factory or command does not state `Result<success, E>` as its return type | REJECT |
| `E` is not the exported union of exactly the mapped `case` strings of that operation | REJECT |
| An expected business failure is returned as anything other than `{ ok: false, error: "<case>" }` | REJECT |
| A factory bound to no operation (`restore`, a value object's `of`) returns the value itself | OK |

## Package Boundaries and Modules

| Criterion | Judgment |
|-----------|----------|
| Another package is reached by a relative path, a `paths` alias, or a subpath its `exports` do not publish | REJECT |
| A `tsconfig.json` sets `baseUrl` or `paths` into another package | REJECT |
| A package entry uses `export *` | REJECT. Publish each name |
| A relative specifier inside a package omits the `.ts` extension | REJECT |
| `named-file` layout: a module with children is `src/<m>/index.ts` | REJECT. Use `src/<m>.ts` beside `src/<m>/` |
| `index-file` layout: a module with children is `src/<m>.ts` | REJECT. Use `src/<m>/index.ts`; leaves stay `<leaf>.ts` |
| A module file name is not `<module>.ts` (`invoice.model.ts`) | REJECT |

## Checkable Domain Sources

| Criterion | Judgment |
|-----------|----------|
| Domain sources use destructuring, object spreads, decorators, `import =`, `export =`, dynamic `import()`, namespaces, or dynamic callees | REJECT |
| An object literal is annotated with a composite type that names a domain type (`{ lines: readonly InvoiceLine[] }`, `Record<string, Invoice>`) | REJECT. Annotate the collection's own variable instead |
| A use-case `execute` parameter, or a receiver of `execute` or of a getter, has no stated type | REJECT |
| Query-side code imports a domain package as a namespace or re-exports it with `export *` | REJECT |
