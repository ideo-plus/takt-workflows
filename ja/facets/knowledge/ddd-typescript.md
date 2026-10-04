# DDD TypeScript 知識

## コード表現

プロジェクト設定で、すべての集約、Entity、Domain Primitive、値オブジェクトに使う表現を 1 つ選ぶ。どちらも実行時に状態を隠し、1 つの完全コンストラクタで組み立てる。違いは型の書き方にある。

| 条件 | 意味・選択肢 |
|------|-------------|
| チームが class と実行時に非公開の `#` フィールドを好む | `class`: 非公開のコンストラクタが状態全体を受け取り、静的ファクトリはそれを経由する |
| チームが素の型と関数を好む | `companion`: `type` リテラルと同名の `const` オブジェクト。ファクトリのクロージャが状態を持つ |
| 集約ごとに実行モデルや永続化が違う | この選択には関係しない。表現はプロジェクト全体で 1 つ |

以下の例では、顧客を Domain Primitive `CustomerId`、明細金額を Domain Primitive `Money`、明細をファーストクラスコレクション `InvoiceLines` で持つ。請求書 ID とコマンド ID は例を短く保つために裸の `string` のままにしている。業務上の書式や値域がある場合は同じ作り方で包み、請求書だけに属する型として請求書のモジュールの下に置く（`invoice/invoice-id.ts`、`invoice/command-id.ts`）。モジュールのまとめ方はモデリング知識の「モジュール」にある。

`private`、`protected`、`readonly` は実行時に消える。`#` フィールドとクロージャは実行時にも非公開である。ブランドは同じ形のオブジェクトの代入を防ぐが、ファクトリが組み立てたことの証明にはならない。

### class 表現

標準は Event Sourcing である。`open` は入力を検証して完全な集約と生成イベントを一度に作る。`addLine`・`issue` は業務条件を検証してイベントを生む。各コマンドは宣言した replay メソッドで次の状態を作る。`restore` はイベント履歴の整合性を確かめ、同じ replay メソッドを順に使って復元する。履歴の不整合は業務エラーとして扱わない。明細追加の重複コマンドはイベントを生まない。

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

### companion 表現

companion 表現でも、コマンド・イベント・replay・リポジトリの契約は同じにする。完全コンストラクタのクロージャが状態を保持し、コマンドと replay は新しいインスタンスを返す。以下の標準サンプルは class 表現を使う。

## Domain Primitive

Domain Primitive は値を1つ包み、基本データ型より狭いドメインの不変条件を持つ。`of` と `parse` を必ず両方提供する。初期化は `parse` の入力依存の拒否ガードを通してから行い、`of` は同じ入力を `parse` に渡す。`of` の域外入力は呼び出し側の契約違反として throw、`parse` の域外入力は操作固有のエラー型を持つ `Result` で返す。成功したインスタンスは必ず不変条件を満たす。モデルには不変条件と、それらすべてを検証する `parse` のファクトリ規則を宣言する。等価は値で決まる。

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

基本データ型の値域だけで足りる値に DP を作らない。要求で未指定の規則は確認すべき未決事項として扱う。検証前の直接初期化や、別の値で検証してから初期化する経路を作らない。`ddd-lint` は宣言、入力拒否ガード、`of` の検証経路、直接初期化の迂回を構文から検査する。不変条件の業務上の意味を証明するものではないので、域内・境界・域外のテストも書く。

`Money` は100単位刻みの金額を表す DP であり、明細の金額と請求書の合計を表す値として自分のモジュール `money` に置く。この例の金額は100単位刻みの整数という不変条件を持つ。値引きの負数と0も許可し、集約が合計の非負を守る。2 つの `Money` を足す `add` は、相手の `#value` を同じクラスの中で読む。`#` フィールドは同じクラスのほかのインスタンスからも読めるので、getter で値を取り出してクラスの外で足すことはない。`InvoiceLine` は金額を公開せず、受け取った合計に自分の金額を足した `Money` を返す（`addTo`）。合計も `Money` のまま受け渡し、負かどうかは `isNegative` に尋ねる。companion 表現では、`add` は相手に自分の値を足すよう頼む（`other.plus(state.value)`）。`equals` が相手に照合を頼むのと同じ形である。

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

## ファーストクラスコレクション

ほかの状態と並べてコレクションを持つドメインの型は、それをファーストクラスコレクションで包む。状態がそのコレクションだけの型で、コレクションへの操作と判断を持つ。`InvoiceLines` は明細を加えた新しいインスタンスを返し、合計を出す。集約は配列に触れない。

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

companion 表現では、コレクションを自分のブランドを持つ `type` と `const` オブジェクトで書く。

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

パッケージの中では、モジュールを `.ts` 拡張子付きの相対指定子で指す。子 `invoice/line` を持つモジュール `invoice` は次のように置く。ほかの子 `invoice/lines` も `invoice/line` と同じように置く。

| 配置 | 親モジュール | 子 | エントリからの親の指し方 |
|------|-------------|----|-------------------------|
| `named-file` | `./invoice/line.ts` を指す `src/invoice.ts` | `src/invoice/line.ts` | `./invoice.ts` |
| `index-file` | `./line.ts` を指す `src/invoice/index.ts` | `src/invoice/line.ts` | `./invoice/index.ts` |

パッケージのエントリ `src/index.ts` は名前を 1 つずつ公開する。`named-file` では次のとおり。

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

`index-file` では次のとおり。

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

モジュールのパスは集約写像の `module` の区切りに対応する。`src/index.ts` は `[]`、`src/invoice.ts` と `src/invoice/index.ts` は `[invoice]`、`src/invoice/line.ts` は `[invoice, line]`、`src/invoice/lines.ts` は `[invoice, lines]`、`src/money.ts` は `[money]` である。

## ユースケースとインターフェイスアダプタ

リポジトリポートは `<Aggregate>Repository` という名前の `interface` で、ユースケースのパッケージに宣言し、ドメインのパッケージには宣言しない。読み込みと保存はプロセスの外に出るので失敗しうる。どのメソッドも `Result` を返し、失敗は `RepositoryError` で伝える。`RepositoryError` はポートの隣に宣言するインフラの失敗であり、業務上のエラーではないので、操作ごとのエラー型の規則は当てはまらない。検索は、見つからないことを失敗にせず `undefined` で返す（`Result<Invoice | undefined, RepositoryError>`）。保存は `Result<void, RepositoryError>` を返す。

```ts
import type { Invoice, InvoiceEvent } from "@acme/billing-domain";
import type { Result } from "@acme/language-extensions";

export type RepositoryError = { readonly message: string };

export interface InvoiceRepository {
  findById(invoiceId: string): Result<Invoice | undefined, RepositoryError>;
  store(invoiceId: string, event: InvoiceEvent): Result<void, RepositoryError>;
}
```

`execute` は ID を受け取り、集約は受け取らない。ユースケースはポートを `#` フィールドに持ち、すべての受け手に 1 つの型を明記し、集約にコマンドの実行を頼み、コマンドが返したインスタンスを保存し、永続化の後に呼び出し側が公開できるようイベントを返す。見つからなかった請求書は、ユースケースが自分のエラー（`InvoiceNotFound`）にする。保存の失敗は捨てずに返し、そのときはイベントを返さない。

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

リポジトリはイベント列を内部に保持する。`findById` は履歴を replay して集約を返し、`store` はコマンドが生んだドメインイベントを追記する。ユースケースへ履歴の取得・再生を公開しない。既存イベントを上書きせず、同じ意味の別DTOへ変換しない。

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
