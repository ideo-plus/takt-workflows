# DDD モデリング知識

## プロジェクトのファイル

DDD のプロジェクトは、タスクをまたいで育てるモデルと設定をファイルで持つ。形は AI-DLC の DDD プラグイン（スキーマ バージョン 2）に合わせており、後からその検査ツールで読める。

| ファイル | 役割 |
|----------|------|
| `.ddd.toml`（リポジトリ直下） | 言語と、言語ごとの選択（モジュール配置と TypeScript のコード表現） |
| `docs/ddd/domain-model.yaml` | ドメインモデル宣言。業務概念の唯一の定義 |
| `docs/ddd/aggregate-mapping.yaml` | モデルの各要素がコードのどこにあるか、およびドメインパッケージの業務語彙 |
| `docs/ddd/layer-structure.yaml` | 境界づけられたコンテキストごとのパッケージ、役割と依存、ポート、リポジトリ、復元経路 |

### .ddd.toml

```toml
schema_version = 2
languages = ["rust", "typescript"]

[rust]
module_layout = "file"            # または "mod-rs"

[typescript]
module_layout = "named-file"      # または "index-file"
code_representation = "class"     # または "companion"
```

挙げた言語のテーブルだけを置く。新しいプロジェクトでは `file` と `named-file` が一般的な選択である。

### ドメインモデル宣言

```yaml
schema_version: 2
bounded_contexts:
  - element_id: bc.billing
    name: Billing
    aggregates:
      - element_id: aggregate.invoice
        name: Invoice
        bounded_context: bc.billing
        root_element: entity.invoice
        states: [draft, issued]
        elements:
          - element_id: entity.invoice
            kind: entity
            name: Invoice
            aggregate: aggregate.invoice
            attributes:
              - { name: customer, type: primitive.customer-id, required: true }
              - { name: lines, type: vo.invoice-line, required: true, collection: true }
          - element_id: vo.invoice-line
            kind: value-object
            name: InvoiceLine
            aggregate: aggregate.invoice
            attributes: [{ name: amount, type: decimal, required: true }]
        invariants:
          - element_id: invariant.invoice.total-not-negative
            statement: 明細の合計は負にならない。
        factory_rules:
          - element_id: factory.invoice.open
            target_element: entity.invoice
            preconditions: [顧客が指定されている。]
            domain_errors:
              - { element_id: error.invoice.open.missing-customer, name: MissingCustomer, operation: factory.invoice.open, condition: 顧客が指定されていない。 }
        commands:
          - element_id: command.invoice.issue
            name: Issue
            effect: transition
            state_effect: transitions
            transitions: [transition.invoice.issue]
            idempotency: { strategy: none }
            domain_errors:
              - { element_id: error.invoice.issue.already-issued, name: AlreadyIssued, operation: command.invoice.issue, condition: 請求書は発行済みである。 }
            events: [event.invoice.issued]
        events:
          - { element_id: event.invoice.issued, name: InvoiceIssued, produced_by: command.invoice.issue }
        transitions:
          - { element_id: transition.invoice.issue, from_state: draft, to_state: issued, command: command.invoice.issue }
    process_managers: []
lineage: []
```

要素 ID は小文字のケバブケースで `<kind>.<segments>` と書く。`bc`、`aggregate`、`entity`、`vo`、`primitive`、`pm` は区切り 1 つ、`invariant`、`command`、`event`、`transition`、`factory` は集約と名前の 2 つ、`error` は集約、操作、名前の 3 つをとる。`lineage` の項目（`lineage-0001`、関係は `renamed`、`split`、`merged`、`deprecated`）が ID の変化を記録する。

### 集約写像

```yaml
schema_version: 2
model_ref: docs/ddd/domain-model.yaml
aggregate_mappings:
  - aggregate_ref: aggregate.invoice
    programming_model: class
    persistence_method: state-sourcing
    reference_ids: [entity.invoice, vo.invoice-line, invariant.invoice.total-not-negative]
    replay_methods: []
    code: { language: rust, package: billing-domain, module: [invoice], type: Invoice, ports: [], repository: InvoiceRepository }
    operations:
      - operation_ref: factory.invoice.open
        code: { method: open, error_type: OpenInvoiceError }
        errors: [{ error_ref: error.invoice.open.missing-customer, code: { case: MissingCustomer } }]
      - operation_ref: command.invoice.issue
        code: { method: issue, error_type: IssueInvoiceError }
        errors: [{ error_ref: error.invoice.issue.already-issued, code: { case: AlreadyIssued } }]
domain_packages:
  - { term: 請求, model_refs: [bc.billing], rationale: 顧客への請求に関わるもの全体, code: { language: rust, package: billing-domain, module: [] } }
  - { term: 請求書, model_refs: [aggregate.invoice], rationale: 請求書と明細は一緒に変わる, code: { language: rust, package: billing-domain, module: [invoice] } }
```

