// Rejected historical implementations: regression fixtures, never used as repository fallbacks.
export const serializedMemoryExamples = {
  typescript: `import { CustomerId, Invoice, InvoiceLine, InvoiceLines, Money } from "@acme/billing-domain";
import type { ParseCustomerIdError } from "@acme/billing-domain";
import type { InvoiceRepository, RepositoryError } from "@acme/billing-use-case";
import type { Result } from "@acme/language-extensions";

export type InvoiceRecord = {
  readonly customer: string;
  readonly amounts: readonly number[];
  readonly issued: boolean;
  readonly lastAddLineCommandId: string | undefined;
};

export class InMemoryInvoiceRepository implements InvoiceRepository {
  readonly #records: ReadonlyMap<string, InvoiceRecord>;
  readonly #stored: Map<string, Invoice>;

  constructor(records: ReadonlyMap<string, InvoiceRecord>) {
    this.#records = records;
    this.#stored = new Map();
  }

  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError> {
    const stored: Invoice | undefined = this.#stored.get(invoiceId);
    if (stored !== undefined) return { ok: true, value: stored };
    const record: InvoiceRecord | undefined = this.#records.get(invoiceId);
    if (record === undefined) return { ok: true, value: undefined };
    const customer: Result<CustomerId, ParseCustomerIdError> = CustomerId.parse(record.customer);
    if (!customer.ok) throw new Error("corrupt invoice record");
    const lines: InvoiceLines = InvoiceLines.of(record.amounts.map((amount: number) => InvoiceLine.of(Money.of(amount))));
    const invoice: Invoice = Invoice.restore(invoiceId, customer.value, lines, record.issued, record.lastAddLineCommandId);
    return { ok: true, value: invoice };
  }

  store(invoiceId: string, invoice: Invoice): Result<void, RepositoryError> {
    this.#stored.set(invoiceId, invoice);
    return { ok: true, value: undefined };
  }
}
`,
  rust: `use std::collections::HashMap;

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
`
};
