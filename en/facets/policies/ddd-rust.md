# DDD Rust Policy

Apply the DDD layer rules to Rust with its own visibility, construction, mutation, and error mechanisms.

## Principles

| Principle | Criterion |
|-----------|-----------|
| Private by default | Domain struct fields are private; only needed operations are public |
| Constructed in one place | Struct literals and update syntax for a domain type appear only inside its own `impl` |
| `&mut self` means a command | A method taking `&mut self` is a declared command or a declared replay method |
| One error enum per operation | Each mapped operation returns `Result<_, E>` where `E` is its own enum |
| Static dispatch first | Ports are traits; dynamic dispatch is chosen only where needed |

## Visibility and Construction

| Criterion | Judgment |
|-----------|----------|
| A domain struct field is `pub`, `pub(crate)`, or `pub(super)` | REJECT |
| A struct literal or `..` update syntax of a domain type appears outside its inherent `impl` | REJECT |
| An aggregate or Entity derives or implements `Default`, or is built through `Default::default()` | REJECT |
| A constructor that takes the whole state is public and skips validation | REJECT. Keep it private and call it from validating factories |
| Restoration goes through a `restore` associated function that validates the whole state | OK |

## Mutation

| Criterion | Judgment |
|-----------|----------|
| A `&mut self` method is not mapped to a declared command or a declared replay method | REJECT |
| `Cell`, `RefCell`, `Mutex`, `RwLock`, or atomics hold business state of a domain type | REJECT. Use them only for technical caches, and say so |
| A value object or Domain Primitive has a `&mut self` method | REJECT |

## Errors

| Criterion | Judgment |
|-----------|----------|
| A mapped operation returns `Result<_, E>` where `E` is the enum named by its `error_type`, with exactly the mapped cases as variants | OK |
| An error enum has a catch-all variant (`Other(String)`, `Unknown`) for business failures | REJECT |
| A business failure is reported with `panic!`, `unwrap`, or `expect` | REJECT |
| Restoration of a corrupt state or history returns a distinct restoration error or panics | OK. It is not a business failure |

## Modules

| Criterion | Judgment |
|-----------|----------|
| `file` layout: a module with children uses `mod.rs` | REJECT. Use `<m>.rs` beside `<m>/` |
| `mod-rs` layout: a module with children is `<m>.rs` | REJECT. Use `<m>/mod.rs`; leaves stay `<leaf>.rs` |
| A `#[path]` attribute is used to escape the selected layout | REJECT |
