# Rust 版の会議室予約 — Event Sourcing

`ddd-rust-default` を Codex で実行して生成した会議室予約コードを、ユーザーの指示に従って直接修正した例です。予約集約、取消ユースケース、集約単位のリポジトリ、イベント列を保持するインメモリ実装を含みます。

## コードを読む

| 役割 | 主なファイル |
|---|---|
| 予約集約・生成イベント・取消・再生 | [reservation.rs](packages/command/reservation-domain/src/reservation.rs) |
| 予約IDの of／parse | [reservation_id.rs](packages/command/reservation-domain/src/reservation/reservation_id.rs) |
| 会員IDの of／parse | [member_id.rs](packages/command/reservation-domain/src/member_id.rs) |
| 会議室IDの of／parse | [room_id.rs](packages/command/reservation-domain/src/room_id.rs) |
| リポジトリポート | [reservation_repository.rs](packages/command/reservation-use-case/src/reservation_repository.rs) |
| 取消ユースケース | [cancel_reservation.rs](packages/command/reservation-use-case/src/cancel_reservation.rs) |
| イベント履歴の保存と集約復元 | [in_memory_reservation_repository.rs](packages/command/reservation-interface-adapter/src/in_memory_reservation_repository.rs) |

Rust の ID は `u64` を受け取り、0を拒否します。 `parse` は不正入力を操作固有のエラーを持つ Result で返し、`of` は同じ検証を通して域外なら panic します。

ファクトリの名前は、[命名規約](../../ja/facets/knowledge/ddd-modeling.md#ファクトリ名の選択)に対応しています。DP の `of` は Self を返し、`parse` は同じ `u64` 入力を検証して Result を返します。予約集約は業務名の `reserve`、時間帯の VO は `create`、ES の復元は `restore` を使います。別型からの変換を追加する場合は、失敗しない `from` と、Result を返す `try_from` を使い分けます。

リポジトリは予約ごとのイベント列を追記保存し、読み込み時に再生した集約を返します。取消ユースケースは集約でコマンドを実行し、生まれたイベントの保存が成功してから結果を返します。生成イベント・取消イベントはドメイン型のまま扱います。

テストでは、イベントからの復元、未保存の変更の分離、保存後の取消状態、既存履歴の保持、重複・別IDのイベント拒否、未存在・再取消・保存失敗を確認しています。

## テストを実行する

基本コンストラクタは、各ドメイン型の非公開の `new` です。DP の `of → parse → new`、時間帯の `create → new`、予約の `reserve → from_reserved → new` と `restore → from_reserved → new` が、唯一の基本経路へ到達します。`Self(...)` と構造体リテラルの直接初期化は基本経路だけに置いています。[基本コンストラクタの規約](../../ja/facets/policies/ddd-domain-layer.md#基本コンストラクタと補助の生成経路)を参照してください。

このディレクトリで実行します。

```sh
cargo test
cargo fmt --all -- --check
```

## 直接修正後の検証

| 項目 | 結果 |
|---|---|
| 修正後の確認日時 | 2026-10-04 16:49 JST |
| テスト | 34件成功、失敗0件 |
| 整形 | cargo fmt 成功 |
| DDD lint | 指摘0件、判定不能0件 |
| 検査した規約 | [871d0d8](https://github.com/ideo-plus/takt-workflows/tree/871d0d866516c9264f4f10dbd77126a117ae4af6) |

## 元の生成記録

初回の生成バンドルは [aadf557](https://github.com/ideo-plus/takt-workflows/tree/aadf55743a82400c21f7134736cb3a6188463dc4)、ワークフローは `ddd-rust-default`、言語は `ja` です。生成は41分47秒で完走し、サンドボックスの25項目を通過しました。その後、標準例を Event Sourcing に統一し、保存用の余分な型を削除するため直接編集しています。

元のタスクは [task.txt](task.txt)、実行設定は [runtime.yaml](runtime.yaml) と [config.yaml](config.yaml) です。[generation.json](generation.json) は元の生成条件・モデル割当・ハッシュと、直接修正の理由・変更ファイル・現在のハッシュ・検証結果を記録しています。保存方法は [showcase の案内](../README.md) を参照してください。
