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

export const CLASS_LINE = `export class Money {
  readonly #value: number;

  private constructor(value: number) {
    this.#value = value;
  }

  static of(value: number): Money {
    return new Money(value);
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: Money): Money {
    return new Money(this.#value + other.#value);
  }

  isNegative(): boolean {
    return this.#value < 0;
  }
}

export class InvoiceLine {
  readonly #amount: Money;

  private constructor(amount: Money) {
    this.#amount = amount;
  }

  static of(amount: Money): InvoiceLine {
    return new InvoiceLine(amount);
  }

  addTo(total: Money): Money {
    return total.add(this.#amount);
  }
}
`;

const COMPANION_LINE = `const moneyBrand: unique symbol = Symbol("Money");

export type Money = {
  readonly [moneyBrand]: true;
  add(other: Money): Money;
  plus(value: number): Money;
  isNegative(): boolean;
};

export const Money = {
  of(value: number): Money {
    const state = { value };
    const instance: Money = {
      [moneyBrand]: true,
      add(other: Money): Money {
        return other.plus(state.value);
      },
      plus(value: number): Money {
        return Money.of(state.value + value);
      },
      isNegative(): boolean {
        return state.value < 0;
      },
    };
    return instance;
  },
  zero(): Money {
    return Money.of(0);
  },
};

const lineBrand: unique symbol = Symbol("InvoiceLine");

export type InvoiceLine = {
  readonly [lineBrand]: true;
  addTo(total: Money): Money;
};

export const InvoiceLine = {
  of(amount: Money): InvoiceLine {
    const state = { amount };
    const instance: InvoiceLine = {
      [lineBrand]: true,
      addTo(total: Money): Money {
        return total.add(state.amount);
      },
    };
    return instance;
  },
};
`;

export const CLASS_CUSTOMER_ID = `import type { Result } from "${RESULT_NAME}";

export type ParseCustomerIdError = "invalid-format";

export class CustomerId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static parse(value: string): Result<CustomerId, ParseCustomerIdError> {
    if (!/^C[0-9]{6}$/.test(value)) return { ok: false, error: "invalid-format" };
    return { ok: true, value: new CustomerId(value) };
  }

  equals(other: CustomerId): boolean {
    return other.#value === this.#value;
  }
}
`;

export const COMPANION_CUSTOMER_ID = `import type { Result } from "${RESULT_NAME}";

export type ParseCustomerIdError = "invalid-format";

const brand: unique symbol = Symbol("CustomerId");

export type CustomerId = {
  readonly [brand]: true;
  equals(other: CustomerId): boolean;
  matches(value: string): boolean;
};

export const CustomerId = {
  parse(value: string): Result<CustomerId, ParseCustomerIdError> {
    if (!/^C[0-9]{6}$/.test(value)) return { ok: false, error: "invalid-format" };
    const state = { value };
    const instance: CustomerId = {
      [brand]: true,
      equals(other: CustomerId): boolean {
        return other.matches(state.value);
      },
      matches(candidate: string): boolean {
        return state.value === candidate;
      },
    };
    return { ok: true, value: instance };
  },
};
`;

export const CLASS_LINES = `import { Money } from "./line.ts";
import type { InvoiceLine } from "./line.ts";

export class InvoiceLines {
  readonly #items: readonly InvoiceLine[];

  private constructor(items: readonly InvoiceLine[]) {
    this.#items = [...items];
  }

  static of(items: readonly InvoiceLine[]): InvoiceLines {
    return new InvoiceLines(items);
  }

  add(line: InvoiceLine): InvoiceLines {
    return new InvoiceLines([...this.#items, line]);
  }

  total(): Money {
    return this.#items.reduce((sum: Money, line: InvoiceLine) => line.addTo(sum), Money.zero());
  }

  isEmpty(): boolean {
    return this.#items.length === 0;
  }

  toArray(): readonly InvoiceLine[] {
    return [...this.#items];
  }
}
`;

