# DDD モデリング知識

## 業務の具体例からモデルを確かめる

モデルは、業務を説明するためにも、実装するためにも使う。宣言とコードが一致していても、業務の意味を表せなかったり、利用側に不自然な操作を要求したりするなら見直す。業務の専門家から得た具体例、要求にある反例、利用側のコードを使い、モデルの言葉と責務が役に立つかを確かめる。

計画では、今回の変更に関係するモデルの仮説と採用理由を示す。迷う箇所は代替案を比較し、未確認の業務規則を事実として扱わない。テストはモデルの使い方を具体例で表し、不変条件が破られる入力や順序も確かめる。実装やテストから新しい業務上の発見があれば、その事実と影響するモデル要素を記録し、既存の再計画経路へ戻す。宣言を更新してから本番コードを変える順序は保つ。

書籍は、モデルと実装を往復して改善することを求める。宣言ファイル、安定した要素の識別子、更新順序、Result のエラー、イベントソーシングの採用は、このプロジェクトの実装方針である。書籍の原則とプロジェクトの選択を区別して説明する。

一次資料: Evans『Domain-Driven Design』第3章「Model-Driven Design」（48〜49ページ）、「Hands-On Modelers」（60〜62ページ）。Vernon『Implementing Domain-Driven Design』第1章「DDD Is Not Heavy」（37〜38ページ）、第6章「Testing Value Objects」（239〜240ページ）。

## 用語の意味とモデル間の関係を揃える

業務と開発で使う言葉は、境界づけられたコンテキストごとに共有する。同じ言葉でも、別のコンテキストでは意味や規則が違う場合がある。例えば「顧客」が、請求先を指す場合と、本人確認の対象を指す場合では、必要な情報と規則が違う。今回の変更が触れる用語について、業務上の意味、具体例、意味が変わる境界を確認する。表示名、保存先の列名、技術上の型名だけを意味の根拠にしない。

複数のモデルが関わる場合は、現在のコンテキストと接点を整理する。どのモデルが情報を提供し、どのモデルが利用するか、誰が契約を決めるか、どこで意味を翻訳するかを示す。外部モデルをそのまま採用する場合やモデルの一部を共有する場合も、その理由と影響を確認する。この関係の見取り図がコンテキストマップであり、パッケージ間の依存表とは役割が違う。

用語や関係の根拠は計画レポートに書き、関連する既存モデル要素を引用する。対応していないキーを `docs/ddd/*.yaml` に追加しない。変更が外部との接点に触れない場合は、その旨を示せばよく、新しい成果物やコンテキストを増やす必要はない。全社の用語統一や、無関係なモデルの再設計へ範囲を広げない。

一次資料: Evans 第2章「Ubiquitous Language」（24〜27ページ）、第14章「Context Map」（344〜345ページ）。Vernon 第1章「Ubiquitous, but Not Universal」（25ページ）、第3章「Why Context Maps Are So Essential」（87〜90ページ）。

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


Event Sourcing は保存媒体にかかわらず `via: event-replay` を宣言する。リポジトリが保持するのは、順序付きの追記専用ドメインイベント列と、集約そのもののスナップショットである。読込は、最新のスナップショットにその後のイベントを集約に宣言した replay メソッドで適用する。インメモリの Map／HashMap も、イベント列の Map と、集約そのものを値に持つスナップショットの Map を 1 つずつ持つ。集約の状態を別の型に詰め替えた保存ラッパーは格納しない。

## ファクトリ名の選択

用途に合わせて名前を選び、実装名は集約写像の `code.method` に宣言する。次の表はこのプロジェクトの命名方針であり、Java の慣習を全言語へそのまま適用するものではない。

