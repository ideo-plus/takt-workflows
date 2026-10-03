# ワークフローが生成したコード

会議室の予約を題材に、DDD ワークフローを実プロバイダで動かして得たコードです。集約、予約を取り消すユースケース、保存と復元のポート、インメモリのアダプタを含みます。

| ワークフロー | 生成コード・条件・検証結果 | テストの実行 |
|---|---|---|
| `ddd-typescript-default` | [TypeScript 版](ddd-typescript-default/README.md) | 対象ディレクトリで `node --test` |
| `ddd-rust-default` | [Rust 版](ddd-rust-default/README.md) | 対象ディレクトリで `cargo test` |

タスク文には業務要件とパッケージの配置だけを指定しました。DDD の規約はワークフローの facet が与えています。請求書を題材にしたナレッジのコード例とは、別の題材です。

## 生成時点のコードを保存する

各版に、与えたタスク文、生成に使ったバンドルのコミット、モデル設定、実行日、所要時間、検証結果を記録しています。今回は Codex のプロファイルで実行したため、リポジトリの `runtime.project.yaml` のモデル設定とは異なります。実行した設定は各版の `runtime.yaml` を参照してください。

生成時は `scripts/use-lang.sh ja` でサンドボックスへバンドルを導入し、保存したモデル設定を適用して `takt workflow doctor` で確認しました。TAKT 0.67.0 の `takt --pipeline --skip-git -w <ワークフロー> -t <task.txt の内容>` を、TypeScript、Rust の順に1本ずつ実行しています。各実行の上限は10,800秒です。終了後は `scripts/sandbox-check.mjs verify --mode real` で経路・モデル割当・テスト・DDD 検査を確認し、保存先でもテストと DDD 検査を実行しました。

生成コードはスナップショットとして保存します。規約を更新するたびに書き換えず、大きな変更があったときに再生成します。CI はこのディレクトリに現行の ddd-lint をかけません。生成時の ddd-lint の結果は各版の README に記録しています。

インストーラは `en/` または `ja/` のバンドルと ddd-lint を導入します。showcase は利用者のプロジェクトにコピーされません。