`module` はパッケージのルートより下の区切りを並べたもので、ルートは `[]` になる。ルートから下のすべての階層を宣言する。TypeScript では case の文字列がリテラルの union のメンバー（`already-issued`）になり、Rust では enum のバリアント（`AlreadyIssued`）になる。

### 層構造

```yaml
schema_version: 2
model_ref: docs/ddd/domain-model.yaml
layer_structures:
  - context_ref: bc.billing
    cqrs: true
    packages:
      - { role: command, code: { language: rust, package: billing-domain } }
      - { role: query, code: { language: rust, package: billing-query } }
      - { role: rmu, code: { language: rust, package: billing-rmu } }
    dependencies:
      - { code: { language: rust, package: billing-domain }, depends_on: [] }
      - { code: { language: rust, package: billing-query }, depends_on: [] }
      - { code: { language: rust, package: billing-rmu }, depends_on: [{ language: rust, package: billing-domain }, { language: rust, package: billing-query }] }
    ports:
      - { name: InvoiceRepository, kind: repository, verbs: [find_by_id, store, delete_by_id] }
    repositories:
      - { name: InvoiceRepository, aggregate_ref: aggregate.invoice, io_unit: single, verbs: [find_by_id, store, delete_by_id], store_semantics: upsert }
    restoration_paths:
      - { aggregate_ref: aggregate.invoice, via: full-constructor }
    persistence_backend: PostgreSQL
```

## モデルの導き方

モデルはデータの表からではなく振る舞いから導く。ストーリーから過去形のドメインイベントを挙げ、各イベントを生むコマンドとアクターを特定し、同じ状態を変えるイベントを集約にまとめる。集約の不変条件が、それらが一緒にある理由を説明する。

| 条件 | 意味・選択肢 |
|------|-------------|
| 候補が守る不変条件を述べられない | 別の集約へ統合するか、値や Entity に格下げする |
| 規則を守るために 2 つの候補が一緒に変わる必要がある | 1 つの集約にする。分けたままにするなら Process Manager |
| フローが集約をまたぐ | Process Manager の候補。ステップと補償をモデルに記録する |
| 操作が状態を変えない | `state_effect: none` とする。これは有効な宣言である |
| 用語がコードにだけあり、業務の語彙にない | パッケージの名前にする前に意味を確かめる |

## 集約ごとの二軸

実行モデルと永続化は独立した選択であり、どちらも TypeScript のコード表現とは独立している。

| 軸 | 値 | 意味 |
|----|----|------|
| `programming_model` | `class` | 集約はユースケースから呼ばれるオブジェクト |
| | `actor` | 集約はメッセージを受け取る。複数集約のフローには Process Manager が要る |
| `persistence_method` | `state-sourcing` | 現在の状態を保存する。`store` は期待バージョン付きで再永続化する |
| | `event-sourcing` | イベントを追記する。状態は宣言した replay メソッドで再生して組み立てる |

ステートソーシングでもドメインイベントは出せる。イベントソーシングは、判断（コマンドが規則を確かめてイベントを返す）と適用（replay メソッドが事実から状態を変え、何も判断しない）を分ける。

## 冪等性と回復

| 条件 | 意味・選択肢 |
|------|-------------|
| `effect: transition` | 同じコマンドを繰り返しても目的の状態に達しているので、遷移そのものが守る |
| `effect: accumulation` | 繰り返すと二重に加わる。コマンド ID を記憶し（`command-id-memory`）、複数件か時間窓で保持する |
| 直前のコマンド ID だけを覚えている | C2 の後に届いた C1 の再送を防げない |
| 永続化の結果が不明 | 再試行する前に要求 ID で照合する |
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
| domain | 集約、Entity、値オブジェクト、Domain Primitive、状態を持たないドメインサービス、ドメインが必要とするポート | infrastructure |
| use-case | 読み込み、ドメイン操作の呼び出し、保存、回復。コマンド側の `execute(ID, 値)`、クエリのユースケース | domain、infrastructure |
| interface-adapter | コントローラ、リポジトリ実装、DAO、データベースと RPC のクライアント | use-case、domain、infrastructure |
| infrastructure | 言語拡張だけ（TypeScript の `Result` など） | なし |
| composition root | 実装とポートの結線 | すべての層 |
| 読み取りモデル更新器 | イベントを読み取りモデルへ投影する | 両側 |

クエリ側は use-case と interface-adapter の層だけを持ち、自分のドメイン層を持たない。
