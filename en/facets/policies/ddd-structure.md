# DDD Structure Policy

Fix layers, dependency directions, package names, and module placement so that the structure itself states the domain and its boundaries.

## Principles

| Principle | Criterion |
|-----------|-----------|
| Layers from packages | A package's layer is decided by its name and placement, not by a configuration override |
| Dependencies point inward | Only the allowed directions exist; the composition root wires everything |
| Infrastructure is language extensions | The infrastructure layer extends the language; storage and network clients are adapters |
| Names from the ubiquitous language | Domain packages and modules are named by business terms, never by technical categories |
| One layout per project | The module layout is chosen once in the project settings and applied everywhere |

## Layers

A package (a Cargo crate, or a TypeScript package with its `package.json`) belongs to a layer by its suffix (`-domain`, `-use-case`, `-interface-adapter`, `-infrastructure`) or by its placement (`packages/<layer>/`, `modules/<layer>/`). Command, query, and read-model-updater packages carry a `command`, `query`, or `rmu` segment. A package with the `-composition-root` suffix, a binary-only package, or a package under `composition-root/` is the composition root.

| Criterion | Judgment |
|-----------|----------|
| A package's suffix and placement point to different layers | REJECT |
| A package matches no layer rule | REJECT |
| A package carries more than one of `command`, `query`, `rmu` | REJECT |
| A package mixes a binary target with library code of a layer | REJECT |

## Dependency Directions

| From | May depend on |
|------|---------------|
| interface-adapter | use-case, domain, infrastructure |
| use-case | domain, infrastructure |
| domain | infrastructure |
| infrastructure | nothing |
| read-model updater | domain, interface-adapter, infrastructure, both sides |
| composition root | every layer |

| Criterion | Judgment |
|-----------|----------|
| A dependency outside the table above | REJECT |
| Domain or use-case code depends on an I/O library (database driver, HTTP client or server, message broker) | REJECT |
| Wiring of implementations to ports happens outside the composition root | REJECT |
| A database or RPC client is placed in the infrastructure layer | REJECT. Place it in the interface adapter layer |
| The infrastructure layer publishes language extensions such as `Result` from its package entry | OK. Generic guidance not to export infrastructure functions does not apply to these language extensions |

## Domain Packaging

| Criterion | Judgment |
|-----------|----------|
| A package or module is named `aggregate(s)`, `impl(s)`, `implementation(s)`, `vo(s)`, `entity`, `entities`, `value_object(s)`, `valueobject(s)`, or a bare `domain` | REJECT |
| Aggregates, Entities, and value objects of one business concept are split into modules by type category | REJECT |
| A shared value is placed in a container such as `common/vo` instead of a module named for its responsibility (`money`, `address`) | REJECT |
| `common`, `shared`, or `utils` holds domain concepts | Warning. Justify the business term or rename |
| A domain package or module is not declared in the aggregate mapping with its business term | REJECT |
| Layer markers such as the `-domain` suffix or `packages/domain` placement | OK. They are layer markers, not technical categories |

Directory examples that group code into `aggregate/`, `model/`, `services/`, or `repositories/` do not apply to domain code in this structure.

## Module Layout

The project settings choose one module layout per language. Existing files are not evidence of the layout; matching the existing style does not override the settings.

| Criterion | Judgment |
|-----------|----------|
| No layout is selected in the project settings before code is generated | REJECT. Select one first |
| A module is placed differently from the selected layout, in any package, layer, test, example, or build script | REJECT |
| Both placements of one module exist (`invoice.rs` and `invoice/mod.rs`, `src/invoice.ts` and `src/invoice/index.ts`) | REJECT |
| A file is unreachable from its crate root, or a stale `mod.rs` / `index.ts` remains after its children moved | REJECT |
| TypeScript tests, declaration files, or `.tsx`, `.mts`, `.cts` sources are placed inside a package's `src` | REJECT. Keep them outside `src` |
