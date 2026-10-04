/** Executable Event Sourcing knowledge examples. Shared primitives reuse the regression samples. */
import { classInvoice, parentModuleFile, specifiersFor, typeScriptSample, type Layout } from "./typescript.ts";
import { RUST_INVOICE, rustParentModuleFile, rustSample, type RustLayout } from "./rust.ts";

function change(text: string, before: string, after: string): string {
  if (!text.includes(before)) throw new Error(`Missing example text: ${before}`);
  return text.replace(before, after);
}

export function eventTypeScriptSample(layout: Layout = "named-file") {
  const sample = typeScriptSample("class", layout);
  const files = { ...sample.files };
  let invoice = classInvoice(specifiersFor(layout));
  invoice = invoice.replace('export type InvoiceLineAdded = {', 'export type InvoiceOpened = { readonly kind: "opened"; readonly invoiceId: string; readonly customer: CustomerId; readonly lines: InvoiceLines };\nexport type InvoiceEvent = InvoiceOpened | InvoiceLineAdded | InvoiceIssued;\n\nexport type InvoiceLineAdded = { readonly kind: "line-added";').replace('export type InvoiceIssued = {', 'export type InvoiceIssued = { readonly kind: "issued";');
  invoice = invoice.replace('  readonly #id: string;', '  readonly #opening: InvoiceOpened;\n  readonly #id: string;');
  const constructorStart = invoice.indexOf('  private constructor('), constructorEnd = invoice.indexOf('  static open(', constructorStart);
  invoice = invoice.slice(0, constructorStart) + `  private constructor(opening: InvoiceOpened, lines: InvoiceLines, issued: boolean, lastAddLineCommandId: string | undefined) {
    this.#opening = opening;
    this.#id = opening.invoiceId;
    this.#customer = opening.customer;
    this.#lines = lines;
    this.#issued = issued;
    this.#lastAddLineCommandId = lastAddLineCommandId;
  }

` + invoice.slice(constructorEnd);
  invoice = change(invoice, '    return { ok: true, value: new Invoice(id, customer, lines, false, undefined) };', '    const event: InvoiceOpened = { kind: "opened", invoiceId: id, customer, lines };\n    return { ok: true, value: Invoice.fromOpened(event) };');
  const from = invoice.indexOf('  static restore('), to = invoice.indexOf('  addLine(', from);
  invoice = invoice.slice(0, from) + `  openedEvent(): InvoiceOpened {
    return this.#opening;
  }

  static restore(id: string, events: readonly InvoiceEvent[]): Invoice {
    const first = events[0];
    if (!first || first.kind !== "opened" || first.invoiceId !== id || first.lines.total().isNegative()) throw new Error("corrupt invoice history");
    let invoice = Invoice.fromOpened(first);
    for (const event of events.slice(1)) {
      if (event.invoiceId !== id) throw new Error("corrupt invoice history");
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
    return new Invoice(event, event.lines, false, undefined);
  }

  private applyLineAdded(event: InvoiceLineAdded): Invoice {
    return new Invoice(this.#opening, this.#lines.add(event.line), false, event.commandId);
  }

  private applyIssued(_event: InvoiceIssued): Invoice {
    return new Invoice(this.#opening, this.#lines, true, this.#lastAddLineCommandId);
  }

` + invoice.slice(to);
  invoice = change(invoice, '    const invoice: Invoice = new Invoice(this.#id, this.#customer, lines, false, commandId);\n    const event: InvoiceLineAdded = { invoiceId: this.#id, commandId, line };', '    const event: InvoiceLineAdded = { kind: "line-added", invoiceId: this.#id, commandId, line };\n    const invoice = this.applyLineAdded(event);');
  invoice = change(invoice, '    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, this.#lastAddLineCommandId);\n    const event: InvoiceIssued = { invoiceId: this.#id };', '    const event: InvoiceIssued = { kind: "issued", invoiceId: this.#id };\n    const invoice = this.applyIssued(event);');
  files[parentModuleFile(layout)] = invoice;
  files['packages/command/billing-domain/src/index.ts'] += `export type { InvoiceOpened, InvoiceEvent } from "${layout === 'named-file' ? './invoice.ts' : './invoice/index.ts'}";\n`;
  files['packages/command/billing-use-case/src/invoice-repository.ts'] = `import type { Invoice, InvoiceEvent } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type RepositoryError = { readonly message: string };

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError>;
  store(invoiceId: string, event: InvoiceEvent): Result<void, RepositoryError>;
}
`;
  let useCase = files['packages/command/billing-use-case/src/issue-invoice.ts']!;
  useCase = useCase.replace('store(invoiceId, outcome.invoice)', 'store(invoiceId, outcome.event)');
  files['packages/command/billing-use-case/src/issue-invoice.ts'] = useCase;
  files['packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts'] = `import { Invoice } from "@acme/billing-domain";
import type { InvoiceEvent } from "@acme/billing-domain";
import type { InvoiceRepository, RepositoryError } from "@acme/billing-use-case";
import type { Result } from "@acme/language-extensions";

export class InMemoryInvoiceRepository implements InvoiceRepository {
  readonly #events: Map<string, readonly InvoiceEvent[]> = new Map();

  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError> {
    const events = this.#events.get(invoiceId);
    if (events === undefined) return { ok: true, value: undefined };
    try {
      return { ok: true, value: Invoice.restore(invoiceId, events) };
    } catch {
      return { ok: false, error: { message: "corrupt invoice history" } };
    }
  }

  store(invoiceId: string, event: InvoiceEvent): Result<void, RepositoryError> {
    if (event.invoiceId !== invoiceId) return { ok: false, error: { message: "event belongs to another invoice" } };
    const previous = this.#events.get(invoiceId) ?? [];
    this.#events.set(invoiceId, [...previous, event]);
    return { ok: true, value: undefined };
  }
}
`;
  models(files, false);
  return { ...sample, name: `event-typescript-${layout}`, files };
}

