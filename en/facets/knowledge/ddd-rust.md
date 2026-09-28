# DDD Rust Knowledge

## Aggregate

An aggregate keeps private fields, a private constructor that takes the whole state, validating factories that return the operation's own error enum, a `restore` function for persisted state, and commands that take `&mut self`, change the state, and return the one event they produce. A command that fails changes nothing and produces no event.

```rust
pub mod line;

use self::line::InvoiceLine;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenInvoiceError {
    MissingCustomer,
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

fn sum_of(lines: &[InvoiceLine]) -> i64 {
    lines.iter().fold(0, |sum, line| line.add_to(sum))
}

#[derive(Debug, Clone)]
pub struct Invoice {
    id: String,
    customer: String,
    lines: Vec<InvoiceLine>,
    issued: bool,
    add_line_requests: Vec<String>,
}

impl Invoice {
    fn new(id: String, customer: String, lines: Vec<InvoiceLine>, issued: bool, add_line_requests: Vec<String>) -> Self {
        Invoice { id, customer, lines, issued, add_line_requests }
    }

    pub fn open(id: &str, customer: &str, lines: Vec<InvoiceLine>) -> Result<Self, OpenInvoiceError> {
        if customer.is_empty() {
            return Err(OpenInvoiceError::MissingCustomer);
        }
        if sum_of(&lines) < 0 {
            return Err(OpenInvoiceError::NegativeTotal);
        }
        Ok(Self::new(id.to_string(), customer.to_string(), lines, false, Vec::new()))
    }

    pub fn restore(
        id: &str,
        customer: &str,
        lines: Vec<InvoiceLine>,
        issued: bool,
        add_line_requests: Vec<String>,
    ) -> Result<Self, CorruptInvoiceState> {
        if customer.is_empty() || (issued && lines.is_empty()) || sum_of(&lines) < 0 {
            return Err(CorruptInvoiceState);
        }
        Ok(Self::new(id.to_string(), customer.to_string(), lines, issued, add_line_requests))
    }

    pub fn add_line(&mut self, request_id: &str, line: InvoiceLine) -> Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if self.add_line_requests.iter().any(|seen| seen == request_id) {
            return Ok(AddInvoiceLineOutcome::Duplicate);
        }
        if self.issued {
            return Err(AddInvoiceLineError::AlreadyIssued);
        }
        if line.add_to(sum_of(&self.lines)) < 0 {
            return Err(AddInvoiceLineError::NegativeTotal);
        }
        self.lines.push(line.clone());
        self.add_line_requests.push(request_id.to_string());
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

    pub fn is_billed_to(&self, customer: &str) -> bool {
        self.customer == customer
    }

    pub fn total(&self) -> i64 {
        sum_of(&self.lines)
    }

    pub fn lines(&self) -> Vec<InvoiceLine> {
        self.lines.clone()
    }
}
```

`restore` reports a corrupt state with its own type because it is not a business failure. `add_line` remembers the request IDs it applied and recognizes a resent one before any other check: it returns `AddInvoiceLineOutcome::Duplicate`, changes nothing, and produces no event, so the event is never published twice. Events are domain types too: their fields are private, they are built by their own `new` inside the aggregate's module, and they offer read-only accessors to the code that publishes them. `total` asks each line to add itself instead of reading its amount. The example keeps the IDs and the customer as `&str` / `String` only to stay short; real code wraps them in Domain Primitives.

## Value Objects and Domain Primitives

A value object is immutable and validated on construction; equality follows its value.

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CustomerId(String);

impl CustomerId {
    pub fn parse(value: &str) -> Result<Self, InvalidCustomerId> {
        if value.is_empty() { return Err(InvalidCustomerId); }
        Ok(Self(value.to_owned()))
    }
}
```

| Condition | Meaning / options |
|-----------|-------------------|
| The value has a business rule (format, range) | Domain Primitive with a validating constructor |
| Several values always travel together with a rule | Value object |
| A collection has a rule (no duplicates, a total limit) | Dedicated collection type |

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

The adapter implements the port, may prefix its name with the storage medium, and restores the aggregate through `restore` and each line through `of`.

```rust
use std::cell::RefCell;
use std::collections::HashMap;

use billing_domain::invoice::line::InvoiceLine;
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
        let lines: Vec<InvoiceLine> = record.amounts.iter().map(|amount| InvoiceLine::of(*amount)).collect();
        Invoice::restore(invoice_id, &record.customer, lines, record.issued, record.add_line_requests.clone())
            .map_err(|_| InvoiceNotFound)
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
