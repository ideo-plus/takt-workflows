# DDD モデリング知識

## プロジェクトのファイル

DDD のプロジェクトは、タスクをまたいで育てるモデルと設定をファイルで持つ。

| ファイル | 役割 |
|----------|------|
| `.ddd.toml`（リポジトリ直下） | 言語と、言語ごとの選択（モジュール配置と TypeScript のコード表現） |
| `docs/ddd/domain-model.yaml` | ドメインモデル宣言。業務概念の唯一の定義 |
| `docs/ddd/aggregate-mapping.yaml` | モデルの各要素がコードのどこにあるか、およびドメインパッケージの業務語彙 |
| `docs/ddd/layer-structure.yaml` | 境界づけられたコンテキストごとのパッケージ、役割と依存、ポート、リポジトリ、復元経路 |

### .ddd.toml

```toml
languages = ["rust", "typescript"]

[rust]
module_layout = "file"            # または "mod-rs"

[typescript]
module_layout = "named-file"      # または "index-file"
code_representation = "class"     # または "companion"
```

挙げた言語のテーブルだけを置く。新しいプロジェクトでは `file` と `named-file` が一般的な選択である。

### ドメインモデル宣言

属性の `type` は、言語に依存しないスカラー `string`、`integer`、`decimal`、`boolean`、`date`、`datetime`、またはモデル要素の ID を使う。整数の識別子は `integer` とする。TypeScript の `number` や Rust の `u64` など、実装言語の型名をここに書かない。実装上の型・配置・メソッドは集約写像に宣言する。

```yaml
bounded_contexts:
- element_id: bc.billing
  name: Billing
  aggregates:
  - element_id: aggregate.invoice
    name: Invoice
    bounded_context: bc.billing
    root_element: entity.invoice
    states:
    - draft
    - issued
    elements:
    - element_id: entity.invoice
      kind: entity
      name: Invoice
      aggregate: aggregate.invoice
    - element_id: vo.invoice-line
      kind: value-object
      name: InvoiceLine
      aggregate: aggregate.invoice
    - element_id: primitive.customer-id
      kind: domain-primitive
      name: CustomerId
      aggregate: aggregate.invoice
      attributes:
      - name: value
        type: string
        required: true
    - element_id: primitive.money
      kind: domain-primitive
      name: Money
      aggregate: aggregate.invoice
      attributes:
      - name: value
        type: decimal
        required: true
    invariants:
    - element_id: invariant.invoice.money-increment
      name: MoneyIncrement
      aggregate: aggregate.invoice
      element: primitive.money
      statement: monetary amounts are finite integer multiples of 100; negative discounts
        and zero are permitted
    - element_id: invariant.invoice.customer-id-format
      name: CustomerIdFormat
      aggregate: aggregate.invoice
      element: primitive.customer-id
      statement: a customer ID is C followed by six digits
    - element_id: invariant.invoice.total-not-negative
      name: TotalNotNegative
      aggregate: aggregate.invoice
      statement: the total of the lines is never negative
    - element_id: invariant.invoice.issued-has-lines
      name: IssuedHasLines
      aggregate: aggregate.invoice
      statement: an issued invoice has at least one line
    commands:
    - element_id: command.invoice.add-line
      name: AddLine
      aggregate: aggregate.invoice
      effect: accumulation
      state_effect: none
      domain_errors:
      - element_id: error.invoice.add-line.already-issued
        name: AlreadyIssued
        operation: command.invoice.add-line
        condition: the invoice is issued
      - element_id: error.invoice.add-line.negative-total
        name: NegativeTotal
        operation: command.invoice.add-line
        condition: the line would make the total negative
      event: event.invoice.line-added
      idempotency:
        strategy: command-id-memory
        retention: last-one
        rationale: a client sends the next add-line of an invoice only after the previous
          one is acknowledged, so an older add-line is never resent after a newer
          one
    - element_id: command.invoice.issue
      name: Issue
      aggregate: aggregate.invoice
      effect: transition
      state_effect: transitions
      transitions:
      - transition.invoice.issue
      domain_errors:
      - element_id: error.invoice.issue.already-issued
        name: AlreadyIssued
        operation: command.invoice.issue
        condition: the invoice is issued
      - element_id: error.invoice.issue.empty-lines
        name: EmptyLines
        operation: command.invoice.issue
        condition: the invoice has no line
      event: event.invoice.issued
      idempotency:
        strategy: none
    events:
    - element_id: event.invoice.opened
      name: Opened
      aggregate: aggregate.invoice
      produced_by: factory.invoice.open
    - element_id: event.invoice.line-added
      name: LineAdded
      aggregate: aggregate.invoice
      produced_by: command.invoice.add-line
    - element_id: event.invoice.issued
      name: Issued
      aggregate: aggregate.invoice
      produced_by: command.invoice.issue
    transitions:
    - element_id: transition.invoice.issue
      name: Issue
      aggregate: aggregate.invoice
      from_state: draft
      to_state: issued
      command: command.invoice.issue
    factory_rules:
    - element_id: factory.invoice.open
      name: Open
      target_element: entity.invoice
      preconditions:
      - invariant.invoice.total-not-negative
      domain_errors:
      - element_id: error.invoice.open.negative-total
        name: NegativeTotal
        operation: factory.invoice.open
        condition: the lines add up to a negative total
    - element_id: factory.invoice.parse-customer-id
      name: ParseCustomerId
      target_element: primitive.customer-id
      preconditions:
      - invariant.invoice.customer-id-format
      domain_errors:
      - element_id: error.invoice.parse-customer-id.invalid-format
        name: InvalidFormat
        operation: factory.invoice.parse-customer-id
        condition: the value is not C followed by six digits
    - element_id: factory.invoice.parse-money
      name: ParseMoney
      target_element: primitive.money
      preconditions:
      - invariant.invoice.money-increment
      domain_errors:
      - element_id: error.invoice.parse-money.invalid-increment
        name: InvalidIncrement
        operation: factory.invoice.parse-money
        condition: the amount is not a finite integer multiple of 100
lineage: []
```

