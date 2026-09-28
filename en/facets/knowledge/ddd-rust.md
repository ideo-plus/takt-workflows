# DDD Rust Knowledge

## Aggregate

An aggregate keeps private fields, a private constructor that takes the whole state, validating factories that return the operation's own error enum, a `restore` function for persisted state, and commands that take `&mut self`, change the state, and return the one event they produce. A command that fails changes nothing and produces no event.

```rust
pub mod add_line_requests;
pub mod line;
pub mod lines;

use self::add_line_requests::AddLineRequests;
use self::line::InvoiceLine;
use self::lines::InvoiceLines;
use crate::customer_id::CustomerId;

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
    request_id: String,
    line: InvoiceLine,
}

impl InvoiceLineAdded {
    fn new(invoice_id: &str, request_id: &str, line: InvoiceLine) -> Self {
        InvoiceLineAdded { invoice_id: invoice_id.to_string(), request_id: request_id.to_string(), line }
    }

    pub fn invoice_id(&self) -> &str {
        &self.invoice_id
    }

    pub fn request_id(&self) -> &str {
        &self.request_id
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

/// A request id already applied changes nothing and produces no event.
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
    add_line_requests: AddLineRequests,
}

impl Invoice {
    fn new(id: String, customer: CustomerId, lines: InvoiceLines, issued: bool, add_line_requests: AddLineRequests) -> Self {
        Invoice { id, customer, lines, issued, add_line_requests }
    }

    pub fn open(id: &str, customer: CustomerId, lines: InvoiceLines) -> Result<Self, OpenInvoiceError> {
        if lines.total() < 0 {
            return Err(OpenInvoiceError::NegativeTotal);
        }
        Ok(Self::new(id.to_string(), customer, lines, false, AddLineRequests::of(Vec::new())))
    }

    pub fn restore(
        id: &str,
        customer: CustomerId,
        lines: InvoiceLines,
        issued: bool,
        add_line_requests: AddLineRequests,
    ) -> Result<Self, CorruptInvoiceState> {
        if (issued && lines.is_empty()) || lines.total() < 0 {
            return Err(CorruptInvoiceState);
        }
        Ok(Self::new(id.to_string(), customer, lines, issued, add_line_requests))
    }

    pub fn add_line(&mut self, request_id: &str, line: InvoiceLine) -> Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if self.add_line_requests.contains(request_id) {
            return Ok(AddInvoiceLineOutcome::Duplicate);
        }
        if self.issued {
            return Err(AddInvoiceLineError::AlreadyIssued);
        }
        let mut total = self.lines.total();
        line.add_to(&mut total);
        if total < 0 {
            return Err(AddInvoiceLineError::NegativeTotal);
        }
        self.lines.add(line.clone());
        self.add_line_requests.add(request_id);
        Ok(AddInvoiceLineOutcome::Applied(InvoiceLineAdded::new(&self.id, request_id, line)))
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

    pub fn total(&self) -> i64 {
        self.lines.total()
    }

    pub fn lines(&self) -> InvoiceLines {
        self.lines.clone()
    }
}
```

`restore` reports a corrupt state with its own type because it is not a business failure. `add_line` remembers the request IDs it applied and recognizes a resent one before any other check: it returns `AddInvoiceLineOutcome::Duplicate`, changes nothing, and produces no event, so the event is never published twice. It checks the new total before it changes anything. Events are domain types too: their fields are private, they are built by their own `new` inside the aggregate's module, and they offer read-only accessors to the code that publishes them. The customer is the Domain Primitive `CustomerId`, and the lines and the applied request IDs are the first-class collections `InvoiceLines` and `AddLineRequests`. The invoice ID and the amounts stay `&str` / `i64` only to keep the example short; real code wraps them the same way.

## Changing in Place

What changes is taken as `&mut` and changed in place, whatever kind of domain type it is. A value object, Domain Primitive, or collection that changes takes `&mut self` and returns `()`, or `Result<(), E>` when the change can fail; it does not take `&self` or `self` and hand back a new instance, and it does not implement operators such as `Add` that return a new value. Ownership keeps this safe: a value shared through `&` cannot change, and a caller that needs the value before the change clones it first. The `&mut self` methods of the values inside an aggregate are not commands; the aggregate's commands call them.

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLine {
    amount: i64,
}

impl InvoiceLine {
    pub fn of(amount: i64) -> Self {
        InvoiceLine { amount }
    }

    pub fn add_to(&self, total: &mut i64) {
        *total += self.amount;
    }
}
```

`add_to` changes the total, not the line, so the total is the `&mut` parameter and the line is `&self`. Nothing is read out of the line; the line adds itself.

## Domain Primitives

A Domain Primitive wraps one value and states its value rule. The model declares the rule as an invariant on the primitive and a factory rule that builds it; the factory checks the rule and returns the factory's own error enum, so a `CustomerId` that exists is always valid. Equality follows the value.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseCustomerIdError {
    InvalidFormat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomerId(String);

impl CustomerId {
    pub fn parse(value: &str) -> Result<Self, ParseCustomerIdError> {
        let digits = value.strip_prefix('C').ok_or(ParseCustomerIdError::InvalidFormat)?;
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(ParseCustomerIdError::InvalidFormat);
        }
        Ok(CustomerId(value.to_string()))
    }
}
```

