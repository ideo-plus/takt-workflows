/**
 * The Rust projects the DDD knowledge teaches, one per module layout (`file`, `mod-rs`), with the
 * model files ddd-lint reads.
 *
 * Each project is a Cargo workspace of three crates under `packages/command/`: a domain crate with the
 * `invoice` aggregate and its child modules `invoice::line`, `invoice::lines` and
 * `invoice::add_line_requests`, a use-case crate with the repository port and the use case that
 * issues an invoice, and an interface-adapter crate that implements the port in memory. The model is the one the TypeScript samples use; the mapping spells each method, type and
 * error case the Rust way.
 */

import { DOMAIN_MODEL } from "./typescript.ts";

export const RUST_DOMAIN_MODEL = DOMAIN_MODEL.replace(
  "          - { element_id: primitive.customer-id, kind: domain-primitive, name: CustomerId, aggregate: aggregate.invoice, attributes: [{ name: value, type: string, required: true }] }",
  '          - { element_id: primitive.customer-id, kind: domain-primitive, name: CustomerId, aggregate: aggregate.invoice, attributes: [{ name: value, type: string, required: true }] }\n          - { element_id: primitive.money, kind: domain-primitive, name: Money, aggregate: aggregate.invoice, unconstrained: "individual line amounts may be positive, zero, or negative", attributes: [{ name: value, type: decimal, required: true }] }',
);

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
`;

export const RUST_CUSTOMER_ID = `#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
`;

export const RUST_INVOICE_LINE = `#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Money(i64);

impl Money {
    pub fn of(value: i64) -> Self {
        Money(value)
    }

    pub fn zero() -> Self {
        Money(0)
    }

    pub fn add(&mut self, rhs: &Money) {
        self.0 += rhs.0;
    }

    pub fn is_negative(&self) -> bool {
        self.0 < 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLine {
    amount: Money,
}

impl InvoiceLine {
    pub fn of(amount: i64) -> Self {
        InvoiceLine { amount: Money::of(amount) }
    }

    pub fn with_amount<R>(&self, use_amount: impl FnOnce(&Money) -> R) -> R {
        use_amount(&self.amount)
    }
}
`;

export const RUST_INVOICE_LINES = `use super::line::{InvoiceLine, Money};

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

export const RUST_ADD_LINE_REQUESTS = `/// The model's retention_count for command.invoice.add-line.
const RETENTION: usize = 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AddLineRequests(Vec<String>);

impl AddLineRequests {
    pub fn of(request_ids: Vec<String>) -> Self {
        let mut requests = AddLineRequests(request_ids);
        requests.forget_oldest();
        requests
    }

    pub fn contains(&self, request_id: &str) -> bool {
        self.0.iter().any(|seen| seen == request_id)
    }

    pub fn add(&mut self, request_id: &str) {
        self.0.push(request_id.to_string());
        self.forget_oldest();
    }

    pub fn to_vec(&self) -> Vec<String> {
        self.0.clone()
    }

    fn forget_oldest(&mut self) {
        let excess = self.0.len().saturating_sub(RETENTION);
        self.0.drain(..excess);
    }
}
`;

export const RUST_INVOICE = `pub mod add_line_requests;
pub mod line;
pub mod lines;

use self::add_line_requests::AddLineRequests;
use self::line::{InvoiceLine, Money};
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
        if lines.total().is_negative() {
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
        if (issued && lines.is_empty()) || lines.total().is_negative() {
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
        line.with_amount(|amount| total.add(amount));
        if total.is_negative() {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvoiceNotFound;

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Invoice, InvoiceNotFound>;
    fn store(&self, invoice_id: &str, invoice: Invoice);
}
`;

export const RUST_ISSUE_INVOICE = `use billing_domain::invoice::{InvoiceIssued, IssueInvoiceError};

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
`;

const INTERFACE_ADAPTER_LIB = `pub mod in_memory_invoice_repository;
`;

export const RUST_IN_MEMORY_INVOICE_REPOSITORY = `use std::cell::RefCell;
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
  `  - { term: Invoice line, model_refs: [vo.invoice-line, primitive.money], rationale: the amounts an invoice adds up, code: ${location(["invoice", "line"])} }`,
  `  - { term: Invoice lines, model_refs: [vo.invoice-line], rationale: the lines of one invoice and their total, code: ${location(["invoice", "lines"])} }`,
  `  - { term: Add-line requests, model_refs: [command.invoice.add-line], rationale: the add-line requests an invoice has applied, code: ${location(["invoice", "add_line_requests"])} }`,
  `  - { term: Customer ID, model_refs: [primitive.customer-id], rationale: identifies the customer an invoice bills, code: ${location(["customer_id"])} }`,
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
    "docs/ddd/domain-model.yaml": RUST_DOMAIN_MODEL,
    "docs/ddd/aggregate-mapping.yaml": RUST_AGGREGATE_MAPPING,
    "docs/ddd/layer-structure.yaml": RUST_LAYER_STRUCTURE,
    "Cargo.toml": WORKSPACE_MANIFEST,
    [`${DOMAIN_DIR}/Cargo.toml`]: crateManifest(DOMAIN_CRATE, []),
    [`${DOMAIN_DIR}/src/lib.rs`]: DOMAIN_LIB,
    [`${DOMAIN_DIR}/src/customer_id.rs`]: RUST_CUSTOMER_ID,
    [rustParentModuleFile(layout)]: RUST_INVOICE,
    [`${DOMAIN_DIR}/src/invoice/line.rs`]: RUST_INVOICE_LINE,
    [`${DOMAIN_DIR}/src/invoice/lines.rs`]: RUST_INVOICE_LINES,
    [`${DOMAIN_DIR}/src/invoice/add_line_requests.rs`]: RUST_ADD_LINE_REQUESTS,
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
