/**
 * The TypeScript projects the DDD knowledge teaches, one per code representation (`class`,
 * `companion`) and module layout (`named-file`, `index-file`), with the model files ddd-lint reads.
 *
 * Each project has four packages: the language-extensions package that declares `Result`, a
 * command-side domain package with the `invoice` aggregate and its child module `invoice/line`, a
 * use-case package with the repository port and the use case that issues an invoice, and an
 * interface-adapter package that implements the port. The TypeScript examples of the knowledge
 * facet `ddd-typescript` are copies of the `class` / `named-file` sources and the `companion`
 * invoice.
 */

export type Representation = "class" | "companion";
export type Layout = "named-file" | "index-file";

export const REPRESENTATIONS: readonly Representation[] = ["class", "companion"];
export const LAYOUTS: readonly Layout[] = ["named-file", "index-file"];

const RESULT_DIR = "packages/infrastructure/language-extensions";
const RESULT_NAME = "@acme/language-extensions";
export const DOMAIN_DIR = "packages/command/billing-domain";
const DOMAIN_NAME = "@acme/billing-domain";
const USE_CASE_DIR = "packages/command/billing-use-case";
const USE_CASE_NAME = "@acme/billing-use-case";
const INTERFACE_ADAPTER_DIR = "packages/command/billing-interface-adapter";
const INTERFACE_ADAPTER_NAME = "@acme/billing-interface-adapter";

/** The project-relative file of the `invoice` parent module under `layout`. */
export function parentModuleFile(layout: Layout): string {
  return layout === "named-file" ? `${DOMAIN_DIR}/src/invoice.ts` : `${DOMAIN_DIR}/src/invoice/index.ts`;
}

export const RESULT_SOURCE = `export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
`;

const RESULT_INDEX = `export type { Result } from "./result.ts";
`;

export const CLASS_LINE = `export class InvoiceLine {
  readonly #amount: number;

  private constructor(amount: number) {
    this.#amount = amount;
  }

  static of(amount: number): InvoiceLine {
    return new InvoiceLine(amount);
  }

  addTo(total: number): number {
    return total + this.#amount;
  }
}
`;

const COMPANION_LINE = `const brand: unique symbol = Symbol("InvoiceLine");

export type InvoiceLine = {
  readonly [brand]: true;
  addTo(total: number): number;
};

export const InvoiceLine = {
  of(amount: number): InvoiceLine {
    const state = { amount };
    const instance: InvoiceLine = {
      [brand]: true,
      addTo(total: number): number {
        return total + state.amount;
      },
    };
    return instance;
  },
};
`;

function header(lineSpecifier: string): string {
  return `import type { Result } from "${RESULT_NAME}";
import type { InvoiceLine } from "${lineSpecifier}";

export type OpenInvoiceError = "missing-customer" | "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

export type InvoiceLineAdded = { readonly invoiceId: string; readonly requestId: string; readonly line: InvoiceLine };
export type InvoiceIssued = { readonly invoiceId: string };

export type AddInvoiceLineOutcome =
  | { readonly kind: "applied"; readonly invoice: Invoice; readonly event: InvoiceLineAdded }
  | { readonly kind: "duplicate"; readonly invoice: Invoice };
export type IssueInvoiceOutcome = { readonly invoice: Invoice; readonly event: InvoiceIssued };

function sumOf(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum: number, line: InvoiceLine) => line.addTo(sum), 0);
}
`;
}