A primitive without a rule declares `unconstrained` with a rationale in the model and is built by an associated function such as `of` that checks nothing.

## First-Class Collections

A domain type that holds a collection beside other state wraps it in a first-class collection: a type whose whole state is the collection, which owns the operations and decisions on it. `InvoiceLines` adds a line in place and totals the lines; the aggregate never touches the `Vec`.

```rust
use super::line::InvoiceLine;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLines(Vec<InvoiceLine>);

impl InvoiceLines {
    pub fn of(lines: Vec<InvoiceLine>) -> Self {
        InvoiceLines(lines)
    }

    pub fn add(&mut self, line: InvoiceLine) {
        self.0.push(line);
    }

    pub fn total(&self) -> i64 {
        let mut total = 0;
        for line in &self.0 {
            line.add_to(&mut total);
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

`AddLineRequests` wraps the applied request IDs the same way: `contains` answers whether a request was applied, and `add` remembers one in place and forgets the oldest beyond the model's `retention_count`.

| Condition | Meaning / options |
|-----------|-------------------|
| The value has a business rule (format, range) | Domain Primitive whose factory checks the rule and returns a Result |
| The value has no business rule | Domain Primitive declared `unconstrained` with a rationale |
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

The repository port is a trait named after the aggregate, declared in the use-case crate. A use case holds it through a trait object (or a generic parameter for static dispatch), stores the invoice the command changed, and returns the event for the caller to publish after persistence.

```rust
use billing_domain::invoice::Invoice;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvoiceNotFound;

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Invoice, InvoiceNotFound>;
    fn store(&self, invoice_id: &str, invoice: Invoice);
}

use billing_domain::invoice::{InvoiceIssued, IssueInvoiceError};

use crate::invoice_repository::{InvoiceNotFound, InvoiceRepository};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueInvoiceFailure {
    NotFound(InvoiceNotFound),
    Rejected(IssueInvoiceError),
}

pub struct IssueInvoice<'a> {
    invoices: &'a dyn InvoiceRepository,
}

impl<'a> IssueInvoice<'a> {
    pub fn new(invoices: &'a dyn InvoiceRepository) -> Self {
        IssueInvoice { invoices }
    }

    /// Issues the invoice, stores it, and hands back the event for the caller to publish.
    pub fn execute(&self, invoice_id: &str) -> Result<InvoiceIssued, IssueInvoiceFailure> {
        let mut invoice = self.invoices.find_by_id(invoice_id).map_err(IssueInvoiceFailure::NotFound)?;
        let issued = invoice.issue().map_err(IssueInvoiceFailure::Rejected)?;
        self.invoices.store(invoice_id, invoice);
        Ok(issued)
    }
}
```

The adapter implements the port, may prefix its name with the storage medium, and restores the aggregate through `restore`, the customer through `parse`, and the collections through `of`.

```rust
use std::cell::RefCell;
use std::collections::HashMap;

use billing_domain::customer_id::CustomerId;
use billing_domain::invoice::add_line_requests::AddLineRequests;
use billing_domain::invoice::line::InvoiceLine;
use billing_domain::invoice::lines::InvoiceLines;
use billing_domain::invoice::Invoice;
use billing_use_case::invoice_repository::{InvoiceNotFound, InvoiceRepository};

pub struct InvoiceRecord {
    pub customer: String,
    pub amounts: Vec<i64>,
    pub issued: bool,
    pub add_line_requests: Vec<String>,
}

/// The invoices stored here take precedence over the records they were first read from.
pub struct InMemoryInvoiceRepository {
    records: HashMap<String, InvoiceRecord>,
    stored: RefCell<HashMap<String, Invoice>>,
}

impl InMemoryInvoiceRepository {
    pub fn new(records: HashMap<String, InvoiceRecord>) -> Self {
        InMemoryInvoiceRepository { records, stored: RefCell::new(HashMap::new()) }
    }
}

impl InvoiceRepository for InMemoryInvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Invoice, InvoiceNotFound> {
        if let Some(stored) = self.stored.borrow().get(invoice_id) {
            return Ok(stored.clone());
        }
        let record = self.records.get(invoice_id).ok_or(InvoiceNotFound)?;
        let customer = CustomerId::parse(&record.customer).expect("corrupt invoice record: customer ID");
        let lines = InvoiceLines::of(record.amounts.iter().map(|amount| InvoiceLine::of(*amount)).collect());
        let requests = AddLineRequests::of(record.add_line_requests.clone());
        let invoice = Invoice::restore(invoice_id, customer, lines, record.issued, requests).expect("corrupt invoice record");
        Ok(invoice)
    }

    fn store(&self, invoice_id: &str, invoice: Invoice) {
        self.stored.borrow_mut().insert(invoice_id.to_string(), invoice);
    }
}
```

## Module Layouts

| Layout | Module with children | Leaf |
|--------|---------------------|------|
| `file` | `src/invoice.rs` + `src/invoice/line.rs` | `src/money.rs` |
| `mod-rs` | `src/invoice/mod.rs` + `src/invoice/line.rs` | `src/money.rs` |

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
