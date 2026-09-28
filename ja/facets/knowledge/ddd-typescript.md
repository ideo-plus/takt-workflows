# DDD TypeScript 知識

## コード表現

プロジェクト設定で、すべての集約、Entity、Domain Primitive、値オブジェクトに使う表現を 1 つ選ぶ。どちらも実行時に状態を隠し、1 つの完全コンストラクタで組み立てる。違いは型の書き方にある。

| 条件 | 意味・選択肢 |
|------|-------------|
| チームが class と実行時に非公開の `#` フィールドを好む | `class`: 非公開のコンストラクタが状態全体を受け取り、静的ファクトリはそれを経由する |
| チームが素の型と関数を好む | `companion`: `type` リテラルと同名の `const` オブジェクト。ファクトリのクロージャが状態を持つ |
| 集約ごとに実行モデルや永続化が違う | この選択には関係しない。表現はプロジェクト全体で 1 つ |

以下の例は短く保つため、顧客と金額を裸の `string` と `number` で持っている。実際のコードでは、業務上の意味を持つ値を `InvoiceLine` と同じ作り方の Domain Primitive（`CustomerId`、`Money`）で包む。

`private`、`protected`、`readonly` は実行時に消える。`#` フィールドとクロージャは実行時にも非公開である。ブランドは同じ形のオブジェクトの代入を防ぐが、ファクトリが組み立てたことの証明にはならない。

### class 表現

`open` は検証して非公開のコンストラクタで組み立て、`Result` を返す。`restore` は状態全体を検証してから永続化された請求書を組み立て直し、壊れた状態では throw する。これは業務上の失敗ではない。コマンド `addLine`（`command.invoice.add-line`）と `issue` は、呼ばれた請求書を変えない。変更後の状態で非公開のコンストラクタから新しい請求書を組み立て、生んだ 1 つのイベントと一緒に、写像の `success_type` が名付ける成功値の型（`AddInvoiceLineOutcome`、`IssueInvoiceOutcome`）で返す。`addLine` は反映した要求 ID を記憶し、再送された要求をほかのどの判定より先に認識する。そのときは `kind: "duplicate"` と変わらない請求書を返し、イベントは返さないので、イベントが二重に公開されない。イベント（`InvoiceLineAdded`、`InvoiceIssued`）は集約のモジュールで宣言する読み取り専用のデータ型である。`#` フィールドはすべて `readonly` にする。`lines()` は複製を返し、`total()` は各明細に加算を頼む。

```ts
import type { Result } from "@acme/language-extensions";
import type { InvoiceLine } from "./invoice/line.ts";

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
```

### companion 表現

状態全体を受け取るファクトリ（`restore`）が完全コンストラクタである。検証し、入力を複製してクロージャの状態に入れ、型の注釈を付けたリテラルでインスタンスを書く。`open` とコマンドはそれを経由して組み立てるので、コマンドは新しいインスタンスを返し、クロージャの状態には書き込まない。読み取り専用の型はコレクション自身の変数に付け、状態のオブジェクトには注釈を付けない。

```ts
import type { Result } from "@acme/language-extensions";
import type { InvoiceLine } from "./invoice/line.ts";

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
```

## Result と操作のエラー

`Result` は infrastructure の言語拡張パッケージ（たとえば `packages/infrastructure/language-extensions`、その `exports` のエントリで公開）に置く。ドメインのパッケージはそれを `dependencies` に挙げ、パッケージ名で `import type` する。

```ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
```

写像された各ファクトリとコマンドは、自分のエラー型を明記する。それは写像された case の文字列リテラルの union で、`error_type` の名前を持ち、集約のモジュールから export する。`IssueInvoiceError` は `"already-issued"` と `"empty-lines"` を持ち、`open` や `addLine` のものは持たない。コマンドの成功値の型は成功値の型で、`success_type` の名前を持ち、エラー型と並べて export する。写像されたファクトリの成功値は集約である。操作に結び付かないファクトリ（`restore` や値オブジェクトの `of`）は値そのものを返す。

## 所有

ファクトリやコマンドが受け取った配列やオブジェクトは複製して持ち（`[...lines]`）、状態として持つものではなく複製か読み取り専用の値を返す。`#` フィールドやクロージャでも、呼び出し側が同じ可変の値への参照を持っていれば変わってしまう。業務上の失敗は、新しいインスタンスを組み立てる前に返す。

## モジュール配置と指定子

パッケージの中では、モジュールを `.ts` 拡張子付きの相対指定子で指す。子 `invoice/line` を持つモジュール `invoice` は次のように置く。

| 配置 | 親モジュール | 子 | エントリからの親の指し方 |
|------|-------------|----|-------------------------|
| `named-file` | `./invoice/line.ts` を指す `src/invoice.ts` | `src/invoice/line.ts` | `./invoice.ts` |
| `index-file` | `./line.ts` を指す `src/invoice/index.ts` | `src/invoice/line.ts` | `./invoice/index.ts` |

パッケージのエントリ `src/index.ts` は名前を 1 つずつ公開する。`named-file` では次のとおり。

```ts
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
```

`index-file` では次のとおり。

```ts
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
```

モジュールのパスは集約写像の `module` の区切りに対応する。`src/index.ts` は `[]`、`src/invoice.ts` と `src/invoice/index.ts` は `[invoice]`、`src/invoice/line.ts` は `[invoice, line]` である。

## ユースケースとインターフェイスアダプタ

リポジトリポートは `<Aggregate>Repository` という名前の `interface` で、ユースケースのパッケージ（またはドメインのパッケージ）に宣言する。検索は自分のエラー型を返す。

```ts
import type { Invoice } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type InvoiceNotFound = "invoice-not-found";

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice, InvoiceNotFound>;
  store(invoiceId: string, invoice: Invoice): void;
}
```

`execute` は ID を受け取り、集約は受け取らない。ユースケースはポートを `#` フィールドに持ち、すべての受け手に 1 つの型を明記し、集約にコマンドの実行を頼み、コマンドが返したインスタンスを保存し、永続化の後に呼び出し側が公開できるようイベントを返す。

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

アダプタはポートを実装し、名前に保存媒体の接頭辞を付けてよい。集約は `restore`、各明細は `of` で組み立て直す。

```ts
import { Invoice, InvoiceLine } from "@acme/billing-domain";
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
    const lines: readonly InvoiceLine[] = record.amounts.map((amount: number) => InvoiceLine.of(amount));
    return { ok: true, value: Invoice.restore(invoiceId, record.customer, lines, record.issued, record.addLineRequests) };
  }

  store(invoiceId: string, invoice: Invoice): void {
    this.#stored.set(invoiceId, invoice);
  }
}
```

## ワークスペースの配置

```text
tsconfig.json                  # すべてのパッケージを参照する
packages/
  infrastructure/language-extensions/   # Result
  command/billing-domain/
  command/billing-use-case/
  command/billing-interface-adapter/
  query/billing-query-use-case/
  query/billing-query-interface-adapter/
  composition-root/billing-api/
```

各パッケージは `exports` を持つ `package.json` を持ち、ソースを `src/` の下に置き、テスト、宣言ファイル、`.tsx`・`.mts`・`.cts` のソースを `src` の外に置く。参照される `tsconfig.json` はすべて `module: esnext`、`moduleResolution: bundler`、`strict: true`、es2017 から esnext までの target で揃え、どれも `baseUrl` を設定しない。
