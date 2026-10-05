/** Executable Event Sourcing knowledge examples. Shared primitives reuse the regression samples. */
import { classInvoice, parentModuleFile, specifiersFor, typeScriptSample, type Layout } from "./typescript.ts";
import { RUST_INVOICE, rustParentModuleFile, rustSample, type RustLayout } from "./rust.ts";

type ModelYaml = {
  parse(text: string): unknown;
  stringify(value: unknown): string;
};

function change(text: string, before: string, after: string): string {
  if (!text.includes(before)) throw new Error(`Missing example text: ${before}`);
  return text.replace(before, after);
}

export function eventTypeScriptSample(layout: Layout = "named-file", yaml: ModelYaml = Bun.YAML) {
  const sample = typeScriptSample("class", layout);
  const files = { ...sample.files };
  let invoice = classInvoice(specifiersFor(layout));
  invoice = invoice.replace('export type InvoiceLineAdded = {', 'export type InvoiceOpened = { readonly kind: "opened"; readonly invoiceId: string; readonly sequenceNumber: number; readonly customer: CustomerId; readonly lines: InvoiceLines };\nexport type InvoiceEvent = InvoiceOpened | InvoiceLineAdded | InvoiceIssued;\n\nexport type InvoiceLineAdded = { readonly kind: "line-added";').replace('export type InvoiceIssued = {', 'export type InvoiceIssued = { readonly kind: "issued";');
  invoice = change(invoice, 'readonly kind: "line-added"; readonly invoiceId: string;', 'readonly kind: "line-added"; readonly invoiceId: string; readonly sequenceNumber: number;');
  invoice = change(invoice, 'readonly kind: "issued"; readonly invoiceId: string }', 'readonly kind: "issued"; readonly invoiceId: string; readonly sequenceNumber: number }');
  invoice = invoice.replace('  readonly #id: string;', '  readonly #opening: InvoiceOpened;\n  readonly #id: string;\n  readonly #sequenceNumber: number;');
  const constructorStart = invoice.indexOf('  private constructor('), constructorEnd = invoice.indexOf('  static open(', constructorStart);
  invoice = invoice.slice(0, constructorStart) + `  private constructor(opening: InvoiceOpened, sequenceNumber: number, lines: InvoiceLines, issued: boolean, lastAddLineCommandId: string | undefined) {
    this.#opening = opening;
    this.#id = opening.invoiceId;
    this.#sequenceNumber = sequenceNumber;
    this.#customer = opening.customer;
    this.#lines = lines;
    this.#issued = issued;
    this.#lastAddLineCommandId = lastAddLineCommandId;
  }

` + invoice.slice(constructorEnd);
  invoice = change(invoice, '    return { ok: true, value: new Invoice(id, customer, lines, false, undefined) };', '    const event: InvoiceOpened = { kind: "opened", invoiceId: id, sequenceNumber: 1, customer, lines };\n    return { ok: true, value: Invoice.fromOpened(event) };');
  const from = invoice.indexOf('  static restore('), to = invoice.indexOf('  addLine(', from);
  invoice = invoice.slice(0, from) + `  openedEvent(): InvoiceOpened {
    return this.#opening;
  }

  id(): string {
    return this.#id;
  }

  sequenceNumber(): number {
    return this.#sequenceNumber;
  }

  static replay(events: readonly InvoiceEvent[], snapshot: Invoice): Invoice {
    let invoice = snapshot;
    for (const event of events) {
      if (event.invoiceId !== invoice.#id || event.sequenceNumber !== invoice.#sequenceNumber + 1) throw new Error("corrupt invoice history");
      switch (event.kind) {
        case "opened": throw new Error("corrupt invoice history");
        case "line-added":
          if (invoice.#issued || event.commandId === invoice.#lastAddLineCommandId || invoice.#lines.add(event.line).total().isNegative()) throw new Error("corrupt invoice history");
          invoice = invoice.applyLineAdded(event);
          break;
        case "issued":
          if (invoice.#issued || invoice.#lines.isEmpty()) throw new Error("corrupt invoice history");
          invoice = invoice.applyIssued(event);
          break;
      }
    }
    return invoice;
  }

  private static fromOpened(event: InvoiceOpened): Invoice {
    return new Invoice(event, event.sequenceNumber, event.lines, false, undefined);
  }

  private applyLineAdded(event: InvoiceLineAdded): Invoice {
    return new Invoice(this.#opening, event.sequenceNumber, this.#lines.add(event.line), false, event.commandId);
  }

  private applyIssued(event: InvoiceIssued): Invoice {
    return new Invoice(this.#opening, event.sequenceNumber, this.#lines, true, this.#lastAddLineCommandId);
  }

` + invoice.slice(to);
  invoice = change(invoice, '    const invoice: Invoice = new Invoice(this.#id, this.#customer, lines, false, commandId);\n    const event: InvoiceLineAdded = { invoiceId: this.#id, commandId, line };', '    const event: InvoiceLineAdded = { kind: "line-added", invoiceId: this.#id, sequenceNumber: this.#sequenceNumber + 1, commandId, line };\n    const invoice = this.applyLineAdded(event);');
  invoice = change(invoice, '    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, this.#lastAddLineCommandId);\n    const event: InvoiceIssued = { invoiceId: this.#id };', '    const event: InvoiceIssued = { kind: "issued", invoiceId: this.#id, sequenceNumber: this.#sequenceNumber + 1 };\n    const invoice = this.applyIssued(event);');
  files[parentModuleFile(layout)] = invoice;
  files['packages/command/billing-domain/src/index.ts'] += `export type { InvoiceOpened, InvoiceEvent } from "${layout === 'named-file' ? './invoice.ts' : './invoice/index.ts'}";\n`;
  files['packages/command/billing-use-case/src/invoice-repository.ts'] = `import type { Invoice, InvoiceEvent } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type RepositoryError = { readonly message: string };

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError>;
  store(event: InvoiceEvent, snapshot: Invoice): Result<void, RepositoryError>;
}
`;
  let useCase = files['packages/command/billing-use-case/src/issue-invoice.ts']!;
  useCase = change(useCase, 'store(invoiceId, outcome.invoice)', 'store(outcome.event, outcome.invoice)');
  files['packages/command/billing-use-case/src/issue-invoice.ts'] = useCase;
  files['packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts'] = `import { Invoice } from "@acme/billing-domain";
import type { InvoiceEvent } from "@acme/billing-domain";
import type { InvoiceRepository, RepositoryError } from "@acme/billing-use-case";
import type { Result } from "@acme/language-extensions";

export class InMemoryInvoiceRepository implements InvoiceRepository {
  readonly #events: Map<string, readonly InvoiceEvent[]> = new Map();
  readonly #snapshots: Map<string, Invoice> = new Map();
  readonly #snapshotInterval: number;

  constructor(snapshotInterval: number) {
    if (!Number.isSafeInteger(snapshotInterval) || snapshotInterval < 1) throw new RangeError("the snapshot interval must be a positive integer");
    this.#snapshotInterval = snapshotInterval;
  }

  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError> {
    const snapshot = this.#snapshots.get(invoiceId);
    if (snapshot === undefined) return { ok: true, value: undefined };
    const events = (this.#events.get(invoiceId) ?? []).filter((event) => event.sequenceNumber > snapshot.sequenceNumber());
    try {
      return { ok: true, value: Invoice.replay(events, snapshot) };
    } catch {
      return { ok: false, error: { message: "corrupt invoice history" } };
    }
  }

  store(event: InvoiceEvent, snapshot: Invoice): Result<void, RepositoryError> {
    if (event.invoiceId !== snapshot.id() || event.sequenceNumber !== snapshot.sequenceNumber()) return { ok: false, error: { message: "the snapshot is not the state after the event" } };
    const previous = this.#events.get(event.invoiceId) ?? [];
    if (event.sequenceNumber !== (previous[previous.length - 1]?.sequenceNumber ?? 0) + 1) return { ok: false, error: { message: "the event does not follow the stored history" } };
    this.#events.set(event.invoiceId, [...previous, event]);
    if (event.sequenceNumber === 1 || event.sequenceNumber % this.#snapshotInterval === 0) this.#snapshots.set(event.invoiceId, snapshot);
    return { ok: true, value: undefined };
  }
}
`;
  models(files, false, yaml);
  return { ...sample, name: `event-typescript-${layout}`, files };
}