const COMPANION_LINES = `import { Money } from "./line.ts";
import type { InvoiceLine } from "./line.ts";

const brand: unique symbol = Symbol("InvoiceLines");

export type InvoiceLines = {
  readonly [brand]: true;
  add(line: InvoiceLine): InvoiceLines;
  total(): Money;
  isEmpty(): boolean;
  toArray(): readonly InvoiceLine[];
};

export const InvoiceLines = {
  of(items: readonly InvoiceLine[]): InvoiceLines {
    const kept: readonly InvoiceLine[] = [...items];
    const instance: InvoiceLines = {
      [brand]: true,
      add(line: InvoiceLine): InvoiceLines {
        return InvoiceLines.of([...kept, line]);
      },
      total(): Money {
        return kept.reduce((sum: Money, line: InvoiceLine) => line.addTo(sum), Money.zero());
      },
      isEmpty(): boolean {
        return kept.length === 0;
      },
      toArray(): readonly InvoiceLine[] {
        return [...kept];
      },
    };
    return instance;
  },
};
`;

function header(specifiers: Specifiers): string {
  return `import type { Result } from "${RESULT_NAME}";
import type { CustomerId } from "${specifiers.customer}";
import type { InvoiceLine, Money } from "${specifiers.line}";
import type { InvoiceLines } from "${specifiers.lines}";

export type OpenInvoiceError = "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

export type InvoiceLineAdded = { readonly invoiceId: string; readonly commandId: string; readonly line: InvoiceLine };
export type InvoiceIssued = { readonly invoiceId: string };

export type AddInvoiceLineOutcome =
  | { readonly kind: "applied"; readonly invoice: Invoice; readonly event: InvoiceLineAdded }
  | { readonly kind: "duplicate"; readonly invoice: Invoice };
export type IssueInvoiceOutcome = { readonly invoice: Invoice; readonly event: InvoiceIssued };
`;
}

/** Where the parent module `invoice` names its neighbors, under a module layout. */
export interface Specifiers {
  readonly customer: string;
  readonly line: string;
  readonly lines: string;
}

export function specifiersFor(layout: Layout): Specifiers {
  const named = layout === "named-file";
  return {
    customer: named ? "./customer-id.ts" : "../customer-id.ts",
    line: named ? "./invoice/line.ts" : "./line.ts",
    lines: named ? "./invoice/lines.ts" : "./lines.ts",
  };
}

export function classInvoice(specifiers: Specifiers): string {
  return `${header(specifiers)}
export class Invoice {
  readonly #id: string;
  readonly #customer: CustomerId;
  readonly #lines: InvoiceLines;
  readonly #issued: boolean;
  readonly #lastAddLineCommandId: string | undefined;

  private constructor(
    id: string,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: boolean,
    lastAddLineCommandId: string | undefined,
  ) {
    this.#id = id;
    this.#customer = customer;
    this.#lines = lines;
    this.#issued = issued;
    this.#lastAddLineCommandId = lastAddLineCommandId;
  }

  static open(id: string, customer: CustomerId, lines: InvoiceLines): Result<Invoice, OpenInvoiceError> {
    if (lines.total().isNegative()) return { ok: false, error: "negative-total" };
    return { ok: true, value: new Invoice(id, customer, lines, false, undefined) };
  }

  static restore(
    id: string,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: boolean,
    lastAddLineCommandId: string | undefined,
  ): Invoice {
    if ((issued && lines.isEmpty()) || lines.total().isNegative()) throw new Error("corrupt invoice state");
    return new Invoice(id, customer, lines, issued, lastAddLineCommandId);
  }

  addLine(commandId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
    if (commandId === this.#lastAddLineCommandId) return { ok: true, value: { kind: "duplicate", invoice: this } };
    if (this.#issued) return { ok: false, error: "already-issued" };
    const lines: InvoiceLines = this.#lines.add(line);
    if (lines.total().isNegative()) return { ok: false, error: "negative-total" };
    const invoice: Invoice = new Invoice(this.#id, this.#customer, lines, false, commandId);
    const event: InvoiceLineAdded = { invoiceId: this.#id, commandId, line };
    return { ok: true, value: { kind: "applied", invoice, event } };
  }

  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (this.#lines.isEmpty()) return { ok: false, error: "empty-lines" };
    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, this.#lastAddLineCommandId);
    const event: InvoiceIssued = { invoiceId: this.#id };
    return { ok: true, value: { invoice, event } };
  }

  isBilledTo(customer: CustomerId): boolean {
    return this.#customer.equals(customer);
  }

  total(): Money {
    return this.#lines.total();
  }

  lines(): readonly InvoiceLine[] {
    return this.#lines.toArray();
  }
}
`;
}

