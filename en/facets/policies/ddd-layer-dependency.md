# DDD Layer Dependency Policy

Defines which layer a package belongs to, which layer declares ports, which dependencies are allowed between layers and between the command and query sides, and where implementations are wired to ports.

## Assigning Layers

A package (a Cargo crate, or a TypeScript package with a `package.json`) belongs to a layer by its suffix (`-domain`, `-use-case`, `-interface-adapter`, `-infrastructure`) or its placement (`packages/<layer>/`, `modules/<layer>/`). Command-side, query-side, and read-model-updater packages carry a `command`, `query`, or `rmu` segment. A package with the `-composition-root` suffix, a binary-only package, or a package under `composition-root/` is a composition root.

| Criterion | Judgment |
|-----------|----------|
| A package's suffix and placement name different layers | REJECT |
| A package matches no layer rule | REJECT |
| A package carries more than one of `command`, `query`, and `rmu` | REJECT |
| A package mixes a binary target with the library code of a layer | REJECT |

## Dependency Direction

| From | May depend on |
|------|---------------|
| interface-adapter | use-case, domain, infrastructure |
| use-case | domain, infrastructure |
| domain | infrastructure |
| infrastructure | nothing |
| read-model updater | domain, interface-adapter, infrastructure, both the command and query sides |
| composition root | every layer |

| Criterion | Judgment |
|-----------|----------|
| A dependency not in the table above exists | REJECT |
| A command-side package depends on a query-side package, or the reverse | REJECT |
| Query-side code depends on domain-layer types or repository ports | REJECT. Use DAOs and DTOs |
| Domain-layer or use-case-layer code uses an I/O library (database driver, HTTP client or server, message broker) or its client | REJECT. The use case goes through a port |
| A port (a repository port or any other port the layer structure declares) is declared in the domain layer, or domain-layer code holds or calls a port | REJECT. A port belongs to the use-case layer: the use case loads through it, calls the domain, and stores through it |
| A database or RPC client is placed in the infrastructure layer | REJECT. Place it in the interface adapter layer |
| The infrastructure layer exports a language extension such as `Result` from its package entry | OK. Generic guidance not to export infrastructure functions does not apply to these language extensions |
| An implementation is wired to its port outside the composition root | REJECT |