export function eventRustSample(layout: RustLayout = "file") {
  const sample = rustSample(layout);
  const files = { ...sample.files };
  let invoice = RUST_INVOICE.replaceAll('CorruptInvoiceState', 'CorruptInvoiceHistory');
  const marker = '#[derive(Debug, Clone, PartialEq, Eq)]\npub struct InvoiceLineAdded';
  invoice = change(invoice, marker, `#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceOpened {
    invoice_id: String,
    customer: CustomerId,
    lines: InvoiceLines,
}

impl InvoiceOpened {
    fn new(invoice_id: &str, customer: CustomerId, lines: InvoiceLines) -> Self {
        Self { invoice_id: invoice_id.to_string(), customer, lines }
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
}

${marker}`);
  invoice = invoice.replace('pub struct Invoice {\n', 'pub struct Invoice {\n    opening: InvoiceOpened,\n');
  const constructorStart = invoice.indexOf('    fn new(' , invoice.indexOf('impl Invoice {')), constructorEnd = invoice.indexOf('    pub fn open(', constructorStart);
  invoice = invoice.slice(0, constructorStart) + `    fn new(opening: InvoiceOpened, lines: InvoiceLines, issued: bool, last_add_line_command_id: Option<String>) -> Self {
        Self { id: opening.invoice_id.clone(), customer: opening.customer.clone(), opening, lines, issued, last_add_line_command_id }
    }

` + invoice.slice(constructorEnd);
  invoice = change(invoice, '        Ok(Self::new(id.to_string(), customer, lines, false, None))', '        let event = InvoiceOpened::new(id, customer, lines);\n        Ok(Self::from_opened(&event))');
  const from = invoice.indexOf('    pub fn restore('), to = invoice.indexOf('    pub fn add_line(', from);
  invoice = invoice.slice(0, from) + `    pub fn opened_event(&self) -> InvoiceOpened {
        self.opening.clone()
    }

    pub fn restore(id: &str, events: &[InvoiceEvent]) -> Result<Self, CorruptInvoiceHistory> {
        let Some(InvoiceEvent::Opened(first)) = events.first() else { return Err(CorruptInvoiceHistory); };
        if first.invoice_id != id || first.lines.total().is_negative() { return Err(CorruptInvoiceHistory); }
        let mut invoice = Self::from_opened(first);
        for event in events.iter().skip(1) {
            if event.invoice_id() != id { return Err(CorruptInvoiceHistory); }
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
        Self::new(event.clone(), event.lines.clone(), false, None)
    }

    fn apply_line_added(&mut self, event: &InvoiceLineAdded) {
        self.lines.add(event.line.clone());
        self.last_add_line_command_id = Some(event.command_id.clone());
    }

    fn apply_issued(&mut self, _event: &InvoiceIssued) {
        self.issued = true;
    }

` + invoice.slice(to);
  invoice = change(invoice, '        self.lines.add(line.clone());\n        self.last_add_line_command_id = Some(command_id.to_string());\n        Ok(AddInvoiceLineOutcome::Applied(InvoiceLineAdded::new(&self.id, command_id, line)))', '        let event = InvoiceLineAdded::new(&self.id, command_id, line);\n        self.apply_line_added(&event);\n        Ok(AddInvoiceLineOutcome::Applied(event))');
  invoice = change(invoice, '        self.issued = true;\n        Ok(InvoiceIssued::new(&self.id))', '        let event = InvoiceIssued::new(&self.id);\n        self.apply_issued(&event);\n        Ok(event)');
  files[rustParentModuleFile(layout)] = invoice;
  files['packages/command/billing-use-case/src/invoice_repository.rs'] = `use billing_domain::invoice::{Invoice, InvoiceEvent};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryError { pub message: String }

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError>;
    fn store(&mut self, invoice_id: &str, event: InvoiceEvent) -> Result<(), RepositoryError>;
}
`;
  files['packages/command/billing-use-case/src/issue_invoice.rs'] = files['packages/command/billing-use-case/src/issue_invoice.rs']!.replace('{InvoiceIssued, IssueInvoiceError}', '{InvoiceEvent, InvoiceIssued, IssueInvoiceError}').replace('store(invoice_id, invoice)', 'store(invoice_id, InvoiceEvent::Issued(issued.clone()))');
  files['packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs'] = `use std::collections::HashMap;
use billing_domain::invoice::{Invoice, InvoiceEvent};
use billing_use_case::invoice_repository::{InvoiceRepository, RepositoryError};

pub struct InMemoryInvoiceRepository {
    events: HashMap<String, Vec<InvoiceEvent>>,
}

impl InMemoryInvoiceRepository {
    pub fn new() -> Self { Self { events: HashMap::new() } }
}

impl InvoiceRepository for InMemoryInvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError> {
        let Some(events) = self.events.get(invoice_id) else { return Ok(None); };
        Invoice::restore(invoice_id, events).map(Some).map_err(|_| RepositoryError { message: "corrupt invoice history".to_string() })
    }

    fn store(&mut self, invoice_id: &str, event: InvoiceEvent) -> Result<(), RepositoryError> {
        if event.invoice_id() != invoice_id { return Err(RepositoryError { message: "event belongs to another invoice".to_string() }); }
        self.events.entry(invoice_id.to_string()).or_default().push(event);
        Ok(())
    }
}
`;
  models(files, true);
  return { ...sample, name: `event-rust-${layout}`, files };
}