export function classInvoice(lineSpecifier: string): string {
  return `${header(lineSpecifier)}
export class Invoice {
  readonly #id: string;
  readonly #customer: string;
  readonly #lines: readonly InvoiceLine[];
  readonly #issued: boolean;
  readonly #addLineRequests: ReadonlySet<string>;

  private constructor(
    id: string,
    customer: string,
    lines: readonly InvoiceLine[],
    issued: boolean,
    addLineRequests: readonly string[],
  ) {
    this.#id = id;
    this.#customer = customer;
    this.#lines = [...lines];
    this.#issued = issued;
    this.#addLineRequests = new Set(addLineRequests);
  }

  static open(id: string, customer: string, lines: readonly InvoiceLine[]): Result<Invoice, OpenInvoiceError> {
    if (customer.length === 0) return { ok: false, error: "missing-customer" };
    if (sumOf(lines) < 0) return { ok: false, error: "negative-total" };
    return { ok: true, value: new Invoice(id, customer, lines, false, []) };
  }

  static restore(
    id: string,
    customer: string,
    lines: readonly InvoiceLine[],
    issued: boolean,
    addLineRequests: readonly string[],
  ): Invoice {
    if (customer.length === 0 || (issued && lines.length === 0) || sumOf(lines) < 0)
      throw new Error("corrupt invoice state");
    return new Invoice(id, customer, lines, issued, addLineRequests);
  }

  addLine(requestId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
    if (this.#addLineRequests.has(requestId)) return { ok: true, value: { kind: "duplicate", invoice: this } };
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (line.addTo(sumOf(this.#lines)) < 0) return { ok: false, error: "negative-total" };
    const requests: readonly string[] = [...this.#addLineRequests, requestId];
    const invoice: Invoice = new Invoice(this.#id, this.#customer, [...this.#lines, line], false, requests);
    const event: InvoiceLineAdded = { invoiceId: this.#id, requestId, line };
    return { ok: true, value: { kind: "applied", invoice, event } };
  }

  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (this.#lines.length === 0) return { ok: false, error: "empty-lines" };
    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, [...this.#addLineRequests]);
    const event: InvoiceIssued = { invoiceId: this.#id };
    return { ok: true, value: { invoice, event } };
  }

  isBilledTo(customer: string): boolean {
    return this.#customer === customer;
  }

  total(): number {
    return sumOf(this.#lines);
  }

  lines(): readonly InvoiceLine[] {
    return [...this.#lines];
  }
}
`;
}

export function companionInvoice(lineSpecifier: string): string {
  return `${header(lineSpecifier)}
const brand: unique symbol = Symbol("Invoice");

export type Invoice = {
  readonly [brand]: true;
  addLine(requestId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError>;
  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError>;
  isBilledTo(customer: string): boolean;
  total(): number;
  lines(): readonly InvoiceLine[];
};

export const Invoice = {
  open(id: string, customer: string, lines: readonly InvoiceLine[]): Result<Invoice, OpenInvoiceError> {
    if (customer.length === 0) return { ok: false, error: "missing-customer" };
    if (sumOf(lines) < 0) return { ok: false, error: "negative-total" };
    return { ok: true, value: Invoice.restore(id, customer, lines, false, []) };
  },
  restore(
    id: string,
    customer: string,
    lines: readonly InvoiceLine[],
    issued: boolean,
    addLineRequests: readonly string[],
  ): Invoice {
    if (customer.length === 0 || (issued && lines.length === 0) || sumOf(lines) < 0)
      throw new Error("corrupt invoice state");
    const kept: readonly InvoiceLine[] = [...lines];
    const requests: ReadonlySet<string> = new Set(addLineRequests);
    const state = { id, customer, lines: kept, issued, requests };
    const instance: Invoice = {
      [brand]: true,
      addLine(requestId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if (state.requests.has(requestId)) return { ok: true, value: { kind: "duplicate", invoice: instance } };
        if (state.issued) return { ok: false, error: "already-issued" };
        if (line.addTo(sumOf(state.lines)) < 0) return { ok: false, error: "negative-total" };
        const next: readonly string[] = [...state.requests, requestId];
        const invoice: Invoice = Invoice.restore(state.id, state.customer, [...state.lines, line], false, next);
        const event: InvoiceLineAdded = { invoiceId: state.id, requestId, line };
        return { ok: true, value: { kind: "applied", invoice, event } };
      },
      issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
        if (state.issued) return { ok: false, error: "already-issued" };
        if (state.lines.length === 0) return { ok: false, error: "empty-lines" };
        const invoice: Invoice = Invoice.restore(state.id, state.customer, state.lines, true, [...state.requests]);
        const event: InvoiceIssued = { invoiceId: state.id };
        return { ok: true, value: { invoice, event } };
      },
      isBilledTo(customer: string): boolean {
        return state.customer === customer;
      },
      total(): number {
        return sumOf(state.lines);
      },
      lines(): readonly InvoiceLine[] {
        return [...state.lines];
      },
    };
    return instance;
  },
};
`;
}

