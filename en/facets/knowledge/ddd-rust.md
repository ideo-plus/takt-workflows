# DDD Rust Knowledge

## Aggregate

An aggregate keeps private fields, a private constructor that takes the whole state, validating factories that return the operation's own error enum, a `restore` function for persisted state, and commands that take `&mut self`, change the state, and return the one event they produce. A command that fails changes nothing and produces no event.

```rust
pub mod line;
pub mod lines;

use self::line::InvoiceLine;
use self::lines::InvoiceLines;
use crate::customer_id::CustomerId;
use crate::money::Money;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenInvoiceError {
    NegativeTotal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddInvoiceLineError {
    AlreadyIssued,
    NegativeTotal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueInvoiceError {
    AlreadyIssued,
    EmptyLines,
}

/// A persisted state the invariants forbid: corrupt storage, not a business failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CorruptInvoiceState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLineAdded {
    invoice_id: String,
    command_id: String,
    line: InvoiceLine,
}

impl InvoiceLineAdded {
    fn new(invoice_id: &str, command_id: &str, line: InvoiceLine) -> Self {
        InvoiceLineAdded { invoice_id: invoice_id.to_string(), command_id: command_id.to_string(), line }
    }

    pub fn invoice_id(&self) -> &str {
        &self.invoice_id
    }

    pub fn command_id(&self) -> &str {
        &self.command_id
    }

    pub fn line(&self) -> &InvoiceLine {
        &self.line
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceIssued {
    invoice_id: String,
}

impl InvoiceIssued {
    fn new(invoice_id: &str) -> Self {
        InvoiceIssued { invoice_id: invoice_id.to_string() }
    }

    pub fn invoice_id(&self) -> &str {
        &self.invoice_id
    }
}

/// A command ID already applied changes nothing and produces no event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddInvoiceLineOutcome {
    Applied(InvoiceLineAdded),
    Duplicate,
}

#[derive(Debug, Clone)]
pub struct Invoice {
    id: String,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: bool,
    last_add_line_command_id: Option<String>,
}

impl Invoice {
    fn new(
        id: String,
        customer: CustomerId,
        lines: InvoiceLines,
        issued: bool,
        last_add_line_command_id: Option<String>,
    ) -> Self {
        Invoice { id, customer, lines, issued, last_add_line_command_id }
    }

    pub fn open(id: &str, customer: CustomerId, lines: InvoiceLines) -> Result<Self, OpenInvoiceError> {
        if lines.total().is_negative() {
            return Err(OpenInvoiceError::NegativeTotal);
        }
        Ok(Self::new(id.to_string(), customer, lines, false, None))
    }

    pub fn restore(
        id: &str,
        customer: CustomerId,
        lines: InvoiceLines,
        issued: bool,
        last_add_line_command_id: Option<String>,
    ) -> Result<Self, CorruptInvoiceState> {
        if (issued && lines.is_empty()) || lines.total().is_negative() {
            return Err(CorruptInvoiceState);
        }
        Ok(Self::new(id.to_string(), customer, lines, issued, last_add_line_command_id))
    }

    pub fn add_line(&mut self, command_id: &str, line: InvoiceLine) -> Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if self.last_add_line_command_id.as_deref() == Some(command_id) {
            return Ok(AddInvoiceLineOutcome::Duplicate);
        }
        if self.issued {
            return Err(AddInvoiceLineError::AlreadyIssued);
        }
        let mut total = self.lines.total();
        line.with_amount(|amount| total.add(amount));
        if total.is_negative() {
            return Err(AddInvoiceLineError::NegativeTotal);
        }
        self.lines.add(line.clone());
        self.last_add_line_command_id = Some(command_id.to_string());
        Ok(AddInvoiceLineOutcome::Applied(InvoiceLineAdded::new(&self.id, command_id, line)))
    }

    pub fn issue(&mut self) -> Result<InvoiceIssued, IssueInvoiceError> {
        if self.issued {
            return Err(IssueInvoiceError::AlreadyIssued);
        }
        if self.lines.is_empty() {
            return Err(IssueInvoiceError::EmptyLines);
        }
        self.issued = true;
        Ok(InvoiceIssued::new(&self.id))
    }

    pub fn is_billed_to(&self, customer: &CustomerId) -> bool {
        &self.customer == customer
    }

    pub fn total(&self) -> Money {
        self.lines.total()
    }

    pub fn lines(&self) -> InvoiceLines {
        self.lines.clone()
    }
}
```

