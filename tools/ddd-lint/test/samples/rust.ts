/**
 * The Rust projects the DDD knowledge teaches, one per module layout (`file`, `mod-rs`), with the
 * model files ddd-lint reads.
 *
 * Each project is a Cargo workspace of three crates under `packages/command/`: a domain crate with the
 * `invoice` aggregate and its child module `invoice::line`, a use-case crate with the repository port
 * and the use case that issues an invoice, and an interface-adapter crate that implements the port in
 * memory. The model is the one the TypeScript samples use; the mapping spells each method, type and
 * error case the Rust way.
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

const DOMAIN_LIB = `pub mod invoice;
`;

export const RUST_INVOICE_LINE = `#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLine {
    amount: i64,
}

impl InvoiceLine {
    pub fn of(amount: i64) -> Self {
        InvoiceLine { amount }
    }

    pub fn add_to(&self, total: i64) -> i64 {
        total + self.amount
    }
}
`;

export const RUST_INVOICE = `pub mod line;

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
  "          - { error_ref: error.invoice.open.missing-customer, code: { case: MissingCustomer } }",
  "          - { error_ref: error.invoice.open.negative-total, code: { case: NegativeTotal } }",
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
  `  - { term: Invoice line, model_refs: [vo.invoice-line], rationale: the amounts an invoice adds up, code: ${location(["invoice", "line"])} }`,
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
    [rustParentModuleFile(layout)]: RUST_INVOICE,
    [`${DOMAIN_DIR}/src/invoice/line.rs`]: RUST_INVOICE_LINE,
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
