# DDD TypeScript Knowledge

## Code Representations

The project settings choose one representation for every aggregate, Entity, Domain Primitive, and value object. Both hide state at run time and build through one full constructor; they differ in how the type is written.

| Condition | Meaning / options |
|-----------|-------------------|
| The team prefers classes and runtime-private `#` fields | `class`: a private constructor takes the whole state; static factories go through it |
| The team prefers plain types and functions | `companion`: a `type` literal plus a `const` object of the same name; the factory's closure holds the state |
| Aggregate execution model or persistence differs between aggregates | Irrelevant to this choice; the representation is project-wide |

`private`, `protected`, and `readonly` are erased at run time; a `#` field and a closure are private at run time. A brand stops an object of the same shape from being assigned; it does not prove that a factory built the value.

### Class representation

`open` validates and builds through the private constructor and returns `Result`. `restore` rebuilds a persisted invoice after validating the whole state and throws on a corrupt one, which is not a business failure. `addLine` is the command `command.invoice.add-line` and replaces the readonly array. `lines()` returns a copy, and `total()` asks each line to add itself.

```ts
import type { Result } from "@acme/language-extensions";
import type { InvoiceLine } from "./invoice/line.ts";

export type OpenInvoiceError = "missing-customer" | "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

function sumOf(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum: number, line: InvoiceLine) => line.addTo(sum), 0);
}

export class Invoice {
  #customer: string;
  #lines: readonly InvoiceLine[];
  #issued: boolean;

  private constructor(customer: string, lines: readonly InvoiceLine[], issued: boolean) {
    this.#customer = customer;
    this.#lines = [...lines];
    this.#issued = issued;
  }

  static open(customer: string, lines: readonly InvoiceLine[]): Result<Invoice, OpenInvoiceError> {
    if (customer.length === 0) return { ok: false, error: "missing-customer" };
    if (sumOf(lines) < 0) return { ok: false, error: "negative-total" };
    return { ok: true, value: new Invoice(customer, lines, false) };
  }

  static restore(customer: string, lines: readonly InvoiceLine[], issued: boolean): Invoice {
    if (customer.length === 0 || (issued && lines.length === 0) || sumOf(lines) < 0)
      throw new Error("corrupt invoice state");
    return new Invoice(customer, lines, issued);
  }

  addLine(line: InvoiceLine): Result<void, AddInvoiceLineError> {
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (line.addTo(sumOf(this.#lines)) < 0) return { ok: false, error: "negative-total" };
    this.#lines = [...this.#lines, line];
    return { ok: true, value: undefined };
  }

  issue(): Result<void, IssueInvoiceError> {
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (this.#lines.length === 0) return { ok: false, error: "empty-lines" };
    this.#issued = true;
    return { ok: true, value: undefined };
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
```

### Companion representation

The factory that takes the whole state (`restore`) is the full constructor: it validates, copies its input into the closure state, and writes the instance as a literal annotated with the type. `open` builds through it. The readonly type is stated on the collection's own variable, and the state object is left unannotated.

```ts
import type { Result } from "@acme/language-extensions";
import type { InvoiceLine } from "./invoice/line.ts";

export type OpenInvoiceError = "missing-customer" | "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

function sumOf(lines: readonly InvoiceLine[]): number {
  return lines.reduce((sum: number, line: InvoiceLine) => line.addTo(sum), 0);
}

const brand: unique symbol = Symbol("Invoice");

export type Invoice = {
  readonly [brand]: true;
  addLine(line: InvoiceLine): Result<void, AddInvoiceLineError>;
  issue(): Result<void, IssueInvoiceError>;
  isBilledTo(customer: string): boolean;
  total(): number;
  lines(): readonly InvoiceLine[];
};

export const Invoice = {
  open(customer: string, lines: readonly InvoiceLine[]): Result<Invoice, OpenInvoiceError> {
    if (customer.length === 0) return { ok: false, error: "missing-customer" };
    if (sumOf(lines) < 0) return { ok: false, error: "negative-total" };
    return { ok: true, value: Invoice.restore(customer, lines, false) };
  },
  restore(customer: string, lines: readonly InvoiceLine[], issued: boolean): Invoice {
    if (customer.length === 0 || (issued && lines.length === 0) || sumOf(lines) < 0)
      throw new Error("corrupt invoice state");
    const kept: readonly InvoiceLine[] = [...lines];
    const state = { customer, lines: kept, issued };
    const instance: Invoice = {
      [brand]: true,
      addLine(line: InvoiceLine): Result<void, AddInvoiceLineError> {
        if (state.issued) return { ok: false, error: "already-issued" };
        if (line.addTo(sumOf(state.lines)) < 0) return { ok: false, error: "negative-total" };
        state.lines = [...state.lines, line];
        return { ok: true, value: undefined };
      },
      issue(): Result<void, IssueInvoiceError> {
        if (state.issued) return { ok: false, error: "already-issued" };
        if (state.lines.length === 0) return { ok: false, error: "empty-lines" };
        state.issued = true;
        return { ok: true, value: undefined };
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
```

