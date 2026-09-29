# DDD TypeScript Knowledge

## Code Representations

The project settings choose one representation for every aggregate, Entity, Domain Primitive, and value object. Both hide state at run time and build through one full constructor; they differ in how the type is written.

| Condition | Meaning / options |
|-----------|-------------------|
| The team prefers classes and runtime-private `#` fields | `class`: a private constructor takes the whole state; static factories go through it |
| The team prefers plain types and functions | `companion`: a `type` literal plus a `const` object of the same name; the factory's closure holds the state |
| Aggregate execution model or persistence differs between aggregates | Irrelevant to this choice; the representation is project-wide |

In the examples below the customer is the Domain Primitive `CustomerId`, and the lines and the applied request IDs are the first-class collections `InvoiceLines` and `AddLineRequests`. The invoice ID and the amounts stay bare `string` and `number` only to keep the examples short; real code wraps them the same way.

`private`, `protected`, and `readonly` are erased at run time; a `#` field and a closure are private at run time. A brand stops an object of the same shape from being assigned; it does not prove that a factory built the value.

### Class representation

`open` validates and builds through the private constructor and returns `Result`. `restore` rebuilds a persisted invoice after validating the whole state and throws on a corrupt one, which is not a business failure. The commands `addLine` (`command.invoice.add-line`) and `issue` never change the invoice they are called on: each builds the changed state into a new invoice through the private constructor and returns it together with the one event it produced, as the named outcome type the mapping gives in `success_type` (`AddInvoiceLineOutcome`, `IssueInvoiceOutcome`). `addLine` remembers the request IDs it applied and recognizes a resent one before any other check: it returns `kind: "duplicate"` with the unchanged invoice and no event, so the event is never published twice. Events (`InvoiceLineAdded`, `InvoiceIssued`) are read-only data types declared in the aggregate's module. Every `#` field is `readonly`. `total()` asks the line collection for the total, and `lines()` returns a copy of the lines.

```ts
import type { Result } from "@acme/language-extensions";
import type { CustomerId } from "./customer-id.ts";
import { AddLineRequests } from "./invoice/add-line-requests.ts";
import type { InvoiceLine } from "./invoice/line.ts";
import type { InvoiceLines } from "./invoice/lines.ts";

export type OpenInvoiceError = "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

export type InvoiceLineAdded = { readonly invoiceId: string; readonly requestId: string; readonly line: InvoiceLine };
export type InvoiceIssued = { readonly invoiceId: string };

export type AddInvoiceLineOutcome =
  | { readonly kind: "applied"; readonly invoice: Invoice; readonly event: InvoiceLineAdded }
  | { readonly kind: "duplicate"; readonly invoice: Invoice };
export type IssueInvoiceOutcome = { readonly invoice: Invoice; readonly event: InvoiceIssued };

export class Invoice {
  readonly #id: string;
  readonly #customer: CustomerId;
  readonly #lines: InvoiceLines;
  readonly #issued: boolean;
  readonly #addLineRequests: AddLineRequests;

  private constructor(
    id: string,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: boolean,
    addLineRequests: AddLineRequests,
  ) {
    this.#id = id;
    this.#customer = customer;
    this.#lines = lines;
    this.#issued = issued;
    this.#addLineRequests = addLineRequests;
  }

  static open(id: string, customer: CustomerId, lines: InvoiceLines): Result<Invoice, OpenInvoiceError> {
    if (lines.total() < 0) return { ok: false, error: "negative-total" };
    return { ok: true, value: new Invoice(id, customer, lines, false, AddLineRequests.of([])) };
  }

  static restore(
    id: string,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: boolean,
    addLineRequests: AddLineRequests,
  ): Invoice {
    if ((issued && lines.isEmpty()) || lines.total() < 0) throw new Error("corrupt invoice state");
    return new Invoice(id, customer, lines, issued, addLineRequests);
  }

  addLine(requestId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
    if (this.#addLineRequests.has(requestId)) return { ok: true, value: { kind: "duplicate", invoice: this } };
    if (this.#issued) return { ok: false, error: "already-issued" };
    const lines: InvoiceLines = this.#lines.add(line);
    if (lines.total() < 0) return { ok: false, error: "negative-total" };
    const invoice: Invoice = new Invoice(this.#id, this.#customer, lines, false, this.#addLineRequests.add(requestId));
    const event: InvoiceLineAdded = { invoiceId: this.#id, requestId, line };
    return { ok: true, value: { kind: "applied", invoice, event } };
  }

  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (this.#lines.isEmpty()) return { ok: false, error: "empty-lines" };
    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, this.#addLineRequests);
    const event: InvoiceIssued = { invoiceId: this.#id };
    return { ok: true, value: { invoice, event } };
  }

  isBilledTo(customer: CustomerId): boolean {
    return this.#customer.equals(customer);
  }

  total(): number {
    return this.#lines.total();
  }

  lines(): readonly InvoiceLine[] {
    return this.#lines.toArray();
  }
}
```

