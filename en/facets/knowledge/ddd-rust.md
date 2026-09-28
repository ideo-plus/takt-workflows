# DDD Rust Knowledge

## Aggregate

An aggregate keeps private fields, a private constructor that takes the whole state, validating factories that return the operation's own error enum, a `restore` function for persisted state, and commands that take `&mut self` and change nothing when they fail.

```rust
use crate::invoice::line::InvoiceLine;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenInvoiceError { MissingCustomer, NegativeTotal }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueInvoiceError { AlreadyIssued, EmptyLines }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorruptInvoiceState;

#[derive(Debug)]
pub struct Invoice {
    customer: CustomerId,
    lines: Vec<InvoiceLine>,
    issued: bool,
}

impl Invoice {
    fn new(customer: CustomerId, lines: Vec<InvoiceLine>, issued: bool) -> Self {
        Self { customer, lines, issued }
    }

    pub fn open(customer: Option<CustomerId>, lines: Vec<InvoiceLine>) -> Result<Self, OpenInvoiceError> {
        let customer = customer.ok_or(OpenInvoiceError::MissingCustomer)?;
        if total_of(&lines) < 0 {
            return Err(OpenInvoiceError::NegativeTotal);
        }
        Ok(Self::new(customer, lines, false))
    }

    pub fn restore(customer: CustomerId, lines: Vec<InvoiceLine>, issued: bool) -> Result<Self, CorruptInvoiceState> {
        if (issued && lines.is_empty()) || total_of(&lines) < 0 {
            return Err(CorruptInvoiceState);
        }
        Ok(Self::new(customer, lines, issued))
    }

    pub fn issue(&mut self) -> Result<(), IssueInvoiceError> {
        if self.issued {
            return Err(IssueInvoiceError::AlreadyIssued);
        }
        if self.lines.is_empty() {
            return Err(IssueInvoiceError::EmptyLines);
        }
        self.issued = true;
        Ok(())
    }

    pub fn is_billed_to(&self, customer: &CustomerId) -> bool {
        &self.customer == customer
    }

    pub fn total(&self) -> i64 {
        total_of(&self.lines)
    }
}

fn total_of(lines: &[InvoiceLine]) -> i64 {
    lines.iter().fold(0, |sum, line| line.add_to(sum))
}
```

`restore` reports a corrupt state with its own type because it is not a business failure. `total` asks each line to add itself instead of reading its amount.

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

Deciding and applying are separate. A command checks the rules and returns the events; the declared replay method applies one event type and decides nothing.

```rust
impl Invoice {
    pub fn issue(&self) -> Result<Vec<InvoiceEvent>, IssueInvoiceError> {
        if self.issued { return Err(IssueInvoiceError::AlreadyIssued); }
        Ok(vec![InvoiceEvent::Issued(InvoiceIssued { invoice_id: self.id.clone() })])
    }

    pub fn apply_issued(&mut self, _event: &InvoiceIssued) {
        self.issued = true;
    }
}
```

The mapping lists `apply_issued` in `replay_methods` with `event_ref: event.invoice.issued`. A method named `apply` is not a replay method unless it is declared.

## Ports, Use Cases, and Adapters

The repository port is a trait named after the aggregate. A use case holds it through a generic parameter (static dispatch) or a trait object where runtime selection is needed.

```rust
pub trait InvoiceRepository {
    fn find_by_id(&self, id: &InvoiceId) -> Result<Invoice, RepositoryError<InvoiceId>>;
    fn store(&mut self, id: &InvoiceId, invoice: &Invoice) -> Result<(), RepositoryError<InvoiceId>>;
    fn delete_by_id(&mut self, id: &InvoiceId) -> Result<(), RepositoryError<InvoiceId>>;
}

pub struct IssueInvoice<R: InvoiceRepository> {
    invoices: R,
}

impl<R: InvoiceRepository> IssueInvoice<R> {
    pub fn execute(&mut self, invoice_id: InvoiceId) -> Result<(), IssueInvoiceFailure> {
        let mut invoice = self.invoices.find_by_id(&invoice_id)?;
        invoice.issue()?;
        self.invoices.store(&invoice_id, &invoice)?;
        Ok(())
    }
}
```

The adapter translates stored data through `restore` and database errors into `RepositoryError`.

```rust
pub struct PostgresInvoiceRepository { pool: PgPool }

impl InvoiceRepository for PostgresInvoiceRepository {
    fn find_by_id(&self, id: &InvoiceId) -> Result<Invoice, RepositoryError<InvoiceId>> {
        let row = self.fetch_row(id)?;
        Invoice::restore(row.customer()?, row.lines()?, row.issued)
            .map_err(|_| RepositoryError::Corrupt(id.clone()))
    }
    // store and delete_by_id ...
}
```

## Module Layouts

| Layout | Module with children | Leaf |
|--------|---------------------|------|
| `file` | `src/invoice.rs` + `src/invoice/line.rs` | `src/money.rs` |
| `mod-rs` | `src/invoice/mod.rs` + `src/invoice/line.rs` | `src/money.rs` |

`lib.rs`, `main.rs`, and the roots Cargo names keep their names in both layouts. The layout applies to every package, test, example, bench, and build script.

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
