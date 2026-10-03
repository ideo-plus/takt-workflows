/**
 * The Rust projects the DDD knowledge teaches, one per module layout (`file`, `mod-rs`), with the
 * model files ddd-lint reads.
 *
 * Each project is a Cargo workspace of three crates under `packages/command/`: a domain crate with the
 * `invoice` aggregate and its child modules `invoice::line` and `invoice::lines`, a use-case crate
 * with the repository port and the use case that issues an invoice, and an interface-adapter crate
 * that implements the port in memory. The model is the one the TypeScript samples use; the mapping
 * spells each method, type and error case the Rust way.
 */

import { DOMAIN_MODEL } from "./typescript.ts";

export type RustLayout = "file" | "mod-rs";

export const RUST_LAYOUTS: readonly RustLayout[] = ["file", "mod-rs"];

const DOMAIN_CRATE = "billing-domain";
const USE_CASE_CRATE = "billing-use-case";
const INTERFACE_ADAPTER_CRATE = "billing-interface-adapter";
const DOMAIN_DIR = `packages/command/${DOMAIN_CRATE}`;
const USE_CASE_DIR = `packages/command/${USE_CASE_CRATE}`;
const INTERFACE_ADAPTER_DIR = `packages/command/${INTERFACE_ADAPTER_CRATE}`;

/** The project-relative file of the `invoice` parent module under `layout`. */
export function rustParentModuleFile(layout: RustLayout): string {
  return layout === "file" ? `${DOMAIN_DIR}/src/invoice.rs` : `${DOMAIN_DIR}/src/invoice/mod.rs`;
}

const DOMAIN_LIB = `pub mod customer_id;
pub mod invoice;
pub mod money;
`;

export const RUST_CUSTOMER_ID = `#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
`;

export const RUST_MONEY = `#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
`;

export const RUST_INVOICE_LINE = `use crate::money::Money;

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
`;

export const RUST_INVOICE_LINES = `use super::line::InvoiceLine;
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
`;

export const RUST_INVOICE = `pub mod line;
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
`;

const USE_CASE_LIB = `pub mod invoice_repository;
pub mod issue_invoice;
`;

export const RUST_INVOICE_REPOSITORY_PORT = `use billing_domain::invoice::Invoice;

/// A load or a store that did not complete: a failure of the infrastructure, not a business error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryError {
    pub message: String,
}

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError>;
    fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;
}
`;

export const RUST_ISSUE_INVOICE = `use billing_domain::invoice::{InvoiceIssued, IssueInvoiceError};

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
`;

const INTERFACE_ADAPTER_LIB = `pub mod in_memory_invoice_repository;
`;

export const RUST_IN_MEMORY_INVOICE_REPOSITORY = `use std::collections::HashMap;

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
`;

const WORKSPACE_MANIFEST = `[workspace]
resolver = "2"
members = [
    "${DOMAIN_DIR}",
    "${USE_CASE_DIR}",
    "${INTERFACE_ADAPTER_DIR}",
]
`;

function crateManifest(name: string, dependencies: readonly string[]): string {
  const lines = ["[package]", `name = "${name}"`, 'version = "0.1.0"', 'edition = "2021"', "publish = false", ""];
  if (dependencies.length > 0)
    lines.push("[dependencies]", ...dependencies.map((dependency) => `${dependency} = { path = "../${dependency}" }`), "");
  return lines.join("\n");
}

function location(module: readonly string[]): string {
  return `{ language: rust, package: ${DOMAIN_CRATE}, module: [${module.join(", ")}] }`;
}

export const RUST_AGGREGATE_MAPPING = [
  "model_ref: domain-model.yaml",
  "aggregate_mappings:",
  "  - aggregate_ref: aggregate.invoice",
  "    programming_model: class",
  "    persistence_method: state-sourcing",
  "    reference_ids: [entity.invoice]",
  `    code: { language: rust, package: ${DOMAIN_CRATE}, module: [invoice], type: Invoice }`,
  "    operations:",
  "      - operation_ref: factory.invoice.open",
  "        code: { method: open, error_type: OpenInvoiceError }",
  "        errors:",
  "          - { error_ref: error.invoice.open.negative-total, code: { case: NegativeTotal } }",
  "      - operation_ref: factory.invoice.parse-customer-id",
  "        code: { method: parse, error_type: ParseCustomerIdError }",
  "        errors:",
  "          - { error_ref: error.invoice.parse-customer-id.invalid-format, code: { case: InvalidFormat } }",
  "      - operation_ref: factory.invoice.parse-money",
  "        code: { method: parse, error_type: ParseMoneyError }",
  "        errors:",
  "          - { error_ref: error.invoice.parse-money.invalid-increment, code: { case: InvalidIncrement } }",
  "      - operation_ref: command.invoice.add-line",
  "        code: { method: add_line, success_type: AddInvoiceLineOutcome, error_type: AddInvoiceLineError }",
  "        errors:",
  "          - { error_ref: error.invoice.add-line.already-issued, code: { case: AlreadyIssued } }",
  "          - { error_ref: error.invoice.add-line.negative-total, code: { case: NegativeTotal } }",
  "      - operation_ref: command.invoice.issue",
  "        code: { method: issue, success_type: InvoiceIssued, error_type: IssueInvoiceError }",
  "        errors:",
  "          - { error_ref: error.invoice.issue.already-issued, code: { case: AlreadyIssued } }",
  "          - { error_ref: error.invoice.issue.empty-lines, code: { case: EmptyLines } }",
  "domain_packages:",
  `  - { term: Billing, model_refs: [bc.billing], rationale: owns the billing business, code: ${location([])} }`,
  `  - { term: Invoice, model_refs: [aggregate.invoice], rationale: opens and issues invoices, code: ${location(["invoice"])} }`,
  `  - { term: Invoice line, model_refs: [vo.invoice-line], rationale: one amount an invoice adds up, code: ${location(["invoice", "line"])} }`,
  `  - { term: Invoice lines, model_refs: [vo.invoice-line], rationale: the lines of one invoice and their total, code: ${location(["invoice", "lines"])} }`,
  `  - { term: Customer ID, model_refs: [primitive.customer-id], rationale: identifies the customer an invoice bills, code: ${location(["customer_id"])} }`,
  `  - { term: Money, model_refs: [primitive.money], rationale: the amount of a line and the total of an invoice, code: ${location(["money"])} }`,
  "",
].join("\n");

