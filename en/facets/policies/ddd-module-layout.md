# DDD Module Layout Policy

Defines how modules are placed in files, for Rust and TypeScript. `.ddd.toml` chooses one layout per language, and it applies to every package, layer, test, example, and build script. Existing files are not evidence for a layout, and matching an existing style never overrides the settings.

## Common

| Criterion | Judgment |
|-----------|----------|
| No layout is chosen in `.ddd.toml` before code is generated | REJECT. Choose one first |
| One module is placed both ways (`invoice.rs` and `invoice/mod.rs`, `src/invoice.ts` and `src/invoice/index.ts`) | REJECT |
| A file is unreachable from the package root, or an old `mod.rs` or `index.ts` remains after children moved | REJECT |

## Rust

| Criterion | Judgment |
|-----------|----------|
| `file` layout: a module with children is `<m>/mod.rs` | REJECT. Use `<m>.rs` beside `<m>/` |
| `mod-rs` layout: a module with children is `<m>.rs` | REJECT. Use `<m>/mod.rs`; leaves stay `<leaf>.rs` |
| A `#[path]` attribute is used to escape the chosen layout | REJECT |

## TypeScript

| Criterion | Judgment |
|-----------|----------|
| `named-file` layout: a module with children is `src/<m>/index.ts` | REJECT. Use `src/<m>.ts` beside `src/<m>/` |
| `index-file` layout: a module with children is `src/<m>.ts` | REJECT. Use `src/<m>/index.ts`; leaves stay `<leaf>.ts` |
| A module file name is not `<module>.ts` (`invoice.model.ts`) | REJECT |
| Tests, declaration files, or `.tsx` / `.mts` / `.cts` sources are placed inside a package's `src` | REJECT. Place them outside `src` |
