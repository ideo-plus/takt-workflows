# DDD Rust Policy

Defines how the rules of the other DDD policies are judged in Rust code. The rules and their verdicts stay in their own policies; this policy only reads them in Rust syntax. When the reading breaks a rule, that rule's verdict applies. Module layout belongs to the module layout policy.

| Rule (policy) | How Rust code is judged |
|---------------|-------------------------|
| Do not expose state (domain layer) | A `pub`, `pub(crate)`, `pub(super)`, or `pub(in …)` field is public |
| Do not build outside the type (domain layer) | Struct literals and the `..` update syntax appear only inside the type's inherent `impl`. Deriving or implementing `Default`, or building through `Default::default()`, is building outside the type |
| Go through the full constructor (domain layer) | The associated function that takes the whole state is private and is called from the validating factories and the `restore` associated function |
| Only declared methods change state (domain layer) | A method taking `&mut self` is a method that changes state. Value objects and Domain Primitives have no `&mut self` method |
| Whether a command changes the aggregate in place (domain layer) | A command takes `&mut self`, changes the aggregate, and returns `Result<success_type, error_type>`; the borrow checker keeps the change exclusive. A method that takes `&self` or `self` and only returns an event is a command that does not change state |
| Do not hide changes behind interior mutability (domain layer) | `Cell`, `RefCell`, `Mutex`, `RwLock`, or an atomic type holding the business state of a domain type is interior mutability. When one serves a technical cache, say so |
| Return business failures as a Result (domain layer) | Reporting a business failure through `panic!`, `unwrap`, or `expect` is throwing. An operation's error type is the enum named by `error_type`, with the mapped cases as variants |
| Do not widen error types (domain layer) | A catch-all variant such as `Other(String)` or `Unknown` widens the type |
| Corrupt state (domain layer) | Restoration may return a dedicated restoration error or panic |
| Duplicate success (domain layer idempotency) | The success type is an enum with `Applied(event)` and `Duplicate`; a duplicate returns `Duplicate` |
| Go through a port (layer dependency) | A port is a trait. Static dispatch is the default; use dynamic dispatch only where the implementation is chosen at run time |
