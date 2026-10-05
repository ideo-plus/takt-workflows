# Rust 版の会議室予約 — Event Sourcing

`ddd-rust-default` を Codex で実行して生成した会議室予約コードを、ユーザーの指示に従って直接修正した例です。予約集約、取消ユースケース、集約単位のリポジトリ、イベント列とスナップショットを保持するインメモリ実装を含みます。

## コードを読む

| 役割 | 主なファイル |
|---|---|
| 予約集約・生成イベント・取消・再生 | [reservation.rs](packages/command/reservation-domain/src/reservation.rs) |
| 予約IDの of／parse | [reservation_id.rs](packages/command/reservation-domain/src/reservation/reservation_id.rs) |
| 会員IDの of／parse | [member_id.rs](packages/command/reservation-domain/src/member_id.rs) |
| 会議室IDの of／parse | [room_id.rs](packages/command/reservation-domain/src/room_id.rs) |
| リポジトリポート | [reservation_repository.rs](packages/command/reservation-use-case/src/reservation_repository.rs) |
| 取消ユースケース | [cancel_reservation.rs](packages/command/reservation-use-case/src/cancel_reservation.rs) |
| イベント・スナップショットの保存と集約の読込 | [in_memory_reservation_repository.rs](packages/command/reservation-interface-adapter/src/in_memory_reservation_repository.rs) |

Rust の ID は `u64` を受け取り、0を拒否します。 `parse` は不正入力を操作固有のエラーを持つ Result で返し、`of` は同じ検証を通して域外なら panic します。

ファクトリの名前は、[命名規約](../../ja/facets/knowledge/ddd-modeling.md#ファクトリ名の選択)に対応しています。DP の `of` は Self を返し、`parse` は同じ `u64` 入力を検証して Result を返します。予約集約は業務名の `reserve`、時間帯の VO は `create` を使います。ES の `replay` は受け取ったスナップショットに続くイベントを適用する関数で、ファクトリではありません。別型からの変換を追加する場合は、失敗しない `from` と、Result を返す `try_from` を使い分けます。

予約とイベントはシーケンス番号を持ちます。予約の生成イベントが1で、取消イベントは2です。

リポジトリの保存は `store(event, snapshot)` です。イベント自身が予約IDを持つので、IDを別の引数では受け取りません。`snapshot` は、そのイベントを反映した直後の予約です。インメモリ実装はイベントを予約ごとの列に追記し、生成時と、`new` で指定した間隔の番号ごとにスナップショットを更新します。保存の前に、スナップショットがイベント直後の状態であること（IDと番号の一致）と、イベントが保存済みの列の次の番号であることを確かめます。

`find_by_id` は最新のスナップショットを読み、その番号より後のイベントだけを `Reservation::replay` で適用します。イベント列が長くなっても、毎回先頭から再生しません。実装が公開するのはポートと `new` だけで、テストも `find_by_id` を通して結果を確かめます。

取消ユースケースは集約でコマンドを実行し、取消イベントと取消後の予約を保存します。保存が成功してから結果を返します。生成イベント・取消イベントはドメイン型のまま扱います。

テストでは、番号の採番、スナップショットに続くイベントの適用と不正な続きの拒否、未保存の変更の分離、スナップショット間の取消の再生、スナップショットにある取消の読込、イベント直後ではないスナップショットと番号が続かないイベントの拒否、別の予約の列の保持、間隔0の拒否、未存在・再取消・保存失敗を確認しています。

## テストを実行する

基本コンストラクタは、各ドメイン型の非公開の `new` です。DP の `of → parse → new`、時間帯の `create → new`、予約の `reserve → from_reserved → new` が、唯一の基本経路へ到達します。`replay` は値で受け取ったスナップショットを進めるだけなので、生成経路には含めません。`Self(...)` と構造体リテラルの直接初期化は基本経路だけに置いています。[基本コンストラクタの規約](../../ja/facets/policies/ddd-domain-layer.md#基本コンストラクタと補助の生成経路)を参照してください。

このディレクトリで実行します。

```sh
cargo test
cargo fmt --all -- --check
```

## 直接修正後の検証

| 項目 | 結果 |
|---|---|
| 修正後の確認日時 | 2026-10-05 17:59 JST |
| テスト | 40件成功（doctest 3件を含む）、失敗0件 |
| 整形 | cargo fmt 成功 |
| DDD lint | 指摘0件、判定不能0件 |
| 検査した規約 | [a87ca12](https://github.com/ideo-plus/takt-workflows/tree/a87ca122fa606332e56d68746153e99768ded3f1) |

## 元の生成記録

初回の生成バンドルは [aadf557](https://github.com/ideo-plus/takt-workflows/tree/aadf55743a82400c21f7134736cb3a6188463dc4)、ワークフローは `ddd-rust-default`、言語は `ja` です。生成は41分47秒で完走し、サンドボックスの25項目を通過しました。その後、標準例を Event Sourcing に統一し、保存用の余分な型を削除するため直接編集しています。さらに、イベントとスナップショットを一緒に保存し、読込でスナップショット以降のイベントだけを再生する形へ直接修正しました。

元のタスクは [task.txt](task.txt)、実行設定は [runtime.yaml](runtime.yaml) と [config.yaml](config.yaml) です。[generation.json](generation.json) は元の生成条件・モデル割当・ハッシュと、直接修正の理由・変更ファイル・現在のハッシュ・検証結果を記録しています。保存方法は [showcase の案内](../README.md) を参照してください。