export function companionInvoice(specifiers: Specifiers): string {
  return `${header(specifiers)}
const brand: unique symbol = Symbol("Invoice");

export type Invoice = {
  readonly [brand]: true;
  addLine(commandId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError>;
  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError>;
  isBilledTo(customer: CustomerId): boolean;
  total(): Money;
  lines(): readonly InvoiceLine[];
};

export const Invoice = {
  open(id: string, customer: CustomerId, lines: InvoiceLines): Result<Invoice, OpenInvoiceError> {
    if (lines.total().isNegative()) return { ok: false, error: "negative-total" };
    return { ok: true, value: Invoice.restore(id, customer, lines, false, undefined) };
  },
  restore(
    id: string,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: boolean,
    lastAddLineCommandId: string | undefined,
  ): Invoice {
    if ((issued && lines.isEmpty()) || lines.total().isNegative()) throw new Error("corrupt invoice state");
    const state = { id, customer, lines, issued, lastAddLineCommandId };
    const instance: Invoice = {
      [brand]: true,
      addLine(commandId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if (commandId === state.lastAddLineCommandId) return { ok: true, value: { kind: "duplicate", invoice: instance } };
        if (state.issued) return { ok: false, error: "already-issued" };
        const next: InvoiceLines = state.lines.add(line);
        if (next.total().isNegative()) return { ok: false, error: "negative-total" };
        const invoice: Invoice = Invoice.restore(state.id, state.customer, next, false, commandId);
        const event: InvoiceLineAdded = { invoiceId: state.id, commandId, line };
        return { ok: true, value: { kind: "applied", invoice, event } };
      },
      issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
        if (state.issued) return { ok: false, error: "already-issued" };
        if (state.lines.isEmpty()) return { ok: false, error: "empty-lines" };
        const invoice: Invoice = Invoice.restore(state.id, state.customer, state.lines, true, state.lastAddLineCommandId);
        const event: InvoiceIssued = { invoiceId: state.id };
        return { ok: true, value: { invoice, event } };
      },
      isBilledTo(customer: CustomerId): boolean {
        return state.customer.equals(customer);
      },
      total(): Money {
        return state.lines.total();
      },
      lines(): readonly InvoiceLine[] {
        return state.lines.toArray();
      },
    };
    return instance;
  },
};
`;
}