要素 ID は小文字のケバブケースで `<kind>.<segments>` と書く。`bc`、`aggregate`、`entity`、`vo`、`primitive`、`pm` は区切り 1 つ、`invariant`、`command`、`event`、`transition`、`factory` は集約と名前の 2 つ、`error` は集約、操作、名前の 3 つをとる。`lineage` の項目（`lineage-0001`、関係は `renamed`、`split`、`merged`、`deprecated`）が ID の変化を記録する。

Domain Primitive（`kind: domain-primitive`）は属性を1つ包み、基本データ型より狭いドメインの不変条件を持つ。`element` でその Primitive を指す不変条件と、それらすべてを `preconditions` に取って規則違反を返す `parse` のファクトリ規則を必ず宣言する。コードには `of` と `parse` を両方置き、どちらも不変条件に基づいて初期化する。`of` は同じ入力を `parse` に渡し、域外なら契約違反として例外にする。`parse` は入力を検証して、自分のエラー型の `Result` を返す。基本データ型の値域だけで足りるものには DP を作らない。未指定の規則は未決事項として確認し、無制約の DP にしない。`collection: true` の属性はファーストクラスコレクションの型で持つ。

### 集約写像

```yaml
model_ref: domain-model.yaml
aggregate_mappings:
- aggregate_ref: aggregate.invoice
  programming_model: class
  persistence_method: event-sourcing
  reference_ids:
  - entity.invoice
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
    type: Invoice
  operations:
  - operation_ref: factory.invoice.open
    code:
      method: open
      error_type: OpenInvoiceError
    errors:
    - error_ref: error.invoice.open.negative-total
      code:
        case: negative-total
  - operation_ref: factory.invoice.parse-customer-id
    code:
      method: parse
      error_type: ParseCustomerIdError
    errors:
    - error_ref: error.invoice.parse-customer-id.invalid-format
      code:
        case: invalid-format
  - operation_ref: factory.invoice.parse-money
    code:
      method: parse
      error_type: ParseMoneyError
    errors:
    - error_ref: error.invoice.parse-money.invalid-increment
      code:
        case: invalid-increment
  - operation_ref: command.invoice.add-line
    code:
      method: addLine
      success_type: AddInvoiceLineOutcome
      error_type: AddInvoiceLineError
    errors:
    - error_ref: error.invoice.add-line.already-issued
      code:
        case: already-issued
    - error_ref: error.invoice.add-line.negative-total
      code:
        case: negative-total
  - operation_ref: command.invoice.issue
    code:
      method: issue
      success_type: IssueInvoiceOutcome
      error_type: IssueInvoiceError
    errors:
    - error_ref: error.invoice.issue.already-issued
      code:
        case: already-issued
    - error_ref: error.invoice.issue.empty-lines
      code:
        case: empty-lines
  replay_methods:
  - event_ref: event.invoice.opened
    code:
      method: fromOpened
  - event_ref: event.invoice.line-added
    code:
      method: applyLineAdded
  - event_ref: event.invoice.issued
    code:
      method: applyIssued
domain_packages:
- term: Billing
  model_refs:
  - bc.billing
  rationale: owns the billing business
  code:
    language: typescript
    package: '@acme/billing-domain'
    module: []
- term: Invoice
  model_refs:
  - aggregate.invoice
  rationale: opens and issues invoices
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
- term: Invoice line
  model_refs:
  - vo.invoice-line
  rationale: one amount an invoice adds up
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
    - line
- term: Invoice lines
  model_refs:
  - vo.invoice-line
  rationale: the lines of one invoice and their total
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - invoice
    - lines
- term: Customer ID
  model_refs:
  - primitive.customer-id
  rationale: identifies the customer an invoice bills
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - customer-id
- term: Money
  model_refs:
  - primitive.money
  rationale: the amount of a line and the total of an invoice
  code:
    language: typescript
    package: '@acme/billing-domain'
    module:
    - money
```