### Companion representation

The factory that takes the whole state (`restore`) is the full constructor: it validates, copies its input into the closure state, and writes the instance as a literal annotated with the type. `open` and the commands build through it, so a command returns a new instance and the closure state is never written. The readonly type is stated on the collection's own variable, and the state object is left unannotated.

```ts
import type { Result } from "@acme/language-extensions";
import type { CustomerId } from "./customer-id.ts";
import { AddLineRequests } from "./invoice/add-line-requests.ts";
import type { InvoiceLine } from "./invoice/line.ts";
import type { InvoiceLines } from "./invoice/lines.ts";

export type OpenInvoiceError = "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

export type InvoiceLineAdded = { readonly invoiceId: string; readonly requestId: string; readonly line: InvoiceLine };
export type InvoiceIssued = { readonly invoiceId: string };

export type AddInvoiceLineOutcome =
  | { readonly kind: "applied"; readonly invoice: Invoice; readonly event: InvoiceLineAdded }
  | { readonly kind: "duplicate"; readonly invoice: Invoice };
export type IssueInvoiceOutcome = { readonly invoice: Invoice; readonly event: InvoiceIssued };

const brand: unique symbol = Symbol("Invoice");

export type Invoice = {
  readonly [brand]: true;
  addLine(requestId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError>;
  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError>;
  isBilledTo(customer: CustomerId): boolean;
  total(): number;
  lines(): readonly InvoiceLine[];
};

export const Invoice = {
  open(id: string, customer: CustomerId, lines: InvoiceLines): Result<Invoice, OpenInvoiceError> {
    if (lines.total() < 0) return { ok: false, error: "negative-total" };
    return { ok: true, value: Invoice.restore(id, customer, lines, false, AddLineRequests.of([])) };
  },
  restore(
    id: string,
    customer: CustomerId,
    lines: InvoiceLines,
    issued: boolean,
    addLineRequests: AddLineRequests,
  ): Invoice {
    if ((issued && lines.isEmpty()) || lines.total() < 0) throw new Error("corrupt invoice state");
    const state = { id, customer, lines, issued, requests: addLineRequests };
    const instance: Invoice = {
      [brand]: true,
      addLine(requestId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if (state.requests.has(requestId)) return { ok: true, value: { kind: "duplicate", invoice: instance } };
        if (state.issued) return { ok: false, error: "already-issued" };
        const next: InvoiceLines = state.lines.add(line);
        if (next.total() < 0) return { ok: false, error: "negative-total" };
        const invoice: Invoice = Invoice.restore(state.id, state.customer, next, false, state.requests.add(requestId));
        const event: InvoiceLineAdded = { invoiceId: state.id, requestId, line };
        return { ok: true, value: { kind: "applied", invoice, event } };
      },
      issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
        if (state.issued) return { ok: false, error: "already-issued" };
        if (state.lines.isEmpty()) return { ok: false, error: "empty-lines" };
        const invoice: Invoice = Invoice.restore(state.id, state.customer, state.lines, true, state.requests);
        const event: InvoiceIssued = { invoiceId: state.id };
        return { ok: true, value: { invoice, event } };
      },
      isBilledTo(customer: CustomerId): boolean {
        return state.customer.equals(customer);
      },
      total(): number {
        return state.lines.total();
      },
      lines(): readonly InvoiceLine[] {
        return state.lines.toArray();
      },
    };
    return instance;
  },
};
```

