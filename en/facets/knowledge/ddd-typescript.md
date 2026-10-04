# DDD TypeScript Knowledge

## Code Representations

The primary path is the single private class constructor or the single companion instance factory. Auxiliary construction delegates after validation. For a DP companion, parse both validates input and assembles the state closure as its primary path.

Follow "Choosing Factory Names" in the modeling knowledge. A `from` converts another type and returns a Result with an operation-owned error when fallible. Instance `valueOf()` is a JavaScript conversion hook, separate from static-factory naming checks.

The project settings choose one representation for every aggregate, Entity, Domain Primitive, and value object. Both hide state at run time and build through one full constructor; they differ in how the type is written.

| Condition | Meaning / options |
|-----------|-------------------|
| The team prefers classes and runtime-private `#` fields | `class`: a private constructor takes the whole state; static factories go through it |
| The team prefers plain types and functions | `companion`: a `type` literal plus a `const` object of the same name; the factory's closure holds the state |
| Aggregate execution model or persistence differs between aggregates | Irrelevant to this choice; the representation is project-wide |

In the examples below the customer is the Domain Primitive `CustomerId`, the line amounts are the Domain Primitive `Money`, and the lines are the first-class collection `InvoiceLines`. The invoice ID and the command ID stay bare `string` only to keep the examples short; when they have domain format or range rules, wrap them as DPs and place them under the invoice's module as types that belong to the invoice alone (`invoice/invoice-id.ts`, `invoice/command-id.ts`). How to group modules is in "Modules" of the modeling knowledge.

`private`, `protected`, and `readonly` are erased at run time; a `#` field and a closure are private at run time. A brand stops an object of the same shape from being assigned; it does not prove that a factory built the value.

### Class representation

The standard is Event Sourcing. `open` validates inputs and creates a complete aggregate with its creation event. `addLine` and `issue` validate business rules and produce events. Commands build their next state through declared replay methods; `restore` validates history integrity and applies the same methods in order. Corrupt history is not a business rejection. A duplicate add-line command produces no event.

```ts
import type { Result } from "@acme/language-extensions";
import type { CustomerId } from "./customer-id.ts";
import type { InvoiceLine } from "./invoice/line.ts";
import type { InvoiceLines } from "./invoice/lines.ts";
import type { Money } from "./money.ts";

export type OpenInvoiceError = "negative-total";
export type AddInvoiceLineError = "already-issued" | "negative-total";
export type IssueInvoiceError = "already-issued" | "empty-lines";

export type InvoiceOpened = { readonly kind: "opened"; readonly invoiceId: string; readonly customer: CustomerId; readonly lines: InvoiceLines };
export type InvoiceEvent = InvoiceOpened | InvoiceLineAdded | InvoiceIssued;

export type InvoiceLineAdded = { readonly kind: "line-added"; readonly invoiceId: string; readonly commandId: string; readonly line: InvoiceLine };
export type InvoiceIssued = { readonly kind: "issued"; readonly invoiceId: string };

export type AddInvoiceLineOutcome =
  | { readonly kind: "applied"; readonly invoice: Invoice; readonly event: InvoiceLineAdded }
  | { readonly kind: "duplicate"; readonly invoice: Invoice };
export type IssueInvoiceOutcome = { readonly invoice: Invoice; readonly event: InvoiceIssued };

export class Invoice {
  readonly #opening: InvoiceOpened;
  readonly #id: string;
  readonly #customer: CustomerId;
  readonly #lines: InvoiceLines;
  readonly #issued: boolean;
  readonly #lastAddLineCommandId: string | undefined;

  private constructor(opening: InvoiceOpened, lines: InvoiceLines, issued: boolean, lastAddLineCommandId: string | undefined) {
    this.#opening = opening;
    this.#id = opening.invoiceId;
    this.#customer = opening.customer;
    this.#lines = lines;
    this.#issued = issued;
    this.#lastAddLineCommandId = lastAddLineCommandId;
  }

  static open(id: string, customer: CustomerId, lines: InvoiceLines): Result<Invoice, OpenInvoiceError> {
    if (lines.total().isNegative()) return { ok: false, error: "negative-total" };
    const event: InvoiceOpened = { kind: "opened", invoiceId: id, customer, lines };
    return { ok: true, value: Invoice.fromOpened(event) };
  }

  openedEvent(): InvoiceOpened {
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

  addLine(commandId: string, line: InvoiceLine): Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
    if (commandId === this.#lastAddLineCommandId) return { ok: true, value: { kind: "duplicate", invoice: this } };
    if (this.#issued) return { ok: false, error: "already-issued" };
    const lines: InvoiceLines = this.#lines.add(line);
    if (lines.total().isNegative()) return { ok: false, error: "negative-total" };
    const event: InvoiceLineAdded = { kind: "line-added", invoiceId: this.#id, commandId, line };
    const invoice = this.applyLineAdded(event);
    return { ok: true, value: { kind: "applied", invoice, event } };
  }

  issue(): Result<IssueInvoiceOutcome, IssueInvoiceError> {
    if (this.#issued) return { ok: false, error: "already-issued" };
    if (this.#lines.isEmpty()) return { ok: false, error: "empty-lines" };
    const event: InvoiceIssued = { kind: "issued", invoiceId: this.#id };
    const invoice = this.applyIssued(event);
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
```

