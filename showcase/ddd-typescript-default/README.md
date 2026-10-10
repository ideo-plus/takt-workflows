# TypeScript 版の会議室予約 — Event Sourcing

`ddd-typescript-default` を Codex で実行して生成した会議室予約コードを、ユーザーの指示に従って直接修正した例です。予約集約、取消ユースケース、集約単位のリポジトリ、イベント列とスナップショットを保持するインメモリ実装を含みます。

## コードを読む

| 役割 | 主なファイル |
|---|---|
| 予約集約・生成イベント・取消・再生 | [reservation.ts](packages/command/reservation-domain/src/reservation.ts) |
| 予約IDの of／parse | [reservation-id.ts](packages/command/reservation-domain/src/reservation/reservation-id.ts) |
| 会員IDの of／parse | [member-id.ts](packages/command/reservation-domain/src/member-id.ts) |
| 会議室IDの of／parse | [room-id.ts](packages/command/reservation-domain/src/room-id.ts) |
| リポジトリポート | [reservation-repository.ts](packages/command/reservation-use-case/src/reservation-repository.ts) |
| 取消ユースケース | [cancel-reservation.ts](packages/command/reservation-use-case/src/cancel-reservation.ts) |
| イベント列とスナップショットの保存、差分の再生 | [in-memory-reservation-repository.ts](packages/command/reservation-interface-adapter/src/in-memory-reservation-repository.ts) |

TypeScript の ID は `number` 型の1以上の整数を受け取り、0・負数・小数・NaN・Infinity を拒否します。`parse` は不正入力を操作固有のエラーを持つ Result で返し、`of` は同じ検証を通して域外なら throw します。JavaScript の呼び出し元から数値以外が渡る場合も実行時に検証します。

