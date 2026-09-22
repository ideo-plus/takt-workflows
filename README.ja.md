# takt-workflows
[TAKT](https://github.com/nrslib/takt) 向けの階層型開発ワークフローです。テスト生成と実装を安価な Flash 級モデルで始め、失敗したステップだけを上位モデルへ昇格させます。

[English](README.md) | [日本語](README.ja.md)

## 特長
- **まず安く、必要なときだけ強く。** `write_tests` と初回の `implement` は Flash 級モデル（T0）で実行します。再実装、修正、レビューは、安い試行が通らなかったときだけ中位（T1）・上位（T2）のモデルで行います。
- **ワークフローを触らずにモデルを差し替えられる。** 各 tier が使う provider / model は `runtime.yaml` に置くので、同じワークフローが DGX Spark でも Ollama Cloud でも他の provider でも動きます。
- **品質ゲートは TAKT の `default` と同じ。** シナリオベースの計画、テストファーストの実装、並列ピアレビュー、裁定、収束型の修正ループ、final gate をそのまま残しています。

## クイックスタート

### 必要なもの
- TAKT 0.66 以降（`npm i -g takt`）
- T1 用に構造化出力へ対応した provider を 1 つ: `claude`、`claude-sdk`、`claude-terminal`、`codex`、`opencode` のいずれか
- T0 用の provider は何でも可。OpenCode → ローカル Ollama サーバー → Ollama Cloud の構成は動作確認済みです。

### インストール
このリポジトリを clone するか、`.takt/workflows`、`.takt/steps`、`.takt/facets` を自分のプロジェクトの `.takt/` にコピーします。

```sh
git clone https://github.com/ideo-plus/takt-workflows.git
cd takt-workflows
```

### 実行
1. `~/.takt/runtime.yaml` に tier の profile を定義する（[使い方](#使い方) 参照）。
2. `<project>/.takt/runtime.yaml` で profile をステップに割り当てる。
3. 検証して実行する:

```sh
takt workflow doctor flash-default    # スキーマと参照の検証
takt workflow inspect flash-default   # ステップごとに解決された provider / model を表示
takt -w flash-default -t "〜をテスト付きで追加する"
```

## 使い方

### 階層（Tier）
| Tier | 用途 | 置くべきモデル | 動作確認済みの例（provider / model） |
|---|---|---|---|
| T0 | `write_tests`、初回の `implement` | Flash 級モデル（DGX Spark、Ollama Cloud、LM Studio） | `opencode` / `ollama/glm-5.3-flash:cloud` |
| T1 | `reimplement`、`fix`、review companion、facet selector | 構造化出力に対応した中規模モデル | `codex` / `gpt-5.6-sol` |
| T2 | `reimplement_final`、`fix` の昇格先、その他すべてのステップの既定 | 最も強い汎用モデル | `claude` / `opus` |
| T3（任意） | `plan`、`replan`、裁定、`final-gate` | トークン消費が少なく判断の影響が大きいステップ向けの最上位モデル | `claude` / `claude-fable-5-1`（計画）、`codex` / `gpt-6-astra`（検収） |

この例はこのワークフローの実走で実際に使った profile そのもので、`runtime.yaml` の例も同じ名前を使っています。

### 最上位モデルはどこに入るか（T3）
T3 は、出力がその後の全工程を左右するのにトークン消費は少ない、ごく少数のステップに使います。計画の作成、並列レビューの裁定、final gate の 3 つです。動作確認済みの構成では、計画を書いたモデルがそのまま検収しないよう、意図的に 2 ベンダーへ分けています。

| profile | ステップ | 確認済みモデル |
|---|---|---|
| `t3-plan` | `development-core/plan`、`development-core/replan` | `claude` / `claude-fable-5-1` |
| `t3-judge` | `peer-review/review-adjudication`、`peer-review/final-gate` | `codex` / `gpt-6-astra` |

profile を `~/.takt/runtime.yaml` に、ステップの割り当てをプロジェクト側に追加します:

```yaml
# ~/.takt/runtime.yaml
    t3-plan:  { provider: claude, model: claude-fable-5-1 }
    t3-judge: { provider: codex,  model: gpt-6-astra }
```

```yaml
# <project>/.takt/runtime.yaml  (provider.targets.steps 配下に追加)
      development-core/plan:                     { profile: t3-plan }
      development-core/replan:                   { profile: t3-plan }
      peer-review/review-adjudication:           { profile: t3-judge }
      peer-review/final-gate:                    { profile: t3-judge }
```

ここに挙げていないステップ（並列レビュアー、`fix-plan`、`fix-verifier`）は引き続き `defaults` の T2 に落ちます。最上位モデルはレート制限に早く当たるので、`~/.takt/config.yaml` のフォールバック連鎖と組み合わせてください。制限に当たったステップは失敗せず、次の provider で再実行されます:

```yaml
# ~/.takt/config.yaml
rate_limit_fallback:
  switch_chain:
    - { provider: claude, model: opus }
    - { provider: codex,  model: gpt-5.6-sol }
```

### `~/.takt/runtime.yaml` — profile（環境依存、コミットしない）
```yaml
version: 1
companion:
  enabled: true                       # review companion を使うために必須
provider:
  defaults: { profile: t2 }
  profiles:
    # T0: OpenCode -> ローカル ollama サーバー -> Ollama Cloud で動作確認済み
    t0-test-code:       { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t0-production-code: { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t1: { provider: codex,  model: gpt-5.6-sol }
    t2: { provider: claude, model: opus }
```

### `<project>/.takt/runtime.yaml` — ステップへの割り当て
```yaml
version: 1
provider:
  defaults: { profile: t2 }
  targets:
    steps:
      development-core/write_tests:              { ladder: [t0-test-code, t1, t2] }
      flash-implement-dynamic/implement:         { profile: t0-production-code }
      flash-implement-dynamic/reimplement:       { profile: t1 }
      flash-implement-dynamic/reimplement_final: { profile: t2 }
      flash-remediation-dynamic/fix:             { ladder: [t1, t2] }
    internal_agents:
      selector: { profile: t1 }
    companions:
      ai-antipattern-review-companion: { profile: t1 }
      testing-review-companion:        { profile: t1 }
      review-companion-moderator:      { profile: t1 }
```

### 知っておくこと
- `ladder` から参照する profile は `provider` と `model` の両方が必須です。
- 両方のファイルに `targets` があると、プロジェクト側がグローバル側を置き換えます。`profiles` はマージされ、同名はプロジェクト側が優先です。
- ループバック以外の `base_url`（LAN 上の DGX Spark など）はグローバルの `~/.takt/runtime.yaml` でしか受け付けません。
- `runtime.yaml` は意図的に `.takt/.gitignore` の許可リスト外です。環境ごとの設定なのでコミットしません。
- あとで T0 を DGX Spark に切り替えるときは、`t0-*` の 2 つの profile だけを書き換えます。

## ヘルプ
- Issues: https://github.com/ideo-plus/takt-workflows/issues
- TAKT 本体: [nrslib/takt](https://github.com/nrslib/takt)

## ワークフロー開発者向け
- **builtin はコピーせず参照する。** tier のステップを足すためにコピーしたのは `development-implement-dynamic` と `development-remediation-dynamic` の 2 本だけ（`flash-implement-dynamic` / `flash-remediation-dynamic`）。builtin の facet は `builtin-` 接頭辞の 1 行 `{extends:...}` ファイルで参照しています。
- **昇格は `promotion` ではなくステップで表現する。** `promotion: [{at: N}]` は `ladder` を進めるだけで、子ワークフローの iteration カウンタは `workflow_call` のたびにリセットされます。そのため `implement → reimplement → reimplement_final` は別ステップです。`write_tests` と `fix` は 1 つのワークフロー内でループするので本物の ladder を使っています。
- **`write_tests` の promotion は step fragment で与える。** `.takt/steps/development-core-write-tests.yaml` が builtin の fragment を shadowing して `promotion` を足しているので、`development-core` 自体はコピーしていません。この shadowing はこのプロジェクト内で `development-core` を使うすべてのワークフローに効く点に注意してください。
- **T0 の文脈予算。** `write_tests`、`implement`、`reimplement` に注入する policy + knowledge + instruction は 25 KB 以下に保ちます（`coding-lite`、`testing-lite`、`implementation-semantics`）。T0 のステップにフルサイズの builtin policy を足さないでください。
- 設計メモと `runtime.yaml` の雛形: [`.takt/workflows/flash-default.yaml`](.takt/workflows/flash-default.yaml) の冒頭コメント。
- 変更を出す前に `takt workflow doctor flash-default` と `takt workflow inspect flash-default` を通してください。

## ライセンス
未定です。