## Result and Operation Errors

`Result` lives in the infrastructure language-extensions package (for example `packages/infrastructure/language-extensions`, published through its `exports` entry). Domain packages list it in `dependencies` and import it by package name with `import type`.

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

Each mapped factory and command states its own error type: the union of the string literals of its mapped cases, named by `error_type` and exported from the aggregate's module. `IssueInvoiceError` holds `"already-issued"` and `"empty-lines"` and nothing of `open` or `addLine`. A factory bound to no operation, such as `restore` or a value object's `of`, returns the value itself.

## Ownership

Copy an array or object a factory or command receives (`[...lines]`), and return a copy or a readonly value instead of the one held in state. A `#` field or a closure still changes when a caller keeps a reference to the same mutable value. Return a business failure before changing any state.

## Module Layouts and Specifiers

Inside a package, a module is named by a relative specifier with its `.ts` extension. The module `invoice` with the child `invoice/line` is placed as follows.

| Layout | Parent module | Child | Entry names the parent as |
|--------|---------------|-------|---------------------------|
| `named-file` | `src/invoice.ts` naming `./invoice/line.ts` | `src/invoice/line.ts` | `./invoice.ts` |
| `index-file` | `src/invoice/index.ts` naming `./line.ts` | `src/invoice/line.ts` | `./invoice/index.ts` |

The package entry `src/index.ts` publishes each name explicitly. Under `named-file`:

```ts
export type { AddInvoiceLineError, IssueInvoiceError, OpenInvoiceError } from "./invoice.ts";
export { Invoice } from "./invoice.ts";
export { InvoiceLine } from "./invoice/line.ts";
```

Under `index-file`:

```ts
export type { AddInvoiceLineError, IssueInvoiceError, OpenInvoiceError } from "./invoice/index.ts";
export { Invoice } from "./invoice/index.ts";
export { InvoiceLine } from "./invoice/line.ts";
```

Module paths map to the `module` segments of the aggregate mapping: `src/index.ts` is `[]`, `src/invoice.ts` and `src/invoice/index.ts` are `[invoice]`, and `src/invoice/line.ts` is `[invoice, line]`.

## Use Case and Interface Adapter

The repository port is an `interface` named `<Aggregate>Repository`, declared in the use-case package (or a domain package). Its lookup returns its own error type.

```ts
import type { Invoice } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type InvoiceNotFound = "invoice-not-found";

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice, InvoiceNotFound>;
  store(invoiceId: string, invoice: Invoice): void;
}
```

`execute` takes an ID and never an aggregate. The use case holds the port in a `#` field, states one named type on every receiver, and asks the aggregate to run the command.

```ts
import type { Invoice, IssueInvoiceError } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";
import type { InvoiceNotFound, InvoiceRepository } from "./invoice-repository.ts";

export type IssueInvoiceFailure = InvoiceNotFound | IssueInvoiceError;

export class IssueInvoice {
  readonly #invoices: InvoiceRepository;

  constructor(invoices: InvoiceRepository) {
    this.#invoices = invoices;
  }

  execute(invoiceId: string): Result<void, IssueInvoiceFailure> {
    const found: Result<Invoice, InvoiceNotFound> = this.#invoices.findById(invoiceId);
    if (!found.ok) return found;
    const invoice: Invoice = found.value;
    const issued: Result<void, IssueInvoiceError> = invoice.issue();
    if (!issued.ok) return issued;
    this.#invoices.store(invoiceId, invoice);
    return { ok: true, value: undefined };
  }
}
```

The adapter implements the port, may prefix its name with the storage medium, and restores the aggregate through `restore` and each line through `of`.

```ts
import { Invoice, InvoiceLine } from "@acme/billing-domain";
import type { InvoiceNotFound, InvoiceRepository } from "@acme/billing-use-case";
import type { Result } from "@acme/language-extensions";

export type InvoiceRecord = {
  readonly customer: string;
  readonly amounts: readonly number[];
  readonly issued: boolean;
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
    return { ok: true, value: Invoice.restore(record.customer, lines, record.issued) };
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
