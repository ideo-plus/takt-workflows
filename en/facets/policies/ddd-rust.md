# DDD Rust Policy

Defines how the rules of the other DDD policies are judged in Rust code, and the rule only Rust has (changing in place). When the reading breaks a rule, that rule's verdict applies. Module layout belongs to the module layout policy.

| Rule (policy) | How Rust code is judged |
|---------------|-------------------------|
| Do not expose state (domain layer) | A `pub`, `pub(crate)`, `pub(super)`, or `pub(in …)` field is public |
| Do not build outside the type (domain layer) | Struct literals and the `..` update syntax appear only inside the type's inherent `impl`. Deriving or implementing `Default`, or building through `Default::default()`, is building outside the type |
| Go through the full constructor (domain layer) | The associated function that takes the whole state is private and is called from the validating factories and the `restore` associated function |
| Only declared methods change state (domain layer) | A method taking `&mut self` is a method that changes state |
| Whether a domain type changes in place or becomes a new instance (domain layer) | In place; follow "Changing in Place" below. A command takes `&mut self`, changes the aggregate, and returns `Result<success_type, error_type>`. A method that takes `&self` or `self` and only returns an event is a command that does not change state |
| Do not hide changes behind interior mutability (domain layer) | `Cell`, `RefCell`, `Mutex`, `RwLock`, or an atomic type holding the business state of a domain type is interior mutability. When one serves a technical cache, say so |
| Return business failures as a Result (domain layer) | Reporting a business failure through `panic!`, `unwrap`, or `expect` is throwing. An operation's error type is the enum named by `error_type`, with the mapped cases as variants |
| Do not widen error types (domain layer) | A catch-all variant such as `Other(String)` or `Unknown` widens the type |
| Corrupt state (domain layer) | Restoration may return a dedicated restoration error or panic |
| Duplicate success (domain layer idempotency) | The success type is an enum with `Applied(event)` and `Duplicate`; a duplicate returns `Duplicate` |
| Go through a port (layer dependency) | A port is a trait. Static dispatch is the default; use dynamic dispatch only where the implementation is chosen at run time |

## Changing in Place

Rust code takes what changes as `&mut` and changes it in place: aggregates, and value objects, Domain Primitives, Entities, and collections alike. The borrow checker keeps a change exclusive and a value shared through `&` does not change, so ownership protects the meaning of a value. When the value before the change is needed, the caller clones it and then changes it.

| Criterion | Judgment |
|-----------|----------|
| A method takes `&self` or `self` and returns a new instance of its own type (`Self`, `Result<Self, E>`, `Option<Self>`) | REJECT. Take `&mut self` and change in place; return `()`, or `Result<(), E>` when it can fail |
| A method returns a changed copy of an argument it took by value (`fn add_to(&self, total: i64) -> i64`) | REJECT. Take what changes as `&mut` and change it (`fn add_to(&self, total: &mut i64)`) |
| A domain type implements `Add`, `Sub`, `Mul`, `Div`, or `Rem` | REJECT. Implement the operators that change in place, such as `AddAssign`, not operators that return a new value |
| A query taking `&self` returns a value of another type (a total, a copy for display or persistence) | OK |