`model_ref` は `docs/ddd` からの相対パスで書く。`success_type` はコマンドが成功時に返すものの型名である。TypeScript では新しいインスタンスとイベントを持つ成功値の型、Rust ではイベント、再送されたコマンドを認識するコマンドでは成功値の enum になる。ファクトリ規則の成功値は集約の型である。`module` はパッケージのルートより下の区切りを並べたもので、ルートは `[]` になる。ルートから下のすべての階層を宣言する。TypeScript では case の文字列がリテラルの union のメンバー（`already-issued`）になり、Rust では enum のバリアント（`AlreadyIssued`）になる。

### 層構造

```yaml
model_ref: domain-model.yaml
layer_structures:
- context_ref: bc.billing
  cqrs: false
  packages:
  - role: command
    code:
      language: typescript
      package: '@acme/billing-domain'
  - role: command
    code:
      language: typescript
      package: '@acme/billing-use-case'
  - role: command
    code:
      language: typescript
      package: '@acme/billing-interface-adapter'
  dependencies:
  - code:
      language: typescript
      package: '@acme/billing-domain'
    depends_on:
    - language: typescript
      package: '@acme/language-extensions'
  - code:
      language: typescript
      package: '@acme/billing-use-case'
    depends_on:
    - language: typescript
      package: '@acme/billing-domain'
    - language: typescript
      package: '@acme/language-extensions'
  - code:
      language: typescript
      package: '@acme/billing-interface-adapter'
    depends_on:
    - language: typescript
      package: '@acme/billing-domain'
    - language: typescript
      package: '@acme/billing-use-case'
    - language: typescript
      package: '@acme/language-extensions'
  ports:
  - name: InvoiceRepository
    kind: repository
    verbs:
    - findById
    - store
  repositories:
  - name: InvoiceRepository
    aggregate_ref: aggregate.invoice
    io_unit: single
    verbs:
    - findById
    - store
    store_semantics: append-only
  restoration_paths:
  - aggregate_ref: aggregate.invoice
    via: event-replay
  persistence_backend: in-memory
```

`packages` はコンテキスト自身のパッケージを CQRS の側（`role`）とともに並べる。言語拡張（`@acme/language-extensions`）のようにコンテキストの外にある共有パッケージは、どの側にも立たないので `packages` に行を持たず、それを使うパッケージの `depends_on` にだけ書く。依存行には、そのパッケージの `package.json` や `Cargo.toml` が直接依存するパッケージをすべて書く。