export function eventRustSample(layout: RustLayout = "file", yaml: ModelYaml = Bun.YAML) {
  const sample = rustSample(layout);
  const files = { ...sample.files };
  let invoice = RUST_INVOICE.replaceAll('CorruptInvoiceState', 'CorruptInvoiceHistory');
  const marker = '#[derive(Debug, Clone, PartialEq, Eq)]\npub struct InvoiceLineAdded';
  invoice = change(invoice, marker, `#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceOpened {
    invoice_id: String,
    sequence_number: u64,
    customer: CustomerId,
    lines: InvoiceLines,
}

impl InvoiceOpened {
    fn new(invoice_id: &str, customer: CustomerId, lines: InvoiceLines) -> Self {
        Self { invoice_id: invoice_id.to_string(), sequence_number: 1, customer, lines }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvoiceEvent {
    Opened(InvoiceOpened),
    LineAdded(InvoiceLineAdded),
    Issued(InvoiceIssued),
}

impl InvoiceEvent {
    pub fn invoice_id(&self) -> &str {
        match self {
            Self::Opened(event) => &event.invoice_id,
            Self::LineAdded(event) => &event.invoice_id,
            Self::Issued(event) => &event.invoice_id,
        }
    }

    pub fn sequence_number(&self) -> u64 {
        match self {
            Self::Opened(event) => event.sequence_number,
            Self::LineAdded(event) => event.sequence_number,
            Self::Issued(event) => event.sequence_number,
        }
    }
}

${marker}`);
  invoice = change(invoice, 'pub struct InvoiceLineAdded {\n    invoice_id: String,\n', 'pub struct InvoiceLineAdded {\n    invoice_id: String,\n    sequence_number: u64,\n');
  invoice = change(invoice, '    fn new(invoice_id: &str, command_id: &str, line: InvoiceLine) -> Self {\n        InvoiceLineAdded { invoice_id: invoice_id.to_string(), command_id', '    fn new(invoice_id: &str, sequence_number: u64, command_id: &str, line: InvoiceLine) -> Self {\n        InvoiceLineAdded { invoice_id: invoice_id.to_string(), sequence_number, command_id');
  invoice = change(invoice, 'pub struct InvoiceIssued {\n    invoice_id: String,\n', 'pub struct InvoiceIssued {\n    invoice_id: String,\n    sequence_number: u64,\n');
  invoice = change(invoice, '    fn new(invoice_id: &str) -> Self {\n        InvoiceIssued { invoice_id: invoice_id.to_string() }', '    fn new(invoice_id: &str, sequence_number: u64) -> Self {\n        InvoiceIssued { invoice_id: invoice_id.to_string(), sequence_number }');
  invoice = change(invoice, 'pub struct Invoice {\n    id: String,\n', 'pub struct Invoice {\n    opening: InvoiceOpened,\n    id: String,\n    sequence_number: u64,\n');
  const constructorStart = invoice.indexOf('    fn new(' , invoice.indexOf('impl Invoice {')), constructorEnd = invoice.indexOf('    pub fn open(', constructorStart);
  invoice = invoice.slice(0, constructorStart) + `    fn new(opening: InvoiceOpened, sequence_number: u64, lines: InvoiceLines, issued: bool, last_add_line_command_id: Option<String>) -> Self {
        Self { id: opening.invoice_id.clone(), customer: opening.customer.clone(), opening, sequence_number, lines, issued, last_add_line_command_id }
    }

` + invoice.slice(constructorEnd);
  invoice = change(invoice, '        Ok(Self::new(id.to_string(), customer, lines, false, None))', '        let event = InvoiceOpened::new(id, customer, lines);\n        Ok(Self::from_opened(&event))');
  const from = invoice.indexOf('    pub fn restore('), to = invoice.indexOf('    pub fn add_line(', from);
  invoice = invoice.slice(0, from) + `    pub fn opened_event(&self) -> InvoiceOpened {
        self.opening.clone()
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn sequence_number(&self) -> u64 {
        self.sequence_number
    }

    pub fn replay(events: &[InvoiceEvent], snapshot: Invoice) -> Result<Self, CorruptInvoiceHistory> {
        let mut invoice = snapshot;
        for event in events {
            if event.invoice_id() != invoice.id || event.sequence_number() != invoice.sequence_number + 1 { return Err(CorruptInvoiceHistory); }
            match event {
                InvoiceEvent::Opened(_) => return Err(CorruptInvoiceHistory),
                InvoiceEvent::LineAdded(event) => {
                    let mut total = invoice.lines.total();
                    event.line.with_amount(|amount| total.add(amount));
                    if invoice.issued || invoice.last_add_line_command_id.as_deref() == Some(&event.command_id) || total.is_negative() { return Err(CorruptInvoiceHistory); }
                    invoice.apply_line_added(event);
                }
                InvoiceEvent::Issued(event) => {
                    if invoice.issued || invoice.lines.is_empty() { return Err(CorruptInvoiceHistory); }
                    invoice.apply_issued(event);
                }
            }
        }
        Ok(invoice)
    }

    fn from_opened(event: &InvoiceOpened) -> Self {
        Self::new(event.clone(), event.sequence_number, event.lines.clone(), false, None)
    }

    fn apply_line_added(&mut self, event: &InvoiceLineAdded) {
        self.sequence_number = event.sequence_number;
        self.lines.add(event.line.clone());
        self.last_add_line_command_id = Some(event.command_id.clone());
    }

    fn apply_issued(&mut self, event: &InvoiceIssued) {
        self.sequence_number = event.sequence_number;
        self.issued = true;
    }

` + invoice.slice(to);
  invoice = change(invoice, '        self.lines.add(line.clone());\n        self.last_add_line_command_id = Some(command_id.to_string());\n        Ok(AddInvoiceLineOutcome::Applied(InvoiceLineAdded::new(&self.id, command_id, line)))', '        let event = InvoiceLineAdded::new(&self.id, self.sequence_number + 1, command_id, line);\n        self.apply_line_added(&event);\n        Ok(AddInvoiceLineOutcome::Applied(event))');
  invoice = change(invoice, '        self.issued = true;\n        Ok(InvoiceIssued::new(&self.id))', '        let event = InvoiceIssued::new(&self.id, self.sequence_number + 1);\n        self.apply_issued(&event);\n        Ok(event)');
  files[rustParentModuleFile(layout)] = invoice;
  files['packages/command/billing-use-case/src/invoice_repository.rs'] = `use billing_domain::invoice::{Invoice, InvoiceEvent};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryError { pub message: String }

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError>;
    fn store(&mut self, event: InvoiceEvent, snapshot: Invoice) -> Result<(), RepositoryError>;
}
`;
  files['packages/command/billing-use-case/src/issue_invoice.rs'] = change(change(files['packages/command/billing-use-case/src/issue_invoice.rs']!, '{InvoiceIssued, IssueInvoiceError}', '{InvoiceEvent, InvoiceIssued, IssueInvoiceError}'), 'store(invoice_id, invoice)', 'store(InvoiceEvent::Issued(issued.clone()), invoice)');
  files['packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs'] = `use std::collections::HashMap;
use billing_domain::invoice::{Invoice, InvoiceEvent};
use billing_use_case::invoice_repository::{InvoiceRepository, RepositoryError};

pub struct InMemoryInvoiceRepository {
    events: HashMap<String, Vec<InvoiceEvent>>,
    snapshots: HashMap<String, Invoice>,
    snapshot_interval: u64,
}

impl InMemoryInvoiceRepository {
    pub fn new(snapshot_interval: u64) -> Self {
        assert!(snapshot_interval > 0, "the snapshot interval must be positive");
        Self { events: HashMap::new(), snapshots: HashMap::new(), snapshot_interval }
    }
}

impl InvoiceRepository for InMemoryInvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError> {
        let Some(snapshot) = self.snapshots.get(invoice_id) else { return Ok(None); };
        let events: Vec<InvoiceEvent> = self.events.get(invoice_id).into_iter().flatten().filter(|event| event.sequence_number() > snapshot.sequence_number()).cloned().collect();
        Invoice::replay(&events, snapshot.clone()).map(Some).map_err(|_| RepositoryError { message: "corrupt invoice history".to_string() })
    }

    fn store(&mut self, event: InvoiceEvent, snapshot: Invoice) -> Result<(), RepositoryError> {
        if event.invoice_id() != snapshot.id() || event.sequence_number() != snapshot.sequence_number() {
            return Err(RepositoryError { message: "the snapshot is not the state after the event".to_string() });
        }
        let last = self.events.get(event.invoice_id()).and_then(|stream| stream.last()).map_or(0, InvoiceEvent::sequence_number);
        if event.sequence_number() != last + 1 {
            return Err(RepositoryError { message: "the event does not follow the stored history".to_string() });
        }
        let sequence_number = event.sequence_number();
        self.events.entry(event.invoice_id().to_string()).or_default().push(event);
        if sequence_number == 1 || sequence_number % self.snapshot_interval == 0 {
            self.snapshots.insert(snapshot.id().to_string(), snapshot);
        }
        Ok(())
    }
}
`;
  models(files, true, yaml);
  return { ...sample, name: `event-rust-${layout}`, files };
}

