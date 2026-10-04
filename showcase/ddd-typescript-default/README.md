# TypeScript 版の会議室予約 — Event Sourcing

`ddd-typescript-default` を Codex で実行して生成した会議室予約コードを、ユーザーの指示に従って直接修正した例です。予約集約、取消ユースケース、集約単位のリポジトリ、イベント列を保持するインメモリ実装を含みます。

## コードを読む

| 役割 | 主なファイル |
|---|---|
| 予約集約・生成イベント・取消・再生 | [reservation.ts](packages/command/reservation-domain/src/reservation.ts) |
| 予約IDの of／parse | [reservation-id.ts](packages/command/reservation-domain/src/reservation/reservation-id.ts) |
| 会員IDの of／parse | [member-id.ts](packages/command/reservation-domain/src/member-id.ts) |
| 会議室IDの of／parse | [room-id.ts](packages/command/reservation-domain/src/room-id.ts) |
| リポジトリポート | [reservation-repository.ts](packages/command/reservation-use-case/src/reservation-repository.ts) |
| 取消ユースケース | [cancel-reservation.ts](packages/command/reservation-use-case/src/cancel-reservation.ts) |
| イベント履歴の保存と集約復元 | [in-memory-reservation-repository.ts](packages/command/reservation-interface-adapter/src/in-memory-reservation-repository.ts) |

TypeScript の ID は `number` 型の1以上の整数を受け取り、0・負数・小数・NaN・Infinity を拒否します。`parse` は不正入力を操作固有のエラーを持つ Result で返し、`of` は同じ検証を通して域外なら throw します。JavaScript の呼び出し元から数値以外が渡る場合も実行時に検証します。

ファクトリの名前は、[命名規約](../../ja/facets/knowledge/ddd-modeling.md#ファクトリ名の選択)に対応しています。DP の `of` は値を返し、`parse` は同じ数値入力を検証して Result を返します。予約集約の生成は業務名の `reserve`、ES の復元は `restore` を使います。変換が必要になったときに `from` を追加します。

リポジトリは予約ごとのイベント列を追記保存し、読み込み時に再生した集約を返します。取消ユースケースは集約でコマンドを実行し、生まれたイベントの保存が成功してから結果を返します。生成イベント・取消イベントはドメイン型のまま扱います。

テストでは、イベントからの復元、未保存の変更の分離、保存後の取消状態、既存履歴の保持、重複・別IDのイベント拒否、未存在・再取消・保存失敗を確認しています。

## テストを実行する

基本コンストラクタは、状態全体を受け取る唯一の `private constructor` です。DP の `of → parse → constructor`、予約の `reserve → fromReserved → constructor`、復元と取消の補助経路が同じ基本コンストラクタを呼びます。`primary-constructor` で唯一性、全フィールドの初期化、補助経路の循環と到達性を検査しています。[規約](../../ja/facets/policies/ddd-domain-layer.md#基本コンストラクタと補助の生成経路)を参照してください。

このディレクトリで実行します。

```sh
npm ci --ignore-scripts
node --test
npm run typecheck
```

## 直接修正後の検証

| 項目 | 結果 |
|---|---|
| 修正後の確認日時 | 2026-10-04 16:49 JST |
| テスト | 26件成功、失敗0件 |
| 型検査 | npm run typecheck 成功 |
| DDD lint | 指摘0件、判定不能0件 |
| 検査した規約 | [871d0d8](https://github.com/ideo-plus/takt-workflows/tree/871d0d866516c9264f4f10dbd77126a117ae4af6) |

## 元の生成記録

初回の生成バンドルは [aadf557](https://github.com/ideo-plus/takt-workflows/tree/aadf55743a82400c21f7134736cb3a6188463dc4)、ワークフローは `ddd-typescript-default`、言語は `ja` です。生成は39分46秒で完走し、サンドボックスの25項目を通過しました。その後、標準例を Event Sourcing に統一し、保存用の余分な型を削除するため直接編集しています。

元のタスクは [task.txt](task.txt)、実行設定は [runtime.yaml](runtime.yaml) と [config.yaml](config.yaml) です。[generation.json](generation.json) は元の生成条件・モデル割当・ハッシュと、直接修正の理由・変更ファイル・現在のハッシュ・検証結果を記録しています。保存方法は [showcase の案内](../README.md) を参照してください。
