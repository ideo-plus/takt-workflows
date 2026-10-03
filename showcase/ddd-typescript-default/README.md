# TypeScript 版の会議室予約

`ddd-typescript-default` を Codex で実行して生成したコードです。予約集約、ID で予約を取り消すユースケース、保存・読込のポート、インメモリ実装を含みます。

## コードを読む

| 役割 | 主なファイル |
|---|---|
| 予約の生成・取消し | [reservation.ts](packages/command/reservation-domain/src/reservation.ts) |
| 予約取消しのユースケース | [cancel-reservation.ts](packages/command/reservation-use-case/src/cancel-reservation.ts) |
| 保存・読込のポート | [reservation-repository.ts](packages/command/reservation-use-case/src/reservation-repository.ts) |
| インメモリ実装 | [in-memory-reservation-repository.ts](packages/command/reservation-interface-adapter/src/in-memory-reservation-repository.ts) |
| 共通の Result 型 | [language-extensions](packages/infrastructure/language-extensions/src/index.ts) |
| 集約・ユースケースのテスト | [tests/](tests/) |

業務の3パッケージに加え、型だけを共有する基盤パッケージを1つ使っています。取消しは元の予約を変更せず、取消済みの新しい予約とイベントを返します。ユースケースは新しい予約を保存してからイベントを返します。

## テストを実行する

Node 24 で、ビルドを行わず `.ts` のソースを直接実行します。このディレクトリで次のコマンドを実行してください。

```sh
npm ci --ignore-scripts
node --test
npm run typecheck
```

## 生成条件と検証結果

| 項目 | 記録 |
|---|---|
| バンドルのコミット | [`ddd4a8d`](https://github.com/ideo-plus/takt-workflows/tree/ddd4a8d603d79ef27856f3804612d2302565ede0) |
| ワークフロー・言語 | `ddd-typescript-default`・`ja` |
| 生成完了 | 2026-10-04 01:35 JST |
| TAKT | `0.67.0` |
| Codex CLI | `codex-cli 0.160.0` |
| Node / Bun | `v24.19.0` / `1.4.2` |
| 最終実行の所要時間 | 80分7秒 |
| 生成に使った実行時間の合計 | 117分5秒 |
| サンドボックス検証 | 41項目成功、0項目失敗。最終ゲート通過 |
| 保存後のテスト | 16件成功、失敗・skip・cancelled 0件 |
| 保存後の型検査 | `npm run typecheck` 成功 |
| 保存後の DDD 検査 | 指摘0件、判定不能0件 |

タスクのパッケージ指定を「業務3つ＋基盤最大1つ」と明確にし、同じサンドボックスの生成コードを引き継いで再実行しました。合計時間は、その前段の実行37分と最終実行を合わせたものです。

[task.txt](task.txt) は最終実行に与えたタスク文です。業務要件とパッケージの配置・追加枠を記載しています。実行に使ったモデルと割り当ては [runtime.yaml](runtime.yaml)、言語とフォールバックは [config.yaml](config.yaml)、実行日時・検証結果・ファイルのハッシュは [generation.json](generation.json) に記録しています。

生成コードはソースを編集せず取り出しました。生成時の規約を保存するスナップショットとして扱う方針は [showcase の案内](../README.md) を参照してください。