export function domainIndex(parentSpecifier: string): string {
  return `export type {
  AddInvoiceLineError,
  AddInvoiceLineOutcome,
  InvoiceIssued,
  InvoiceLineAdded,
  IssueInvoiceError,
  IssueInvoiceOutcome,
  OpenInvoiceError,
} from "${parentSpecifier}";
export { Invoice } from "${parentSpecifier}";
export { InvoiceLine } from "./invoice/line.ts";
`;
}

export const INVOICE_REPOSITORY_PORT = `import type { Invoice } from "${DOMAIN_NAME}";
import type { Result } from "${RESULT_NAME}";

export type InvoiceNotFound = "invoice-not-found";

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice, InvoiceNotFound>;
  store(invoiceId: string, invoice: Invoice): void;
}
`;

export const ISSUE_INVOICE = `import type { Invoice, InvoiceIssued, IssueInvoiceError, IssueInvoiceOutcome } from "${DOMAIN_NAME}";
import type { Result } from "${RESULT_NAME}";
import type { InvoiceNotFound, InvoiceRepository } from "./invoice-repository.ts";

export type IssueInvoiceFailure = InvoiceNotFound | IssueInvoiceError;

export class IssueInvoice {
  readonly #invoices: InvoiceRepository;

  constructor(invoices: InvoiceRepository) {
    this.#invoices = invoices;
  }

  execute(invoiceId: string): Result<InvoiceIssued, IssueInvoiceFailure> {
    const found: Result<Invoice, InvoiceNotFound> = this.#invoices.findById(invoiceId);
    if (!found.ok) return found;
    const invoice: Invoice = found.value;
    const issued: Result<IssueInvoiceOutcome, IssueInvoiceError> = invoice.issue();
    if (!issued.ok) return issued;
    const outcome: IssueInvoiceOutcome = issued.value;
    this.#invoices.store(invoiceId, outcome.invoice);
    return { ok: true, value: outcome.event };
  }
}
`;

const USE_CASE_INDEX = `export type { InvoiceNotFound, InvoiceRepository } from "./invoice-repository.ts";
export type { IssueInvoiceFailure } from "./issue-invoice.ts";
export { IssueInvoice } from "./issue-invoice.ts";
`;

export const IN_MEMORY_INVOICE_REPOSITORY = `import { Invoice, InvoiceLine } from "${DOMAIN_NAME}";
import type { InvoiceNotFound, InvoiceRepository } from "${USE_CASE_NAME}";
import type { Result } from "${RESULT_NAME}";

export type InvoiceRecord = {
  readonly customer: string;
  readonly amounts: readonly number[];
  readonly issued: boolean;
  readonly addLineRequests: readonly string[];
};

export class InMemoryInvoiceRepository implements InvoiceRepository {
  readonly #records: ReadonlyMap<string, InvoiceRecord>;
  readonly #stored: Map<string, Invoice>;

  constructor(records: ReadonlyMap<string, InvoiceRecord>) {
    this.#records = records;
    this.#stored = new Map();
  }

  findById(invoiceId: string): Result<Invoice, InvoiceNotFound> {
    const stored: Invoice | undefined = this.#stored.get(invoiceId);
    if (stored !== undefined) return { ok: true, value: stored };
    const record: InvoiceRecord | undefined = this.#records.get(invoiceId);
    if (record === undefined) return { ok: false, error: "invoice-not-found" };
    const lines: readonly InvoiceLine[] = record.amounts.map((amount: number) => InvoiceLine.of(amount));
    return { ok: true, value: Invoice.restore(invoiceId, record.customer, lines, record.issued, record.addLineRequests) };
  }

  store(invoiceId: string, invoice: Invoice): void {
    this.#stored.set(invoiceId, invoice);
  }
}
`;