### Companion representation

The companion representation uses the same commands, events, replay methods and repository contract. Its full-constructor closure owns state, and commands and replay return new instances. The executable standard example below uses classes.

## Domain Primitives

A Domain Primitive wraps one value and has domain invariants narrower than its backing type. Always provide both of and parse. Initialize only after parse rejects invalid input; of delegates the unchanged input to parse and panics (Rust) or throws (TypeScript) on a caller contract violation. parse returns its own error type in Result. Every successful instance satisfies the invariants. Declare those invariants and the parse factory rule that checks all of them in the model. Equality follows the value.

```ts
import type { Result } from "@acme/language-extensions";

export type ParseCustomerIdError = "invalid-format";

export class CustomerId {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): CustomerId {
    const parsed = CustomerId.parse(value);
    if (!parsed.ok) throw new Error("CustomerId is outside its domain");
    return parsed.value;
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

Do not introduce a DP when the backing type alone expresses the valid domain. Resolve unspecified rules as open questions. Never initialize before validation or validate one value and initialize another. ddd-lint checks declarations, input rejection guards, of delegation and direct-construction bypasses from syntax; it does not prove the business meaning of an invariant. Test valid, boundary and invalid values too.

`Money` is a DP for amounts in steps of 100; it is the amount of a line and the total of an invoice, and it lives in a module of its own, `money`. This example requires integer monetary amounts in steps of 100; negative discounts and zero are valid, while the aggregate keeps the total non-negative. `add`, which adds two `Money` values, reads the other value's `#value` inside the same class. A `#` field is readable from other instances of the same class, so no getter takes the value out to add it outside the class. `InvoiceLine` does not expose its amount; it returns the `Money` it gets by adding its amount to the total it receives (`addTo`). The total is passed around as `Money` too, and whether it is negative is asked of it (`isNegative`). In the companion representation `add` asks the other value to add this one's value (`other.plus(state.value)`), the same shape as `equals` asking the other value to match.

```ts
import type { Result } from "@acme/language-extensions";

export type ParseMoneyError = "invalid-increment";

export class Money {
  readonly #value: number;

  private constructor(value: number) {
    this.#value = value;
  }

  static of(value: number): Money {
    const parsed = Money.parse(value);
    if (!parsed.ok) throw new Error("Money is outside its domain");
    return parsed.value;
  }

  static parse(value: number): Result<Money, ParseMoneyError> {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value % 100 !== 0) return { ok: false, error: "invalid-increment" };
    return { ok: true, value: new Money(value) };
  }

  static zero(): Money {
    return Money.of(0);
  }

  add(other: Money): Money {
    return Money.of(this.#value + other.#value);
  }

  isNegative(): boolean {
    return this.#value < 0;
  }
}
```

```ts
import type { Money } from "../money.ts";

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
```