永続化を持たない集約だけのコンテキストでも、パッケージ、依存行、復元経路は宣言する。`ports: []`、`repositories: []`、`persistence_backend: none` は明示的に記述できる。


Event Sourcing は保存媒体にかかわらず `via: event-replay` を宣言する。リポジトリが保持するのは順序付きの追記専用ドメインイベント列であり、集約に宣言した replay メソッドで復元する。インメモリの Map／HashMap もイベント列を保持し、集約の現在状態やその保存ラッパーを格納しない。

## モデルの導き方

モデルはデータの表からではなく振る舞いから導く。ストーリーから過去形のドメインイベントを挙げ、各イベントを生むコマンドとアクターを特定し、同じ状態を変えるイベントを集約にまとめる。集約の不変条件が、それらが一緒にある理由を説明する。

| 条件 | 意味・選択肢 |
|------|-------------|
| 候補が守る不変条件を述べられない | 別の集約へ統合するか、値や Entity に格下げする |
| 規則を守るために 2 つの候補が一緒に変わる必要がある | 1 つの集約にする。分けたままにするなら Process Manager |
| フローが集約をまたぐ | Process Manager の候補。ステップと補償をモデルに記録する |
| 操作が状態を変えない | `state_effect: none` とする。これは有効な宣言である |
| 用語がコードにだけあり、業務の語彙にない | パッケージの名前にする前に意味を確かめる |

## モジュール

ドメイン層のパッケージは、エヴァンスのいうモジュールに分ける。モジュールはモデルの一部であり、コードを種類で入れておく技術の入れ物ではない。凝集した概念を 1 つのモジュールにまとめ、モジュール同士の依存を少なくする。名前はユビキタス言語から付け（集約写像の `domain_packages` に業務用語として宣言する）、モジュールの並びを見ればドメインの構成が読み取れるようにする。モデルが変われば、モジュールも組み替える。

| 型 | 置き場所 |
|----|----------|
| 1 つの概念に属する型（集約ルート、その識別子、明細のような値オブジェクト、集約が記憶するコマンド ID） | その概念のモジュールの下（`invoice/`） |
| 複数の概念が使う値（金額） | 責務の名前のモジュール（`money`） |
| ほかの集約を指す ID（顧客 ID） | 指す先の概念のモジュール（`customer-id`） |

概念が少ないうちは、パッケージのルートに数個のモジュールが並ぶだけでよい。ID を包んだときの形は次のとおり（TypeScript、`named-file`）。

```text
packages/command/billing-domain/src/
  index.ts
  invoice.ts          # 請求書: 集約ルート、エラー、イベント
  invoice/
    invoice-id.ts     # 請求書を識別する
    command-id.ts     # 請求書が記憶する明細追加のコマンド ID
    line.ts           # 明細
    lines.ts          # 明細の並び
  customer-id.ts      # 請求先の顧客を識別する
  money.ts            # 明細の金額と請求書の合計
```

概念が増えてルートの並びから構成が読み取れなくなったら、凝集する概念をモジュールにまとめ直す。たとえば顧客の与信を扱うようになれば、顧客 ID は与信枠と一緒に `customer` モジュールへ移り、入金を扱うようになれば `payment` モジュールができる。`ids`、`primitives`、`value-objects` のように型の種類でまとめたモジュールは作らない。Rust でも同じで、`file` 配置なら `invoice.rs` と `invoice/invoice_id.rs` のようになる。

## 集約ごとの二軸

このワークフローの永続化方式は Event Sourcing に統一する。

リポジトリの公開境界は集約である。`findById`（Rust は `find_by_id`）は履歴を内部で replay した集約を `Result<Aggregate | undefined, RepositoryError>`（Rust は `Result<Option<Aggregate>, RepositoryError>`）で返す。`store` は集約IDと今回のドメインイベントを受け取り、追記成功を `Result<void, RepositoryError>`（Rust は `Result<(), RepositoryError>`）で返す。`loadEvents` をリポジトリポートへ公開したり、ユースケースで履歴を replay したりしない。これを計画時のAPI・受入条件にも宣言する。

State Sourcing のコード例・保存経路を混在させない。