export function domainIndex(parentSpecifier: string): string {
  return `export type { ParseCustomerIdError } from "./customer-id.ts";
export { CustomerId } from "./customer-id.ts";
export type {
  AddInvoiceLineError,
  AddInvoiceLineOutcome,
  InvoiceIssued,
  InvoiceLineAdded,
  IssueInvoiceError,
  IssueInvoiceOutcome,
  OpenInvoiceError,
} from "${parentSpecifier}";
export { Invoice } from "${parentSpecifier}";
export { InvoiceLine, Money } from "./invoice/line.ts";
export { InvoiceLines } from "./invoice/lines.ts";
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

export class IssueInvoiceUseCase {
  readonly #invoiceRepository: InvoiceRepository;

  constructor(invoiceRepository: InvoiceRepository) {
    this.#invoiceRepository = invoiceRepository;
  }

  execute(invoiceId: string): Result<InvoiceIssued, IssueInvoiceFailure> {
    const found: Result<Invoice, InvoiceNotFound> = this.#invoiceRepository.findById(invoiceId);
    if (!found.ok) return found;
    const invoice: Invoice = found.value;
    const issued: Result<IssueInvoiceOutcome, IssueInvoiceError> = invoice.issue();
    if (!issued.ok) return issued;
    const outcome: IssueInvoiceOutcome = issued.value;
    this.#invoiceRepository.store(invoiceId, outcome.invoice);
    return { ok: true, value: outcome.event };
  }
}
`;

const USE_CASE_INDEX = `export type { InvoiceNotFound, InvoiceRepository } from "./invoice-repository.ts";
export type { IssueInvoiceFailure } from "./issue-invoice.ts";
export { IssueInvoiceUseCase } from "./issue-invoice.ts";
`;

export const IN_MEMORY_INVOICE_REPOSITORY = `import { CustomerId, Invoice, InvoiceLine, InvoiceLines, Money } from "${DOMAIN_NAME}";
import type { ParseCustomerIdError } from "${DOMAIN_NAME}";
import type { InvoiceNotFound, InvoiceRepository } from "${USE_CASE_NAME}";
import type { Result } from "${RESULT_NAME}";

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

  findById(invoiceId: string): Result<Invoice, InvoiceNotFound> {
    const stored: Invoice | undefined = this.#stored.get(invoiceId);
    if (stored !== undefined) return { ok: true, value: stored };
    const record: InvoiceRecord | undefined = this.#records.get(invoiceId);
    if (record === undefined) return { ok: false, error: "invoice-not-found" };
    const customer: Result<CustomerId, ParseCustomerIdError> = CustomerId.parse(record.customer);
    if (!customer.ok) throw new Error("corrupt invoice record");
    const lines: InvoiceLines = InvoiceLines.of(record.amounts.map((amount: number) => InvoiceLine.of(Money.of(amount))));
    const invoice: Invoice = Invoice.restore(invoiceId, customer.value, lines, record.issued, record.lastAddLineCommandId);
    return { ok: true, value: invoice };
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
          - { element_id: primitive.customer-id, kind: domain-primitive, name: CustomerId, aggregate: aggregate.invoice, attributes: [{ name: value, type: string, required: true }] }
          - { element_id: primitive.money, kind: domain-primitive, name: Money, aggregate: aggregate.invoice, unconstrained: "individual line amounts may be positive, zero, or negative", attributes: [{ name: value, type: decimal, required: true }] }
        invariants:
          - { element_id: invariant.invoice.customer-id-format, name: CustomerIdFormat, aggregate: aggregate.invoice, element: primitive.customer-id, statement: a customer ID is C followed by six digits }
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
            idempotency: { strategy: command-id-memory, retention: last-one, rationale: "a client sends the next add-line of an invoice only after the previous one is acknowledged, so an older add-line is never resent after a newer one" }
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
              - { element_id: error.invoice.open.negative-total, name: NegativeTotal, operation: factory.invoice.open, condition: the lines add up to a negative total }
          - element_id: factory.invoice.parse-customer-id
            name: ParseCustomerId
            target_element: primitive.customer-id
            preconditions: [invariant.invoice.customer-id-format]
            domain_errors:
              - { element_id: error.invoice.parse-customer-id.invalid-format, name: InvalidFormat, operation: factory.invoice.parse-customer-id, condition: the value is not C followed by six digits }
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
  "          - { error_ref: error.invoice.open.negative-total, code: { case: negative-total } }",
  "      - operation_ref: factory.invoice.parse-customer-id",
  "        code: { method: parse, error_type: ParseCustomerIdError }",
  "        errors:",
  "          - { error_ref: error.invoice.parse-customer-id.invalid-format, code: { case: invalid-format } }",
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
  `  - { term: Invoice line, model_refs: [vo.invoice-line, primitive.money], rationale: the amounts an invoice adds up, code: ${location(["invoice", "line"])} }`,
  `  - { term: Invoice lines, model_refs: [vo.invoice-line], rationale: the lines of one invoice and their total, code: ${location(["invoice", "lines"])} }`,
  `  - { term: Customer ID, model_refs: [primitive.customer-id], rationale: identifies the customer an invoice bills, code: ${location(["customer-id"])} }`,
  "",
].join("\n");

function identity(name: string): string {
  return `{ language: typescript, package: "${name}" }`;
}

/**
 * The layer declaration: the context's three packages, their direct dependencies, the port and the
 * restoration path. The language-extensions package belongs to no context and stands on no CQRS
 * side, so it has no `packages` row and appears only as a `depends_on` target.
 */
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
  `      - { code: ${identity(DOMAIN_NAME)}, depends_on: [${identity(RESULT_NAME)}] }`,
  `      - { code: ${identity(USE_CASE_NAME)}, depends_on: [${identity(DOMAIN_NAME)}, ${identity(RESULT_NAME)}] }`,
  `      - { code: ${identity(INTERFACE_ADAPTER_NAME)}, depends_on: [${identity(DOMAIN_NAME)}, ${identity(USE_CASE_NAME)}, ${identity(RESULT_NAME)}] }`,
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
      representation === "class" ? classInvoice(specifiersFor(layout)) : companionInvoice(specifiersFor(layout)),
    [`${DOMAIN_DIR}/src/invoice/lines.ts`]: representation === "class" ? CLASS_LINES : COMPANION_LINES,
    [`${DOMAIN_DIR}/src/customer-id.ts`]: representation === "class" ? CLASS_CUSTOMER_ID : COMPANION_CUSTOMER_ID,
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