const INTERFACE_ADAPTER_INDEX = `export type { InvoiceRecord } from "./in-memory-invoice-repository.ts";
export { InMemoryInvoiceRepository } from "./in-memory-invoice-repository.ts";
`;

/** The domain model: `open` is a factory, `addLine` and `issue` are commands, each with its own errors. */
export const DOMAIN_MODEL = `bounded_contexts:
  - element_id: bc.billing
    name: Billing
    aggregates:
      - element_id: aggregate.invoice
        name: Invoice
        bounded_context: bc.billing
        root_element: entity.invoice
        states: [draft, issued]
        elements:
          - { element_id: entity.invoice, kind: entity, name: Invoice, aggregate: aggregate.invoice }
          - { element_id: vo.invoice-line, kind: value-object, name: InvoiceLine, aggregate: aggregate.invoice }
        invariants:
          - { element_id: invariant.invoice.total-not-negative, name: TotalNotNegative, aggregate: aggregate.invoice, statement: the total of the lines is never negative }
          - { element_id: invariant.invoice.issued-has-lines, name: IssuedHasLines, aggregate: aggregate.invoice, statement: an issued invoice has at least one line }
        commands:
          - element_id: command.invoice.add-line
            name: AddLine
            aggregate: aggregate.invoice
            effect: accumulation
            state_effect: none
            domain_errors:
              - { element_id: error.invoice.add-line.already-issued, name: AlreadyIssued, operation: command.invoice.add-line, condition: the invoice is issued }
              - { element_id: error.invoice.add-line.negative-total, name: NegativeTotal, operation: command.invoice.add-line, condition: the line would make the total negative }
            event: event.invoice.line-added
            idempotency: { strategy: command-id-memory, retention: multiple, retention_count: 1000, rationale: a retried request must not add its line twice }
          - element_id: command.invoice.issue
            name: Issue
            aggregate: aggregate.invoice
            effect: transition
            state_effect: transitions
            transitions: [transition.invoice.issue]
            domain_errors:
              - { element_id: error.invoice.issue.already-issued, name: AlreadyIssued, operation: command.invoice.issue, condition: the invoice is issued }
              - { element_id: error.invoice.issue.empty-lines, name: EmptyLines, operation: command.invoice.issue, condition: the invoice has no line }
            event: event.invoice.issued
            idempotency: { strategy: none }
        events:
          - { element_id: event.invoice.line-added, name: LineAdded, aggregate: aggregate.invoice, produced_by: command.invoice.add-line }
          - { element_id: event.invoice.issued, name: Issued, aggregate: aggregate.invoice, produced_by: command.invoice.issue }
        transitions:
          - { element_id: transition.invoice.issue, name: Issue, aggregate: aggregate.invoice, from_state: draft, to_state: issued, command: command.invoice.issue }
        factory_rules:
          - element_id: factory.invoice.open
            name: Open
            target_element: entity.invoice
            preconditions: [invariant.invoice.total-not-negative]
            domain_errors:
              - { element_id: error.invoice.open.missing-customer, name: MissingCustomer, operation: factory.invoice.open, condition: no customer is given }
              - { element_id: error.invoice.open.negative-total, name: NegativeTotal, operation: factory.invoice.open, condition: the lines add up to a negative total }
lineage: []
`;

function location(module: readonly string[]): string {
  return `{ language: typescript, package: "${DOMAIN_NAME}", module: [${module.join(", ")}] }`;
}