## First-Class Collections

A domain type that holds a collection beside other state wraps it in a first-class collection: a type whose whole state is the collection, which owns the operations and decisions on it. `InvoiceLines` returns a new instance with a line added and totals the lines; the aggregate never touches the array.

```ts
import { Money } from "../money.ts";
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
```

In the companion representation, the collection is a `type` and a `const` object with its own brand.

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

Inside a package, a module is named by a relative specifier with its `.ts` extension. The module `invoice` with the child `invoice/line` is placed as follows; its other child `invoice/lines` is placed like `invoice/line`.

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
export { InvoiceLine } from "./invoice/line.ts";
export { InvoiceLines } from "./invoice/lines.ts";
export { Money } from "./money.ts";
export type { InvoiceOpened, InvoiceEvent } from "./invoice.ts";
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
export { InvoiceLine } from "./invoice/line.ts";
export { InvoiceLines } from "./invoice/lines.ts";
export { Money } from "./money.ts";
export type { InvoiceOpened, InvoiceEvent } from "./invoice/index.ts";
```

Module paths map to the `module` segments of the aggregate mapping: `src/index.ts` is `[]`, `src/invoice.ts` and `src/invoice/index.ts` are `[invoice]`, `src/invoice/line.ts` is `[invoice, line]`, `src/invoice/lines.ts` is `[invoice, lines]`, and `src/money.ts` is `[money]`.

## Use Case and Interface Adapter

The repository port is an `interface` named `<Aggregate>Repository`, declared in the use-case package and never in a domain package. Loading and storing reach outside the process and can fail, so every method returns `Result` and reports a failure as `RepositoryError`. `RepositoryError` is declared beside the port; it is an infrastructure failure, not a business error, so the per-operation error-type rules do not apply to it. The lookup does not treat a missing invoice as a failure and returns `undefined` (`Result<Invoice | undefined, RepositoryError>`); the store returns `Result<void, RepositoryError>`.

```ts
import type { Invoice, InvoiceEvent } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type RepositoryError = { readonly message: string };

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError>;
  store(invoiceId: string, event: InvoiceEvent): Result<void, RepositoryError>;
}
```

`execute` takes an ID and never an aggregate. The use case holds the port in a `#` field, states one named type on every receiver, asks the aggregate to run the command, stores the instance the command returned, and returns the event for the caller to publish after persistence. The use case turns a missing invoice into its own error (`InvoiceNotFound`). It returns a failed store instead of dropping it, and then returns no event.

```ts
import type { Invoice, InvoiceIssued, IssueInvoiceError, IssueInvoiceOutcome } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";
import type { InvoiceRepository, RepositoryError } from "./invoice-repository.ts";

export type InvoiceNotFound = "invoice-not-found";
export type IssueInvoiceFailure = InvoiceNotFound | IssueInvoiceError | RepositoryError;

export class IssueInvoiceUseCase {
  readonly #invoiceRepository: InvoiceRepository;

  constructor(invoiceRepository: InvoiceRepository) {
    this.#invoiceRepository = invoiceRepository;
  }

  execute(invoiceId: string): Result<InvoiceIssued, IssueInvoiceFailure> {
    const found: Result<Invoice | undefined, RepositoryError> = this.#invoiceRepository.findById(invoiceId);
    if (!found.ok) return found;
    if (found.value === undefined) return { ok: false, error: "invoice-not-found" };
    const invoice: Invoice = found.value;
    const issued: Result<IssueInvoiceOutcome, IssueInvoiceError> = invoice.issue();
    if (!issued.ok) return issued;
    const outcome: IssueInvoiceOutcome = issued.value;
    const stored: Result<void, RepositoryError> = this.#invoiceRepository.store(invoiceId, outcome.event);
    if (!stored.ok) return stored;
    return { ok: true, value: outcome.event };
  }
}
```

The repository owns event history. `findById` replays it and returns the aggregate; `store` appends the domain event produced by a command. History loading and replay stay inside the repository. Keep existing events unchanged and use the domain events directly.

```ts
import { Invoice } from "@acme/billing-domain";
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