ファクトリの名前は、[命名規約](../../ja/facets/knowledge/ddd-modeling.md#ファクトリ名の選択)に対応しています。DP の `of` は値を返し、`parse` は同じ数値入力を検証して Result を返します。予約集約の生成は業務名の `reserve` を使います。スナップショットに後続のイベントを適用する `replay` は、既存の予約を進める関数で、生成経路ではありません。変換が必要になったときに `from` を追加します。

リポジトリポートの保存は `store(event, snapshot)` です。イベントが予約IDを持つので、IDを別の引数では渡しません。スナップショットは、そのイベントを反映した直後の予約集約です。予約と各イベントはシーケンス番号を持ち、生成イベントが1、取消イベントが2です。

インメモリ実装は、予約ごとのイベント列と、予約集約そのもののスナップショットを保持します。スナップショットを残すのは、生成イベントのときと、コンストラクタで受け取った間隔の倍数の番号のときです。`findById` は最新のスナップショットを読み、その番号より後のイベントだけを `Reservation.replay` で適用します。イベント列が長くなっても、全履歴を毎回再生せずに済みます。`store` は、スナップショットがイベント直後の予約であること（予約IDと番号の一致）と、イベントが保存済みの列に続くこと（番号の連続）を確かめてから追記します。

取消ユースケースは集約でコマンドを実行し、取消イベントと取消後の予約の保存が成功してから結果を返します。生成イベント・取消イベントはドメイン型のまま扱います。インメモリ実装が公開するのは、ポートのメソッドとコンストラクタだけです。

テストは、保存した状態を `findById` だけで確かめます。生成時のスナップショットへの差分の再生、間隔1での取消後スナップショットの読込、予約ID・番号の不一致や保存済みの列に続かないイベントの拒否、未保存の変更の分離、未存在・再取消・保存失敗を確認しています。

## 取得済みの二つの集約から利用資格を判断する

会議室予約とは別の「利用資格」コンテキストを追加しています。利用組織と利用者は独立した集約で、どちらも他方を所有しません。予約側の会員・会議室・予約の識別子とは別のモデルであり、コンテキスト間の情報受け渡しは扱いません。

[access モジュール](packages/command/access-domain/src/access.ts)は、利用組織、利用者、両者を組み合わせる判定サービスをまとめます。複数の集約を一つの業務モジュールで理解しながら、集約の境界は保つ例です。

公開操作は`AccessEligibility.create().assess(organization, user)`です。組織の利用可否は組織、利用者の利用可否と所属は利用者が判断します。所属判断は、利用者が保持する組織識別子を組織自身の照合へ渡します。サービスは識別子のgetterを呼ばず、三つの判断と拒否の優先順位だけを組み合わせます。拒否は組織無効、所属相違、利用者利用不可の順です。

入力は公開ファクトリで完全に構築するか、生成イベントから復元します。識別子には空文字を含む文字列を使え、追加の書式制約はありません。無効な組織や利用不可の利用者も、判定用の有効な入力として構築できます。生成イベントは入力準備に属し、判定は入力を変えず、新しいイベントも生みません。保存・通信・登録ユースケースは追加していません。

TypeScriptでは基本型に合わない入力をファクトリ固有の拒否で返します。判定用のコードと21件のテストは、空のプロジェクトで成功した実タスクから取り込み、パッケージ名とモジュール配置をこの例へ合わせました。元の実行は45分52秒、再実装・再計画0回で完了しています。要求は [access-task.txt](access-task.txt) に保存しています。

## テストを実行する

基本コンストラクタは、状態全体を受け取る唯一の `private constructor` です。DP の `of → parse → constructor`、予約の `reserve → fromReserved → constructor`、取消の `applyCancelled → constructor` が同じ基本コンストラクタを呼びます。`replay` は受け取ったスナップショットを `applyCancelled` で進めるので、生成経路には数えません。`primary-constructor` で唯一性、全フィールドの初期化、補助経路の循環と到達性を検査しています。[規約](../../ja/facets/policies/ddd-domain-layer.md#基本コンストラクタと補助の生成経路)を参照してください。

このディレクトリで実行します。

```sh
npm ci --ignore-scripts
node --test
npm run typecheck
```

保存前に、イベントが示す会員・部屋・時間帯・状態とスナップショットの一致を確認します。取消は保存済みの予約へイベントを適用して照合し、不整合を拒否した場合は履歴と保存状態を変更しません。 利用資格の履歴復元では、入力の各値を一度取得し、検証と構築で同じ値を使います。

書籍レビューで再現した不整合を直接修正し、公開操作から検証する回帰テストを追加しました。元の生成結果と今回の修正は、生成記録で区別しています。

## 現在の検証

| 項目 | 結果 |
|---|---|
| 確認日 | 2026-10-10 |
| テスト | 55件（予約32件・利用資格23件）成功、失敗0件 |
| 型検査 | npm run typecheck 成功 |
| ドメイン検査 | 指摘0件、判定不能0件 |
| 検査した規約 | [ae21a8b](https://github.com/ideo-plus/takt-workflows/tree/ae21a8b74d20b9b5e1016e0e8fe4e41f4ea38157) |

継続的なチェックでも、テストと型検査、現行のドメイン検査を実行します。元の生成記録と過去の直接修正は、生成記録の履歴として残しています。

## 元の生成記録

初回の生成バンドルは [aadf557](https://github.com/ideo-plus/takt-workflows/tree/aadf55743a82400c21f7134736cb3a6188463dc4)、ワークフローは `ddd-typescript-default`、言語は `ja` です。生成は39分46秒で完走し、サンドボックスの25項目を通過しました。その後、標準例を Event Sourcing に統一して保存用の余分な型を削除し、さらにイベントとスナップショットを一緒に保存する形へ直接編集しています。

元のタスクは [task.txt](task.txt)、実行設定は [runtime.yaml](runtime.yaml) と [config.yaml](config.yaml) です。[generation.json](generation.json) は元の生成条件・モデル割当・ハッシュと、直接修正の理由・変更ファイル・現在のハッシュ・検証結果を記録しています。保存方法は [showcase の案内](../README.md) を参照してください。
