{extends:scenario-based-replan-implementation}

## DDD モデルの変更

プロジェクトは DDD の設定を `.ddd.toml` に、モデルを `docs/ddd/domain-model.yaml`、`docs/ddd/aggregate-mapping.yaml`、`docs/ddd/layer-structure.yaml` に持つ。計画はこれらのファイルへの変更を正確に示し、実装はそれをコードより先に反映する。

- 4 つのファイルを読む。`.ddd.toml` がなければ、変更が触れる言語、Rust の `module_layout = "file"`、TypeScript の `module_layout = "named-file"` と `code_representation = "class"` で作る計画にする。要求が別の選択を示していればそれに従う。既存のファイルから配置を推測しない。モデルのファイルがなければ作る計画にする。
- 要求の業務上の振る舞いを、次の順で導く。過去形のドメインイベント、それを生むコマンドとアクター、その状態を変える集約、集約をまとめる不変条件。
- 受理済みモデルの既存の要素 ID を再利用する。業務上の改名は `name` だけを変え、分割、統合、廃止はすべて `lineage` に記録する。未受理の計画や今回の生成物がスキーマに違反している場合は、不正な ID と全参照を有効な `<kind>.<segments>` に訂正する。これは既存要素の改名ではなく宣言の修正であり、旧 ID の別名や互換経路を残さない。
- 宣言の YAML は knowledge のスキーマ例に従う。スキーマ違反を業務要件の未決事項にせず、計画中に修正し、修正前後の ID 対応と根拠を記録する。
- `## DDD Model Changes` の節を設け、ファイルごとに追加・変更する YAML を書く。
  - ドメインモデル: 追加・変更する集約とその不変条件、追加・変更するコマンドとファクトリ規則それぞれのドメインエラー、状態効果、遷移、コマンドが生む 1 つのイベント（`event`）、冪等性の戦略
  - 集約写像: 各集約の `programming_model` と `persistence_method`、パッケージ、モジュールのパス、型、ポート、リポジトリ。各操作のメソッド、エラー型、エラーの case、各コマンドの `success_type`。イベントソーシングの集約の `replay_methods`。変更がコードを置くすべてのパッケージとモジュールの階層について、業務用語、モデル参照、根拠を持つ `domain_packages` の項目
  - 層構造: 変更が追加・変更するパッケージ、依存、ポート、リポジトリ、復元経路
- `## DDD Use Cases` の節を設け、変更が追加・変更するユースケースごとに、`use_case_id`、`name`、`target_aggregates`、`commands`、`re_execution_basis`、`recovery_policy`、複数の集約を対象にするときの `multi_aggregate_strategy`、`read_model_exposure` を宣言する。
- 完了契約表では、最初の行で DDD モデルの変更を反映する。実装の各行は実装するモデル ID を引用し、実装箇所は集約写像と選んだモジュール配置に従う。
- Domain Primitive ごとに、基本データ型より狭いドメインの不変条件を必ず決める。その Primitive を `element` に取る不変条件と、それらすべてを `preconditions` に取る `parse` のファクトリ規則を宣言する。実装には `of` と `parse` を両方置き、初期化前に同じ不変条件を検証する。`of` は検証済み値を前提とする契約、`parse` は不正入力を `Result` で返す契約である。基本型の値域だけで足りるなら DP を作らない。要求から値域を決められないときは未決事項として確認し、規則を黙って省いたり無制約の DP にしたりしない。
- 要求が業務上の規則（不変条件、エラーの条件、冪等性の要件）を決めていないときは、計画が置く前提とともに未決事項として挙げる。作り出した規則を要件として示さない。
- `.takt/` の中は読まない。DDD の規則はこのステップに渡された policy と knowledge にあり、ddd-lint の検査はソースを読まず実行して確かめる。