`restore` reports a corrupt state with its own type because it is not a business failure. `add_line` remembers the ID of the last add-line command it applied (the model declares `retention: last-one`) and recognizes a resent command before any other check: it returns `AddInvoiceLineOutcome::Duplicate`, changes nothing, and produces no event, so the event is never published twice. It checks the new total before it changes anything. Events are domain types too: their fields are private, they are built by their own `new` inside the aggregate's module, and they offer read-only accessors to the code that publishes them. The customer is the Domain Primitive `CustomerId`, the line amounts are the Domain Primitive `Money`, and the lines are the first-class collection `InvoiceLines`. The invoice ID and the command ID stay `&str` only to keep the example short; when they have domain format or range rules, wrap them as DPs and place them under the `invoice` module as types that belong to the invoice alone (`invoice/invoice_id.rs`, `invoice/command_id.rs`). How to group modules is in "Modules" of the modeling knowledge.

## Changing in Place

What changes is taken as `&mut` and changed in place, whatever kind of domain type it is. A value object, Domain Primitive, or collection that changes takes `&mut self` and returns `()`, or `Result<(), E>` when the change can fail; it does not take `&self` or `self` and hand back a new instance, and it does not implement operators such as `Add` that return a new value. A domain method must not mutate an external `&mut` argument; the receiver owns the change. The in-place rule detects that forbidden parameter shape syntactically, but cannot prove which statements in the body mutate it. Ownership keeps this safe: a value shared through `&` cannot change, and a caller that needs the value before the change clones it first. The `&mut self` methods of the values inside an aggregate are not commands; the aggregate's commands call them.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseMoneyError {
    InvalidIncrement,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Money(i64);

impl Money {
    pub fn of(value: i64) -> Self {
        Self::parse(value).expect("Money is outside its domain")
    }

    pub fn parse(value: i64) -> Result<Self, ParseMoneyError> {
        if value % 100 != 0 {
            return Err(ParseMoneyError::InvalidIncrement);
        }
        Ok(Self(value))
    }

    pub fn zero() -> Self {
        Self::of(0)
    }

    pub fn add(&mut self, rhs: &Money) {
        *self = Self::of(self.0.checked_add(rhs.0).expect("Money arithmetic overflow"));
    }

    pub fn is_negative(&self) -> bool {
        self.0 < 0
    }
}
```

```rust
use crate::money::Money;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLine {
    amount: Money,
}

impl InvoiceLine {
    pub fn of(amount: Money) -> Self {
        InvoiceLine { amount }
    }

    pub fn with_amount<R>(&self, use_amount: impl FnOnce(&Money) -> R) -> R {
        use_amount(&self.amount)
    }
}
```

`Money` is a Domain Primitive, the amount of a line and the total of an invoice, in a module of its own, `money` (`src/money.rs`). This example requires integer monetary amounts in steps of 100; negative discounts and zero are valid, while the aggregate keeps the total non-negative. `Money::add` changes the receiving `Money` through `&mut self`; `InvoiceLine` supplies the Domain Primitive to an operation without exposing a bare value or a getter. The in-place rule rejects methods that receive an external `&mut` value, but permits ordinary `&self` queries.

## Domain Primitives

A Domain Primitive wraps one value and has domain invariants narrower than its backing type. Always provide both of and parse. Initialize only after parse rejects invalid input; of delegates the unchanged input to parse and panics (Rust) or throws (TypeScript) on a caller contract violation. parse returns its own error type in Result. Every successful instance satisfies the invariants. Declare those invariants and the parse factory rule that checks all of them in the model. Equality follows the value.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseCustomerIdError {
    InvalidFormat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerId(String);

impl CustomerId {
    pub fn of(value: &str) -> Self {
        Self::parse(value).expect("CustomerId is outside its domain")
    }

    pub fn parse(value: &str) -> Result<Self, ParseCustomerIdError> {
        let digits = value.strip_prefix('C').ok_or(ParseCustomerIdError::InvalidFormat)?;
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(ParseCustomerIdError::InvalidFormat);
        }
        Ok(CustomerId(value.to_string()))
    }
}
```