function models(files: Record<string, string>, rust: boolean, yaml: ModelYaml) {
  const model: any = yaml.parse(files['docs/ddd/domain-model.yaml']!);
  const agg = model.bounded_contexts[0].aggregates[0];
  agg.events.unshift({ element_id: 'event.invoice.opened', name: 'Opened', aggregate:'aggregate.invoice',produced_by:'factory.invoice.open' });
  files['docs/ddd/domain-model.yaml'] = yaml.stringify(model);
  const mapping: any = yaml.parse(files['docs/ddd/aggregate-mapping.yaml']!);
  const mapped = mapping.aggregate_mappings[0];
  mapped.persistence_method = 'event-sourcing';
  mapped.replay_methods = ['opened','line-added','issued'].map((name) => ({event_ref:`event.invoice.${name}`,code:{method:name === 'opened' ? (rust ? 'from_opened' : 'fromOpened') : rust ? `apply_${name.replaceAll('-','_')}` : `apply${name.split('-').map(part=>part[0]!.toUpperCase()+part.slice(1)).join('')}`}}));
  files['docs/ddd/aggregate-mapping.yaml'] = yaml.stringify(mapping);
  files['docs/ddd/layer-structure.yaml'] = files['docs/ddd/layer-structure.yaml']!.replace('via: stored-instance','via: event-replay').replace('store_semantics: upsert','store_semantics: append-only');
}
