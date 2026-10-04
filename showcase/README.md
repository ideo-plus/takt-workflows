# DDD ワークフローのコード例

会議室の予約を題材にした Rust・TypeScript の実装例です。実プロバイダで生成したコードを、ユーザーの指示に従って直接修正し、両方を Event Sourcing に統一しています。

| 言語 | コード・条件・検証結果 | テストの実行 |
|---|---|---|
| TypeScript | [TypeScript 版](ddd-typescript-default/README.md) | 対象ディレクトリで `node --test` |
| Rust | [Rust 版](ddd-rust-default/README.md) | 対象ディレクトリで `cargo test` |

予約ID・会員ID・会議室IDの値域は1以上の整数です。DP の `parse` は域外入力を操作固有のエラーで返し、`of` は同じ検証を通して、域外なら panic／throw します。

各例は、[ファクトリの命名規約](../ja/facets/knowledge/ddd-modeling.md#ファクトリ名の選択)に従います。VO の `of` と型付き入力の `parse`、Entity の業務名による生成、ES の履歴復元を使い分けています。自前の静的／関連ファクトリを検査する `factory-naming` も含め、両言語の DDD lint を確認しています。

リポジトリの読み込みは `Result<Reservation | undefined, RepositoryError>`、保存は `Result<void, RepositoryError>` を返します。Rust はそれぞれ `Option<Reservation>`、`()` を成功値にします。読み込み時に履歴から集約を復元し、保存時に集約IDとドメインイベントを受け取って追記します。インメモリでも保持するのはイベント列です。ユースケースは集約の操作と保存依頼を行います。

## 生成と直接修正の記録

元の生成は TAKT 0.67.0 と Codex のプロファイルで TypeScript、Rust の順に実行しました。元の業務要件・パッケージ配置は各版の `task.txt`、設定は `runtime.yaml` と `config.yaml` に保存しています。

今回は、保存用の余分な型を廃止して両言語を ES に統一する指示を受け、生成済みコードを直接編集しました。集約・ポート・保存実装・宣言・テストを更新し、後方互換の別名や保存経路を削除しています。

`generation.json` の `original_generation` に元の生成記録、`manual_revision` と `standalone_verification` に直接修正と検証結果、`current_source_file_sha256` に現在のソースのハッシュを記録しています。テスト、TS の型検査、Rust の整形、両言語の DDD lint は修正後のコードで確認しました。

保存された例は、記録した規約のバージョンを基準に扱います。CI は showcase に現行の DDD lint を適用しません。インストーラが利用者のプロジェクトへ導入するのは言語別のバンドルと linter です。