Do not introduce a DP when the backing type alone expresses the valid domain. Resolve unspecified rules as open questions. Never initialize before validation or validate one value and initialize another. ddd-lint checks declarations, input rejection guards, of delegation and direct-construction bypasses from syntax; it does not prove the business meaning of an invariant. Test valid, boundary and invalid values too.

## First-Class Collections

A domain type that holds a collection beside other state wraps it in a first-class collection: a type whose whole state is the collection, which owns the operations and decisions on it. `InvoiceLines` adds a line in place and totals the lines; the aggregate never touches the `Vec`.

```rust
use super::line::InvoiceLine;
use crate::money::Money;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLines(Vec<InvoiceLine>);

impl InvoiceLines {
    pub fn of(lines: Vec<InvoiceLine>) -> Self {
        InvoiceLines(lines)
    }

    pub fn add(&mut self, line: InvoiceLine) {
        self.0.push(line);
    }

    pub fn total(&self) -> Money {
        let mut total = Money::zero();
        for line in &self.0 {
            line.with_amount(|amount| total.add(amount));
        }
        total
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn to_vec(&self) -> Vec<InvoiceLine> {
        self.0.clone()
    }
}
```

| Condition | Meaning / options |
|-----------|-------------------|
| The value has a business rule (format, range) | Domain Primitive whose factory checks the rule and returns a Result |
| The backing type alone expresses the valid domain | Use the backing type directly; do not create a DP |
| Several values always travel together with a rule | Value object |
| A type holds a collection beside other state | First-class collection type |

## Event Sourcing

A command checks the rules, changes the state through the declared replay method, and returns the one event it produced. Restoring replays the stored events through the same method, so the change a command makes and the change a replay makes cannot drift apart. The replay method decides nothing.

```rust
impl Invoice {
    pub fn issue(&mut self) -> Result<InvoiceIssued, IssueInvoiceError> {
        if self.issued { return Err(IssueInvoiceError::AlreadyIssued); }
        if self.lines.is_empty() { return Err(IssueInvoiceError::EmptyLines); }
        let event = InvoiceIssued::new(&self.id);
        self.apply_issued(&event);
        Ok(event)
    }

    pub fn apply_issued(&mut self, _event: &InvoiceIssued) {
        self.issued = true;
    }
}
```

The mapping lists `apply_issued` in `replay_methods` with `event_ref: event.invoice.issued`. A method named `apply` is not a replay method unless it is declared.

## Ports, Use Cases, and Adapters

The repository port is a trait named after the aggregate, declared in the use-case crate and never in a domain crate. Loading and storing reach outside the process and can fail, so every method returns `Result` and reports a failure as `RepositoryError`, an infrastructure failure declared beside the port, not a business error. The lookup does not treat a missing invoice as a failure and returns `Ok(None)` (`Result<Option<Invoice>, RepositoryError>`); the store changes what is stored, so it takes `&mut self` and returns `Result<(), RepositoryError>`. Taking `&self` and changing the storage through a `RefCell` inside the implementation hides the change behind interior mutability. The one exception is a port shared across threads that needs a lock: then the trait declares `Send + Sync`, the store takes `&self`, and the implementation guards its storage with a `Mutex` or an `RwLock`. A use case holds the port as a `&mut` reference to a generic parameter (static dispatch), and its `execute` takes `&mut self`; a trait object is only for choosing an implementation at run time. The use case turns a missing invoice into its own error (`InvoiceNotFound`), stores the invoice the command changed, returns a failed store instead of dropping it, and returns the event for the caller to publish after persistence.