function models(files: Record<string, string>, rust: boolean) {
  const model: any = Bun.YAML.parse(files['docs/ddd/domain-model.yaml']!);
  const agg = model.bounded_contexts[0].aggregates[0];
  agg.events.unshift({ element_id: 'event.invoice.opened', name: 'Opened', aggregate:'aggregate.invoice',produced_by:'factory.invoice.open' });
  files['docs/ddd/domain-model.yaml'] = Bun.YAML.stringify(model);
  const mapping: any = Bun.YAML.parse(files['docs/ddd/aggregate-mapping.yaml']!);
  const mapped = mapping.aggregate_mappings[0];
  mapped.persistence_method = 'event-sourcing';
  mapped.replay_methods = ['opened','line-added','issued'].map((name) => ({event_ref:`event.invoice.${name}`,code:{method:name === 'opened' ? (rust ? 'from_opened' : 'fromOpened') : rust ? `apply_${name.replaceAll('-','_')}` : `apply${name.split('-').map(part=>part[0]!.toUpperCase()+part.slice(1)).join('')}`}}));
  files['docs/ddd/aggregate-mapping.yaml'] = Bun.YAML.stringify(mapping);
  files['docs/ddd/layer-structure.yaml'] = files['docs/ddd/layer-structure.yaml']!.replace('via: stored-instance','via: event-replay').replace('store_semantics: upsert','store_semantics: append-only');
}