実行モデルと永続化は独立した選択であり、どちらも TypeScript のコード表現とは独立している。

| 軸 | 値 | 意味 |
|----|----|------|
| `programming_model` | `class` | 集約はユースケースから呼ばれるオブジェクト |
| | `actor` | 集約はメッセージを受け取る。複数集約のフローには Process Manager が要る |
| `persistence_method` | `event-sourcing` | イベントを追記する。状態は宣言した replay メソッドで再生して組み立てる |

集約を生成するファクトリは、すべての不変条件を検証してから、生成イベントと完全な集約を一度に組み立てる。生成イベントの `produced_by` は集約ルートのファクトリを参照する。ファクトリは集約を返し、生成イベントは集約の読み取り専用の操作で取得する。復元の最初の生成イベントも同じ replay ファクトリを通す。初期化を後から完成させる空の集約は作らない。

状態を変えるコマンドは、永続化の方式にかかわらず、生んだ 1 つのイベントを返す。イベントソーシングでは、コマンドは宣言した replay メソッドを通して状態を変え、復元は保存済みのイベントを同じメソッドで再生する。replay メソッドは何も判断しない。

## 冪等性と回復

| 条件 | 意味・選択肢 |
|------|-------------|
| `effect: transition` | 同じコマンドを繰り返しても目的の状態に達しているので、遷移そのものが守る |
| `effect: accumulation` | 繰り返すと二重に加わる。コマンド ID を記憶する（`command-id-memory`）。古いコマンドが新しいコマンドの後に再送されない理由を `rationale` に書けるなら最後の 1 件（`last-one`）、書けなければ複数件（`multiple`）か時間窓（`time-window`）で保持する |
| 直前のコマンド ID だけを覚えている | C2 の後に届いた C1 の再送を防げない |
| 永続化の結果が不明 | 再試行する前にコマンド ID で照合する |
| 複数集約のフローが途中で失敗する | 先のコミットは残る。再実行か補償で回復する。補償は新しい業務操作である |

| 回復方針 | 意味 |
|----------|------|
| `caller-retry` | 呼び出し側がユースケース全体を安全に再試行する |
| `step-backoff` | 失敗したステップを間隔を空けて再試行する |
| `both` | 両方の仕組みを使う |

計画で宣言するユースケースは、`use_case_id`（`uc.<slug>`）、`name`、`target_aggregates`、`commands`、`re_execution_basis`、`recovery_policy`、複数の集約を対象にするときの `multi_aggregate_strategy`（`pm.*` を参照する `process-manager`、または根拠を添えた `re-execution`）、`read_model_exposure` を持つ。

## CQRS と読み取りモデル

| 条件 | 意味・選択肢 |
|------|-------------|
| 集約が持たない形の問い合わせが必要 | DAO と DTO を持つクエリ側を置き、読み取りモデル更新器で更新する |
| 読み取りモデルを非同期に更新する | 古い可能性がある。呼び出し側が依存する箇所では遅延を明示する |
| イベントが順不同や重複で届く | 集約内の番号と処理済みのイベント ID を追跡し、更新と処理済みの記録を原子的に確定する |
| 更新に別の集約の事実が要る | その集約を読み込むか、Process Manager に調整させる。読み取りモデルは判断の根拠にしない |

## 層

| 層 | 置くもの | 依存先 |
|----|----------|--------|
| domain | 集約、Entity、値オブジェクト、Domain Primitive、状態を持たないドメインサービス | infrastructure |
| use-case | ポート（リポジトリポートと、層構造が宣言するほかのポート）。読み込み、ドメイン操作の呼び出し、保存、回復。コマンド側の `execute(ID, 値)`、クエリのユースケース | domain、infrastructure |
| interface-adapter | コントローラ、リポジトリ実装、DAO、データベースと RPC のクライアント | use-case、domain、infrastructure |
| infrastructure | 言語拡張だけ（TypeScript の `Result` など） | なし |
| composition root | 実装とポートの結線 | すべての層 |
| 読み取りモデル更新器 | イベントを読み取りモデルへ投影する | 両側 |

クエリ側は use-case と interface-adapter の層だけを持ち、自分のドメイン層を持たない。