| 名前 | 意味と用途 |
|------|------------|
| `of` | 単一値または構成要素から VO を構築する。複数引数に限定しない。DP では基本入力を検証し、契約違反を panic／throw にする |
| `parse` | 入力を解釈・検証し、操作固有のエラーを持つ Result で構築する。`ReservationId::parse(value: u64)` のような数値入力も使う |
| `from` | 意味のある別型から変換する。同じ型のコピーや DP の基本入力の包装は、この名前にしない |
| `create` | Entity やドメインオブジェクトを生成する。`reserve`・`open` など、操作を表す業務名があれば優先する |
| `generate` | 計算・アルゴリズムによって値を生成する。決定的な計算も含み、乱数に限定しない。生成した DP も不変条件を検証する |
| `valueOf` | 値に対応するオブジェクトを得るという技術 API の慣習。キャッシュは実装上の選択である。新規のドメイン API は `of`／`parse` を標準にする |
| `getInstance` | 利用するインスタンスを取得する。共有・キャッシュ・シングルトンの保証は個別の契約に記載する |
| `newInstance` | 新しいインスタンスを構築する。ドメインでは `of`／`create`／業務名を優先する。新規性は実装を確認する |

Rust では `value_of`・`get_instance`・`new_instance` のように snake_case にする。`from` は失敗しない変換として扱い、失敗する変換は `try_from` と `Result` を使う。TypeScript の `from` は、失敗するなら操作固有のエラーを持つ Result を返す。TS のインスタンス `valueOf()` は、言語の変換フックとして別に扱う。

命名リンターは `of`・`parse`・`from`・Rust の `try_from` の構造を検査する。キャッシュ・新規性・アルゴリズムの意味はレビューで確認する。ES の `replay` と宣言済み replay メソッドは、履歴を適用する専用の経路である。