function identity(name: string): string {
  return `{ language: rust, package: ${name} }`;
}

export const RUST_LAYER_STRUCTURE = [
  "model_ref: domain-model.yaml",
  "layer_structures:",
  "  - context_ref: bc.billing",
  "    cqrs: false",
  "    packages:",
  `      - { role: command, code: ${identity(DOMAIN_CRATE)} }`,
  `      - { role: command, code: ${identity(USE_CASE_CRATE)} }`,
  `      - { role: command, code: ${identity(INTERFACE_ADAPTER_CRATE)} }`,
  "    dependencies:",
  `      - { code: ${identity(DOMAIN_CRATE)}, depends_on: [] }`,
  `      - { code: ${identity(USE_CASE_CRATE)}, depends_on: [${identity(DOMAIN_CRATE)}] }`,
  `      - { code: ${identity(INTERFACE_ADAPTER_CRATE)}, depends_on: [${identity(DOMAIN_CRATE)}, ${identity(USE_CASE_CRATE)}] }`,
  "    ports:",
  "      - { name: InvoiceRepository, kind: repository, verbs: [find_by_id, store] }",
  "    repositories:",
  "      - { name: InvoiceRepository, aggregate_ref: aggregate.invoice, io_unit: single, verbs: [find_by_id, store], store_semantics: upsert }",
  "    restoration_paths:",
  "      - { aggregate_ref: aggregate.invoice, via: full-constructor }",
  "    persistence_backend: in-memory",
  "",
].join("\n");

export interface RustSample {
  readonly name: string;
  readonly layout: RustLayout;
  readonly files: Readonly<Record<string, string>>;
}

export function rustSample(layout: RustLayout): RustSample {
  const files: Record<string, string> = {
    ".ddd.toml": `languages = ["rust"]\n\n[rust]\nmodule_layout = "${layout}"\n`,
    "docs/ddd/domain-model.yaml": DOMAIN_MODEL,
    "docs/ddd/aggregate-mapping.yaml": RUST_AGGREGATE_MAPPING,
    "docs/ddd/layer-structure.yaml": RUST_LAYER_STRUCTURE,
    "Cargo.toml": WORKSPACE_MANIFEST,
    [`${DOMAIN_DIR}/Cargo.toml`]: crateManifest(DOMAIN_CRATE, []),
    [`${DOMAIN_DIR}/src/lib.rs`]: DOMAIN_LIB,
    [`${DOMAIN_DIR}/src/customer_id.rs`]: RUST_CUSTOMER_ID,
    [rustParentModuleFile(layout)]: RUST_INVOICE,
    [`${DOMAIN_DIR}/src/invoice/line.rs`]: RUST_INVOICE_LINE,
    [`${DOMAIN_DIR}/src/invoice/lines.rs`]: RUST_INVOICE_LINES,
    [`${DOMAIN_DIR}/src/money.rs`]: RUST_MONEY,
    [`${USE_CASE_DIR}/Cargo.toml`]: crateManifest(USE_CASE_CRATE, [DOMAIN_CRATE]),
    [`${USE_CASE_DIR}/src/lib.rs`]: USE_CASE_LIB,
    [`${USE_CASE_DIR}/src/invoice_repository.rs`]: RUST_INVOICE_REPOSITORY_PORT,
    [`${USE_CASE_DIR}/src/issue_invoice.rs`]: RUST_ISSUE_INVOICE,
    [`${INTERFACE_ADAPTER_DIR}/Cargo.toml`]: crateManifest(INTERFACE_ADAPTER_CRATE, [DOMAIN_CRATE, USE_CASE_CRATE]),
    [`${INTERFACE_ADAPTER_DIR}/src/lib.rs`]: INTERFACE_ADAPTER_LIB,
    [`${INTERFACE_ADAPTER_DIR}/src/in_memory_invoice_repository.rs`]: RUST_IN_MEMORY_INVOICE_REPOSITORY,
  };
  return { name: `rust-${layout}`, layout, files };
}

export function rustSamples(): RustSample[] {
  return RUST_LAYOUTS.map(rustSample);
}
