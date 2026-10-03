# Rust 版の会議室予約

`ddd-rust-default` を Codex で実行して生成したコードです。予約集約、ID で予約を取り消すユースケース、保存・読込のポート、インメモリ実装を含みます。

## コードを読む

| 役割 | 主なファイル |
|---|---|
| 予約の生成・確定・取消し | [reservation.rs](packages/command/reservation-domain/src/reservation.rs) |
| 予約取消しのユースケース | [cancel_reservation.rs](packages/command/reservation-use-case/src/cancel_reservation.rs) |
| 保存・読込のポート | [reservation_repository.rs](packages/command/reservation-use-case/src/reservation_repository.rs) |
| インメモリ実装 | [in_memory_reservation_repository.rs](packages/command/reservation-interface-adapter/src/in_memory_reservation_repository.rs) |
| 集約のテスト | [reservation.rs](packages/command/reservation-domain/tests/reservation.rs) |
| 実アダプタを使うユースケースのテスト | [cancel_reservation.rs](packages/command/reservation-interface-adapter/tests/cancel_reservation.rs) |
| ポートの失敗伝播などのテスト | [cancel_reservation.rs](packages/command/reservation-use-case/tests/cancel_reservation.rs) |

業務の3クレートで構成しています。`create` で生成した予約を `reserve_room` で確定し、確定予約だけを取り消せます。取消しは `&mut self` で状態を変更してイベントを返します。ユースケースは変更後の予約を保存してからイベントを返します。

## テストを実行する

このディレクトリで次のコマンドを実行してください。Cargo 1.95.0 で検証しています。

```sh
cargo test
cargo fmt --all -- --check
```

## 生成条件と検証結果

| 項目 | 記録 |
|---|---|
| バンドルのコミット | [`ddd4a8d`](https://github.com/ideo-plus/takt-workflows/tree/ddd4a8d603d79ef27856f3804612d2302565ede0) |
| ワークフロー・言語 | `ddd-rust-default`・`ja` |
| 生成完了 | 2026-10-04 04:08 JST |
| TAKT | `0.67.0` |
| Codex CLI | `codex-cli 0.160.0` |
| Cargo | `1.95.0` |
| Node / Bun | `v24.19.0` / `1.4.2` |
| 所要時間 | 152分8秒 |
| サンドボックス検証 | 44項目成功、0項目失敗。最終ゲート通過 |
| 保存後のテスト | 25件成功、失敗・ignored 0件 |
| 保存後の整形確認 | `cargo fmt --all -- --check` 成功 |
| 保存後の DDD 検査 | 指摘0件、判定不能0件 |

[task.txt](task.txt) は実行に与えたタスク文です。業務要件とクレートの配置を記載しています。実行に使ったモデルと割り当ては [runtime.yaml](runtime.yaml)、言語とフォールバックは [config.yaml](config.yaml)、実行日時・検証結果・ファイルのハッシュは [generation.json](generation.json) に記録しています。

生成コードはソースを編集せず取り出しました。生成時の規約を保存するスナップショットとして扱う方針は [showcase の案内](../README.md) を参照してください。