参考にした一次資料: [LocalDate.of](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/LocalDate.html)、[Integer.valueOf／parseInt](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Integer.html)、[Calendar の実装](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/java/util/Calendar.java)、[UUID.randomUUID](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/UUID.html)、[Rust From](https://doc.rust-lang.org/std/convert/trait.From.html)、[ECMAScript valueOf](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.prototype.valueof)。Java の3引数の日付構築例は `LocalDate.of(year, month, day)`、UUID の標準生成例は `UUID.randomUUID()` である。

## 同一性を追うものと、属性で交換できるものを区別する

エンティティは、属性が変わっても同じものとして追う必要がある概念である。値オブジェクトは、属性が等しければ交換しても業務上の意味が変わらない概念である。分類は業務上の役割から決める。住所も、配送先を記述する値として使う場合と、変更履歴を追う登録住所として使う場合では判断が違う。

エンティティでは、何を同じものとみなすか、識別子をいつ付けるか、どの範囲と期間で維持するかを確かめる。表示名の変更と同一性の変更は区別する。保存先が付けた識別子があることだけを、エンティティにする理由にしない。値オブジェクトでは属性による等価性、交換可能性、まとまりとしての意味を確かめる。

論理的な値の性質と、実装上その値をどう変更するかは区別する。書籍は通常、値を不変に扱うことを勧めるが、このプロジェクトの Rust では所有下の値をその場で変更する方針がある。分類の理由を確認するために、その言語方針を勝手に置き換えない。

一次資料: Evans 第5章「Entities」「Value Objects」（89〜101ページ）、第7章「Distinguishing Entities and Value Objects」（167〜168ページ）。Vernon 第5章「Identity Stability」（188〜189ページ）、第6章「Value Characteristics」（221〜229ページ）。

## モデルの導き方

モデルは業務の振る舞いから導く。ストーリーから過去形のドメインイベントを挙げ、各イベントを生むコマンドとアクターを特定する。各操作で即時に守る不変条件を確かめ、その成立に必要な状態を集約にまとめる。同じ画面や一つの業務フローで使うことだけを、同じ集約にする理由にしない。

| 条件 | 意味・選択肢 |
|------|-------------|
| 候補が守る不変条件を述べられない | 別の集約へ統合するか、値や Entity に格下げする |
| 即時の不変条件を守るために二つの候補が一緒に変わる必要がある | 一つの集約にする案を検討する。分ける場合は、同じ不変条件を原子的に守る明示的な戦略が必要。プロセスマネージャーだけでは保証できない |
| 集約間の規則に、整合するまでの遅延が許される | 許容遅延、中間状態、再試行と補償の条件を確認する。プロセスマネージャーなどで結果整合性を実現する |
| フローが集約をまたぐ | Process Manager の候補。ステップと補償をモデルに記録する |
| 操作が状態を変えない | `state_effect: none` とする。これは有効な宣言である |
| 用語がコードにだけあり、業務の語彙にない | パッケージの名前にする前に意味を確かめる |

たとえば「同じ部屋の同じ時間帯に確定予約を二つ作らない」という規則を、予約後の取消で補償しても、一時的な違反は防げない。業務が要求する保証を先に確かめ、集約の境界と保存先の制約を選ぶ。複数集約を一つのトランザクションで扱う例外は、その理由と保証を明示する。

一次資料: Evans 第6章「Aggregates」（125〜129ページ）。Vernon 第10章「Rule: Model True Invariants in Consistency Boundaries」（353〜355ページ）、「Rule: Use Eventual Consistency Outside the Boundary」（364〜366ページ）、「Reasons to Break the Rules」（367〜370ページ）。

## モジュール

ドメイン層のパッケージは、エヴァンスのいうモジュールに分ける。モジュールはモデルの一部であり、コードを種類で入れておく技術の入れ物ではない。凝集した概念を 1 つのモジュールにまとめ、モジュール同士の依存を少なくする。名前はユビキタス言語から付け（集約写像の `domain_packages` に業務用語として宣言する）、モジュールの並びを見ればドメインの構成が読み取れるようにする。モデルが変われば、モジュールも組み替える。

一つのモジュールには、一つの集約を置く場合も、凝集した複数の集約を置く場合もある。個数で決めず、一緒に理解する業務上の理由でまとめる。同じモジュールに置いても、各集約の不変条件と整合性を守る境界は独立している。ヴァーノンの例では、`team` モジュールに `ProductOwner`、`Team`、`TeamMember` の三つの集約と `MemberService` を置いている。

モジュールの内部だけを詳しく読む見方と、内部を省いてモジュール同士の関係を見る見方の両方を支える。分割で概念の関係が分かりにくくなったら、まとめ方やモデル自体を見直す。依存の数を減らすことと概念の明確さが衝突する場合は、概念の明確さを優先する。

同じ階層のモジュール間では、依存が一方向になり、循環しない構成を目指す。親子間でも循環を避けるが、親が子を生成し、子が親の識別子を参照するような関係は、業務上の必要性を確かめて扱う。完全な独立や依存数だけを目標にしない。

モジュールは一つのモデルの内部を整理する。境界づけられたコンテキストは、モデルの用語と規則が一貫して通用する範囲を定める。用語の違いが曖昧でモデルを分ける根拠が定まらない場合は、まず同じコンテキスト内でモジュールを分ける案を検討する。モジュール数や集約数だけを理由にコンテキストを増やさない。

モジュールの設計理由は、集約写像の `domain_packages` の `model_refs` と `rationale` に記録する。どの概念をまとめるか、一緒に理解する理由、他のモジュールとの依存、分割・統合・改名の理由を示す。物理的なファイルの置き方は、モジュール配置ポリシーに従う。

一次資料: Eric Evans『Domain-Driven Design』第5章「Modules (a.k.a. Packages)」（109〜114ページ）、第7章「Modules in the Shipping Model」（179〜181ページ）、第14章「Bounded Contexts Are Not Modules」（336ページ）。Vaughn Vernon『Implementing Domain-Driven Design』第9章「Designing with Modules」の表9.1（334〜335ページ）、「Modules of the Agile Project Management Context」（340〜342ページ）、「Module before Bounded Context」（344ページ）。以下のファイル配置例は、このプロジェクトでの適用例である。

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

## ドメインサービスを選ぶ条件

業務上重要な操作が、既存のエンティティや値オブジェクトの自然な責務に収まらない場合に、ドメインサービスを検討する。操作名は業務の言葉にし、入力と結果はモデルの要素で表す。複数のオブジェクトを使うだけではサービスを選ぶ理由にならない。各オブジェクトが持つ判断はそこに残し、独立した操作としてまとめる必要性を具体例と代替案で確かめる。

たとえば、取得済みの利用組織と利用者を受け取り、組織の利用可否と利用者の資格確認を組み合わせる認証判断は候補になる。各オブジェクトの業務操作を使い、getter から状態を抜き出して判断を移さない。利用者の取得、保存、通知、再試行の調整はユースケース側が担う。この例は書籍の考え方を現在の層の規約に合わせたもので、書籍のリポジトリ利用をそのまま許可するものではない。

状態を持たないとは、サービス自身に保持した業務状態や呼び出し履歴が、次の操作の判断を変えないことをいう。前の利用者を記憶して次の認証に使うサービスは認めない。固定の設定や依存を持つフィールドの存在だけでは、業務状態を持つ証拠にならない。どの情報を保持し、判断が何に依存するかで確認する。書籍におけるこの性質は、副作用が一切ないこととは異なる。ただし、このプロジェクトの永続化禁止、ポートの所属、依存方向、集約が担える判断を移さない規則はそのまま維持する。

### 責務を計画に記録し、宣言の対応範囲を確かめる

サービスの追加・変更を検討する場合は、計画レポートの「ドメインサービスの判断」に次を記録する。不要と判断した候補にも、配置先と理由を残す。候補がない変更で、サービスや記録用の成果物を増やす必要はない。

| 記録する内容 | 確かめること |
|--------------|--------------|
| 業務名、操作、責務、採用・不採用の理由 | エンティティや値に置く案、ユースケースの調整で扱う案と比較する |
| 入力、結果、想定する業務上の失敗 | 既存モデル要素の識別子を引用し、各入力が担う判断とサービスが組み合わせる規則を分ける |
| 保持する情報、呼び出し間の独立性、入出力の境界 | 過去の呼び出しによる判断の変化、取得・永続化・外部通信、集約の整合性への影響を確認する |
| 配置モジュール、モデル参照、宣言できる範囲 | `domain_packages` の `model_refs` と `rationale` に配置の根拠を記録し、操作の宣言が不足しないか確認する |

現行の `domain-model.yaml` には独立したサービス宣言やサービス用の要素種別がない。既存の要素・不変条件・操作への参照で表せる責務と、独立した操作の宣言が必要な責務を区別する。計画レポートや `domain_packages` への記録だけで、操作の宣言も対応したとは扱わない。表現できない独立操作が必要なら、宣言契約の不足として具体的な責務と参照を報告し、再計画へ渡す。未対応の `domain_services` キー、架空の集約、サービスを偽装した値オブジェクトは生成しない。

根拠: エリック・エヴァンス『Domain-Driven Design』第5章「Services」（104〜107ページ）、ヴァーン・ヴァーノン『Implementing Domain-Driven Design』第7章「What a Domain Service Is (but First, What It Is Not)」「Make Sure You Need a Service」と認証の例（267〜275ページ）。選択条件と呼び出し履歴に依存しない性質を採用し、層の所属と宣言への記録方法はこのプロジェクトの規約に従う。

## 集約ごとの二軸

このワークフローの永続化方式は Event Sourcing に統一する。

リポジトリの公開境界は集約である。`findById`（Rust は `find_by_id`）は、最新のスナップショットにその後のイベントを内部で replay した集約を `Result<Aggregate | undefined, RepositoryError>`（Rust は `Result<Option<Aggregate>, RepositoryError>`）で返す。`store` は、集約 ID を持つ今回のドメインイベントと、そのイベントの直後の集約（スナップショット）を受け取り（`store(event, snapshot)`）、追記成功を `Result<void, RepositoryError>`（Rust は `Result<(), RepositoryError>`）で返す。集約 ID を別の引数で渡さない。`loadEvents` をリポジトリポートへ公開したり、ユースケースで履歴を replay したりしない。これを計画時のAPI・受入条件にも宣言する。

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