```rust
use billing_domain::invoice::Invoice;

/// A load or a store that did not complete: a failure of the infrastructure, not a business error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryError {
    pub message: String,
}

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError>;
    fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;
}

use billing_domain::invoice::{InvoiceIssued, IssueInvoiceError};

use crate::invoice_repository::{InvoiceRepository, RepositoryError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvoiceNotFound;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueInvoiceFailure {
    NotFound(InvoiceNotFound),
    Rejected(IssueInvoiceError),
    Repository(RepositoryError),
}

pub struct IssueInvoiceUseCase<'a, R: InvoiceRepository> {
    invoice_repository: &'a mut R,
}

impl<'a, R: InvoiceRepository> IssueInvoiceUseCase<'a, R> {
    pub fn new(invoice_repository: &'a mut R) -> Self {
        IssueInvoiceUseCase { invoice_repository }
    }

    /// Issues the invoice, stores it, and hands back the event for the caller to publish.
    pub fn execute(&mut self, invoice_id: &str) -> Result<InvoiceIssued, IssueInvoiceFailure> {
        let Some(mut invoice) = self.invoice_repository.find_by_id(invoice_id).map_err(IssueInvoiceFailure::Repository)? else {
            return Err(IssueInvoiceFailure::NotFound(InvoiceNotFound));
        };
        let issued = invoice.issue().map_err(IssueInvoiceFailure::Rejected)?;
        self.invoice_repository.store(invoice_id, invoice).map_err(IssueInvoiceFailure::Repository)?;
        Ok(issued)
    }
}
```

The adapter implements the port, may prefix its name with the storage medium, and restores the aggregate through `restore`, the customer through `parse`, and the lines through `of`. It returns `Ok(None)` when there is no record and reports a failure of the storage as `RepositoryError` (the in-memory implementation never fails).

```rust
use std::collections::HashMap;

use billing_domain::customer_id::CustomerId;
use billing_domain::invoice::line::InvoiceLine;
use billing_domain::invoice::lines::InvoiceLines;
use billing_domain::invoice::Invoice;
use billing_domain::money::Money;
use billing_use_case::invoice_repository::{InvoiceRepository, RepositoryError};

pub struct InvoiceRecord {
    pub customer: String,
    pub amounts: Vec<i64>,
    pub issued: bool,
    pub last_add_line_command_id: Option<String>,
}

/// The invoices stored here take precedence over the records they were first read from.
pub struct InMemoryInvoiceRepository {
    records: HashMap<String, InvoiceRecord>,
    stored: HashMap<String, Invoice>,
}

impl InMemoryInvoiceRepository {
    pub fn new(records: HashMap<String, InvoiceRecord>) -> Self {
        InMemoryInvoiceRepository { records, stored: HashMap::new() }
    }
}

impl InvoiceRepository for InMemoryInvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError> {
        if let Some(stored) = self.stored.get(invoice_id) {
            return Ok(Some(stored.clone()));
        }
        let Some(record) = self.records.get(invoice_id) else {
            return Ok(None);
        };
        let customer = CustomerId::parse(&record.customer).expect("corrupt invoice record: customer ID");
        let lines = InvoiceLines::of(record.amounts.iter().map(|amount| InvoiceLine::of(Money::of(*amount))).collect());
        let invoice = Invoice::restore(invoice_id, customer, lines, record.issued, record.last_add_line_command_id.clone())
            .expect("corrupt invoice record");
        Ok(Some(invoice))
    }

    fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError> {
        self.stored.insert(invoice_id.to_string(), invoice);
        Ok(())
    }
}
```

## Module Layouts

| Layout | Module with children | Leaf |
|--------|---------------------|------|
| `file` | `src/invoice.rs` | `src/invoice/line.rs` |
| `mod-rs` | `src/invoice/mod.rs` | `src/invoice/line.rs` |

`lib.rs`, `main.rs`, and the roots Cargo names keep their names in both layouts. The layout applies to every package, test, example, bench, and build script. A `#[cfg(test)]` module, in its own file or inline, is test code and is not checked as business code.

## Workspace Placement

```text
Cargo.toml
packages/
  command/
    billing-domain/            # domain (suffix -domain)
    billing-use-case/          # use-case
    billing-interface-adapter/ # interface-adapter
  query/
    billing-query-use-case/
    billing-query-interface-adapter/
  rmu/
    billing-rmu/
  composition-root/
    billing-api/               # binary that wires everything
```