/** The implementation mapping: the aggregate at `[invoice]`, each operation's method and error type. */
export const AGGREGATE_MAPPING = [
  "model_ref: domain-model.yaml",
  "aggregate_mappings:",
  "  - aggregate_ref: aggregate.invoice",
  "    programming_model: class",
  "    persistence_method: state-sourcing",
  "    reference_ids: [entity.invoice]",
  `    code: { language: typescript, package: "${DOMAIN_NAME}", module: [invoice], type: Invoice }`,
  "    operations:",
  "      - operation_ref: factory.invoice.open",
  "        code: { method: open, error_type: OpenInvoiceError }",
  "        errors:",
  "          - { error_ref: error.invoice.open.missing-customer, code: { case: missing-customer } }",
  "          - { error_ref: error.invoice.open.negative-total, code: { case: negative-total } }",
  "      - operation_ref: command.invoice.add-line",
  "        code: { method: addLine, success_type: AddInvoiceLineOutcome, error_type: AddInvoiceLineError }",
  "        errors:",
  "          - { error_ref: error.invoice.add-line.already-issued, code: { case: already-issued } }",
  "          - { error_ref: error.invoice.add-line.negative-total, code: { case: negative-total } }",
  "      - operation_ref: command.invoice.issue",
  "        code: { method: issue, success_type: IssueInvoiceOutcome, error_type: IssueInvoiceError }",
  "        errors:",
  "          - { error_ref: error.invoice.issue.already-issued, code: { case: already-issued } }",
  "          - { error_ref: error.invoice.issue.empty-lines, code: { case: empty-lines } }",
  "domain_packages:",
  `  - { term: Billing, model_refs: [bc.billing], rationale: owns the billing business, code: ${location([])} }`,
  `  - { term: Invoice, model_refs: [aggregate.invoice], rationale: opens and issues invoices, code: ${location(["invoice"])} }`,
  `  - { term: Invoice line, model_refs: [vo.invoice-line], rationale: the amounts an invoice adds up, code: ${location(["invoice", "line"])} }`,
  "",
].join("\n");

function identity(name: string): string {
  return `{ language: typescript, package: "${name}" }`;
}

/** The layer declaration: the four packages, their dependencies, the port and the restoration path. */
export const LAYER_STRUCTURE = [
  "model_ref: domain-model.yaml",
  "layer_structures:",
  "  - context_ref: bc.billing",
  "    cqrs: false",
  "    packages:",
  `      - { role: command, code: ${identity(DOMAIN_NAME)} }`,
  `      - { role: command, code: ${identity(USE_CASE_NAME)} }`,
  `      - { role: command, code: ${identity(INTERFACE_ADAPTER_NAME)} }`,
  "    dependencies:",
  `      - { code: ${identity(DOMAIN_NAME)}, depends_on: [] }`,
  `      - { code: ${identity(USE_CASE_NAME)}, depends_on: [${identity(DOMAIN_NAME)}] }`,
  `      - { code: ${identity(INTERFACE_ADAPTER_NAME)}, depends_on: [${identity(DOMAIN_NAME)}, ${identity(USE_CASE_NAME)}] }`,
  "    ports:",
  "      - { name: InvoiceRepository, kind: repository, verbs: [findById, store] }",
  "    repositories:",
  "      - { name: InvoiceRepository, aggregate_ref: aggregate.invoice, io_unit: single, verbs: [findById, store], store_semantics: upsert }",
  "    restoration_paths:",
  "      - { aggregate_ref: aggregate.invoice, via: full-constructor }",
  "    persistence_backend: in-memory",
  "",
].join("\n");

function settings(representation: Representation, layout: Layout): string {
  return `languages = ["typescript"]\n\n[typescript]\nmodule_layout = "${layout}"\ncode_representation = "${representation}"\n`;
}

function packageManifest(name: string, dependencies?: Readonly<Record<string, string>>): string {
  return `${JSON.stringify(
    { name, version: "0.1.0", type: "module", exports: { ".": "./src/index.ts" }, ...(dependencies ? { dependencies } : {}) },
    null,
    2,
  )}\n`;
}