## Domain Primitives

A Domain Primitive wraps one value and states its value rule. The model declares the rule as an invariant on the primitive and a factory rule that builds it; the factory (`parse`) checks the rule and returns a `Result` with its own error type, so a `CustomerId` that exists is always valid. Equality follows the value (`equals`). The companion representation writes the same shape as a `type`, a brand, and a `const` object, and its `equals` asks the other value to match.

```ts
import type { Result } from "@acme/language-extensions";

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
```

A primitive without a rule declares `unconstrained` with a rationale in the model and is built by an `of` that checks nothing.

## First-Class Collections

A domain type that holds a collection beside other state wraps it in a first-class collection: a type whose whole state is the collection, which owns the operations and decisions on it. `InvoiceLines` returns a new instance with a line added and totals the lines; the aggregate never touches the array.

```ts
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

  total(): number {
    return this.#items.reduce((sum: number, line: InvoiceLine) => line.addTo(sum), 0);
  }

  isEmpty(): boolean {
    return this.#items.length === 0;
  }

  toArray(): readonly InvoiceLine[] {
    return [...this.#items];
  }
}
```

`AddLineRequests` wraps the applied request IDs the same way: `has` answers whether a request was applied, and `add` returns a new instance that remembers one and forgets the oldest beyond the model's `retention_count`. In the companion representation, each is a `type` and a `const` object with its own brand.

## Result and Operation Errors

`Result` lives in the infrastructure language-extensions package (for example `packages/infrastructure/language-extensions`, published through its `exports` entry). Domain packages list it in `dependencies` and import it by package name with `import type`.

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Each mapped factory and command states its own error type: the union of the string literals of its mapped cases, named by `error_type` and exported from the aggregate's module. `IssueInvoiceError` holds `"already-issued"` and `"empty-lines"` and nothing of `open` or `addLine`. A command's success type is its outcome type, named by `success_type` and exported beside its error type; a mapped factory's success type is the aggregate. A factory bound to no operation, such as `restore` or a value object's `of`, returns the value itself.

## Ownership

Copy an array or object a factory or command receives (`[...lines]`), and return a copy or a readonly value instead of the one held in state. A `#` field or a closure still changes when a caller keeps a reference to the same mutable value. Return a business failure before building the new instance.

## Module Layouts and Specifiers

Inside a package, a module is named by a relative specifier with its `.ts` extension. The module `invoice` with the child `invoice/line` is placed as follows; its other children (`invoice/lines`, `invoice/add-line-requests`) are placed like `invoice/line`.

| Layout | Parent module | Child | Entry names the parent as |
|--------|---------------|-------|---------------------------|
| `named-file` | `src/invoice.ts` naming `./invoice/line.ts` | `src/invoice/line.ts` | `./invoice.ts` |
| `index-file` | `src/invoice/index.ts` naming `./line.ts` | `src/invoice/line.ts` | `./invoice/index.ts` |

The package entry `src/index.ts` publishes each name explicitly. Under `named-file`:

```ts
export type { ParseCustomerIdError } from "./customer-id.ts";
export { CustomerId } from "./customer-id.ts";
export type {
  AddInvoiceLineError,
  AddInvoiceLineOutcome,
  InvoiceIssued,
  InvoiceLineAdded,
  IssueInvoiceError,
  IssueInvoiceOutcome,
  OpenInvoiceError,
} from "./invoice.ts";
export { Invoice } from "./invoice.ts";
export { AddLineRequests } from "./invoice/add-line-requests.ts";
export { InvoiceLine } from "./invoice/line.ts";
export { InvoiceLines } from "./invoice/lines.ts";
```

Under `index-file`:

```ts
export type { ParseCustomerIdError } from "./customer-id.ts";
export { CustomerId } from "./customer-id.ts";
export type {
  AddInvoiceLineError,
  AddInvoiceLineOutcome,
  InvoiceIssued,
  InvoiceLineAdded,
  IssueInvoiceError,
  IssueInvoiceOutcome,
  OpenInvoiceError,
} from "./invoice/index.ts";
export { Invoice } from "./invoice/index.ts";
export { AddLineRequests } from "./invoice/add-line-requests.ts";
export { InvoiceLine } from "./invoice/line.ts";
export { InvoiceLines } from "./invoice/lines.ts";
```

Module paths map to the `module` segments of the aggregate mapping: `src/index.ts` is `[]`, `src/invoice.ts` and `src/invoice/index.ts` are `[invoice]`, `src/invoice/line.ts` is `[invoice, line]`, and `src/invoice/lines.ts` is `[invoice, lines]`.

## Use Case and Interface Adapter

The repository port is an `interface` named `<Aggregate>Repository`, declared in the use-case package and never in a domain package. Its lookup returns its own error type.

```ts
import type { Invoice } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type InvoiceNotFound = "invoice-not-found";

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice, InvoiceNotFound>;
  store(invoiceId: string, invoice: Invoice): void;
}
```

`execute` takes an ID and never an aggregate. The use case holds the port in a `#` field, states one named type on every receiver, asks the aggregate to run the command, stores the instance the command returned, and returns the event for the caller to publish after persistence.

```ts
import type { Invoice, InvoiceIssued, IssueInvoiceError, IssueInvoiceOutcome } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";
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
```

The adapter implements the port, may prefix its name with the storage medium, and restores the aggregate through `restore`, the customer through `parse`, and the collections through `of`.

```ts
import { AddLineRequests, CustomerId, Invoice, InvoiceLine, InvoiceLines } from "@acme/billing-domain";
import type { ParseCustomerIdError } from "@acme/billing-domain";
import type { InvoiceNotFound, InvoiceRepository } from "@acme/billing-use-case";
import type { Result } from "@acme/language-extensions";

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
    const customer: Result<CustomerId, ParseCustomerIdError> = CustomerId.parse(record.customer);
    if (!customer.ok) throw new Error("corrupt invoice record");
    const lines: InvoiceLines = InvoiceLines.of(record.amounts.map((amount: number) => InvoiceLine.of(amount)));
    const requests: AddLineRequests = AddLineRequests.of(record.addLineRequests);
    const invoice: Invoice = Invoice.restore(invoiceId, customer.value, lines, record.issued, requests);
    return { ok: true, value: invoice };
  }

  store(invoiceId: string, invoice: Invoice): void {
    this.#stored.set(invoiceId, invoice);
  }
}
```

## Workspace Placement

```text
tsconfig.json                  # references every package
packages/
  infrastructure/language-extensions/   # Result
  command/billing-domain/
  command/billing-use-case/
  command/billing-interface-adapter/
  query/billing-query-use-case/
  query/billing-query-interface-adapter/
  composition-root/billing-api/
```

Each package has a `package.json` with `exports`, keeps sources under `src/`, and keeps tests, declaration files, and `.tsx` / `.mts` / `.cts` sources outside `src`. The referenced `tsconfig.json` files agree on `module: esnext`, `moduleResolution: bundler`, `strict: true`, and a target from es2017 to esnext, and none sets `baseUrl`.