const PACKAGE_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "es2022",
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      allowImportingTsExtensions: true,
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  },
  null,
  2,
)}\n`;

export interface TypeScriptSample {
  readonly name: string;
  readonly representation: Representation;
  readonly layout: Layout;
  /** Project-root relative path -> content of every file of the project. */
  readonly files: Readonly<Record<string, string>>;
}

export function typeScriptSample(representation: Representation, layout: Layout): TypeScriptSample {
  const named = layout === "named-file";
  const lineSpecifier = named ? "./invoice/line.ts" : "./line.ts";
  const parentSpecifier = named ? "./invoice.ts" : "./invoice/index.ts";
  const packages = [RESULT_DIR, DOMAIN_DIR, USE_CASE_DIR, INTERFACE_ADAPTER_DIR];
  const files: Record<string, string> = {
    ".ddd.toml": settings(representation, layout),
    "docs/ddd/domain-model.yaml": DOMAIN_MODEL,
    "docs/ddd/aggregate-mapping.yaml": AGGREGATE_MAPPING,
    "docs/ddd/layer-structure.yaml": LAYER_STRUCTURE,
    "tsconfig.json": `${JSON.stringify({ files: [], references: packages.map((dir) => ({ path: `./${dir}` })) }, null, 2)}\n`,
    [`${RESULT_DIR}/package.json`]: packageManifest(RESULT_NAME),
    [`${RESULT_DIR}/tsconfig.json`]: PACKAGE_TSCONFIG,
    [`${RESULT_DIR}/src/index.ts`]: RESULT_INDEX,
    [`${RESULT_DIR}/src/result.ts`]: RESULT_SOURCE,
    [`${DOMAIN_DIR}/package.json`]: packageManifest(DOMAIN_NAME, { [RESULT_NAME]: "0.1.0" }),
    [`${DOMAIN_DIR}/tsconfig.json`]: PACKAGE_TSCONFIG,
    [`${DOMAIN_DIR}/src/index.ts`]: domainIndex(parentSpecifier),
    [parentModuleFile(layout)]:
      representation === "class" ? classInvoice(lineSpecifier) : companionInvoice(lineSpecifier),
    [`${DOMAIN_DIR}/src/invoice/line.ts`]: representation === "class" ? CLASS_LINE : COMPANION_LINE,
    [`${USE_CASE_DIR}/package.json`]: packageManifest(USE_CASE_NAME, { [DOMAIN_NAME]: "0.1.0", [RESULT_NAME]: "0.1.0" }),
    [`${USE_CASE_DIR}/tsconfig.json`]: PACKAGE_TSCONFIG,
    [`${USE_CASE_DIR}/src/index.ts`]: USE_CASE_INDEX,
    [`${USE_CASE_DIR}/src/invoice-repository.ts`]: INVOICE_REPOSITORY_PORT,
    [`${USE_CASE_DIR}/src/issue-invoice.ts`]: ISSUE_INVOICE,
    [`${INTERFACE_ADAPTER_DIR}/package.json`]: packageManifest(INTERFACE_ADAPTER_NAME, {
      [DOMAIN_NAME]: "0.1.0",
      [USE_CASE_NAME]: "0.1.0",
      [RESULT_NAME]: "0.1.0",
    }),
    [`${INTERFACE_ADAPTER_DIR}/tsconfig.json`]: PACKAGE_TSCONFIG,
    [`${INTERFACE_ADAPTER_DIR}/src/index.ts`]: INTERFACE_ADAPTER_INDEX,
    [`${INTERFACE_ADAPTER_DIR}/src/in-memory-invoice-repository.ts`]: IN_MEMORY_INVOICE_REPOSITORY,
  };
  return { name: `typescript-${representation}-${layout}`, representation, layout, files };
}

export function typeScriptSamples(): TypeScriptSample[] {
  return REPRESENTATIONS.flatMap((representation) => LAYOUTS.map((layout) => typeScriptSample(representation, layout)));
}
