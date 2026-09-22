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
- T0 用の provider は何でも可。OpenCode → ローカル Ollama サーバー → Ollama Cloud、および OpenCode → OpenCode Go の構成は動作確認済みです。

### 作業するプロジェクトに導入する
作業プロジェクトの中でワンライナーのインストーラを実行します。バンドルを tarball で取得し（git clone 不要）、`<lang>/{workflows,steps,facets}` をプロジェクトの `.takt/` にコピーし、無ければ `.takt/runtime.yaml`（step の割り当て）も作ります:

```sh
cd ~/work/my-app
curl -fsSL https://raw.githubusercontent.com/ideo-plus/takt-workflows/main/scripts/install.sh | sh -s -- ja    # または en
```

バージョンを固定するには `--ref`（ブランチ、タグ、コミットのいずれか）を付けます: `... | sh -s -- ja --ref v0.1.0`。導入した言語と ref は `.takt/.takt-workflows` に記録されます。

手元に checkout を置きたい場合は、このリポジトリをプロジェクトの**外**に clone してください（git リポジトリの中に clone すると入れ子の埋め込みリポジトリになり、git はその中身を追跡しません）。そこから同じインストーラを実行します:

```sh
git clone https://github.com/ideo-plus/takt-workflows.git ~/src/takt-workflows
cd ~/work/my-app && ~/src/takt-workflows/scripts/use-lang.sh ja
```

### コミット・設定・実行
```sh
git add .takt && git commit -m "chore: add takt flash-default workflow bundle"
takt workflow doctor flash-default
takt -w flash-default -t "〜をテスト付きで追加する"
```

- コピーしたファイルはコミットしてください。TAKT はタスクをリポジトリの worktree クローンで実行するため、`.takt/` 配下の未追跡ファイルは実行時に見えません。TAKT が置く既定の `.takt/.gitignore` は `workflows/`、`steps/`、`facets/` を最初から追跡対象にしています。
- tier の profile はマシンごとに一度、`~/.takt/runtime.yaml` に定義します（[使い方](#使い方) 参照）。
- バンドルの更新や言語の切り替えは、インストーラをもう一度実行するだけです。自分のファイルだけを置き換え、`.takt/` にある他の workflow には触れません。

## 使い方

### 階層（Tier）
| Tier | 用途 | 置くべきモデル | 動作確認済みの例（provider / model） |
|---|---|---|---|
| T0 | `write_tests`、初回の `implement` | Flash 級モデル（DGX Spark、Ollama Cloud、LM Studio） | `opencode` / `ollama/glm-5.3-flash:cloud`（テスト）、`opencode` / `opencode-go/gpt-5.6-luna`（実装） |
| T1 | `reimplement`、`fix`、review companion、facet selector | 構造化出力に対応した中規模モデル | `claude` / `claude-sonnet-5` |
| T2 | `reimplement_final`、`fix` の昇格先、その他すべてのステップの既定 | 最も強い汎用モデル | `claude` / `claude-opus-5` |
| T3（任意） | `plan`、`replan`、裁定、`final-gate` | トークン消費が少なく判断の影響が大きいステップ向けの最上位モデル | `claude` / `claude-fable-5-1`（計画）、`codex` / `gpt-6-astra`（検収） |

この例はこのワークフローの実走で実際に使った profile そのもので、`runtime.yaml` の例も同じ名前を使っています。

### `~/.takt/runtime.yaml` — profile（環境依存、コミットしない）
```yaml
version: 1
companion:
  enabled: true                       # review companion を使うために必須
provider:
  defaults: { profile: t2 }
  profiles:
    # T0: ローカル ollama サーバー経由の Ollama Cloud と OpenCode Go を、どちらも OpenCode 経由で使う
    t0-test-code:       { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t0-production-code: { provider: opencode, model: opencode-go/gpt-5.6-luna }
    t1: { provider: claude, model: claude-sonnet-5 }
    t2: { provider: claude, model: claude-opus-5 }
    # T3（任意）: 計画と検収を別ベンダーにし、計画を書いたモデルに承認させない
    t3-plan:  { provider: claude, model: claude-fable-5-1 }
    t3-judge: { provider: codex,  model: gpt-6-astra }
```

### `<project>/.takt/runtime.yaml` — ステップへの割り当て
中身は [`runtime.project.yaml`](runtime.project.yaml) で、`.takt/runtime.yaml` が無いときにインストーラがプロジェクトへコピーします。

```yaml
version: 1
provider:
  defaults: { profile: t2 }
  targets:
    steps:
      development-core/plan:                     { profile: t3-plan }
      development-core/replan:                   { profile: t3-plan }
      peer-review/review-adjudication:           { profile: t3-judge }
      peer-review/final-gate:                    { profile: t3-judge }
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
- `~/.takt/runtime.yaml`（profile）はマシンごとの設定でコミットしません。`<project>/.takt/runtime.yaml`（step の割り当て）は profile 名しか書かないのでチームで共有できます。既定の `.takt/.gitignore` は無視するので、共有する場合は `!runtime.yaml` を足してください。
- あとで T0 を DGX Spark に切り替えるときは、`t0-*` の 2 つの profile だけを書き換えます。
- 最上位モデルはレート制限に早く当たります。`~/.takt/config.yaml` に `rate_limit_fallback.switch_chain`（例: `[{provider: claude, model: claude-opus-5}, {provider: codex, model: gpt-5.6-sol}]`）を置くと、制限に当たったステップは失敗せず次の provider で再実行されます。

## ヘルプ
- Issues: https://github.com/ideo-plus/takt-workflows/issues
- TAKT 本体: [nrslib/takt](https://github.com/nrslib/takt)

## ワークフロー開発者向け
- **builtin はコピーせず参照する。** tier のステップを足すためにコピーしたのは `development-implement-dynamic` と `development-remediation-dynamic` の 2 本だけ（`flash-implement-dynamic` / `flash-remediation-dynamic`）。builtin の facet は `builtin-` 接頭辞の 1 行 `{extends:...}` ファイルで参照しています。
- **昇格は `promotion` ではなくステップで表現する。** `promotion: [{at: N}]` は `ladder` を進めるだけで、子ワークフローの iteration カウンタは `workflow_call` のたびにリセットされます。そのため `implement → reimplement → reimplement_final` は別ステップです。`write_tests` と `fix` は 1 つのワークフロー内でループするので本物の ladder を使っています。
- **`write_tests` の promotion は step fragment で与える。** `.takt/steps/development-core-write-tests.yaml` が builtin の fragment を shadowing して `promotion` を足しているので、`development-core` 自体はコピーしていません。この shadowing はこのプロジェクト内で `development-core` を使うすべてのワークフローに効く点に注意してください。
- **T0 の文脈予算。** `write_tests`、`implement`、`reimplement` に注入する policy + knowledge + instruction は 25 KB 以下に保ちます（`coding-lite`、`testing-lite`、`implementation-semantics`）。T0 のステップにフルサイズの builtin policy を足さないでください。
- **2 言語、1 構造。** `en/` と `ja/` は常に同期させます。ファイル名は同一で、YAML は `description`、rule の `condition` 文、コメント以外は同じにします。workflow YAML は builtin の `en` / `ja` workflow に同じ改変を加えたものなので、構造を変えるときは両方を変えてください。このリポジトリ内の `.takt/{workflows,steps,facets}` は `scripts/use-lang.sh`（リポジトリ直下で実行）が生成するもので、追跡しません。`runtime.project.yaml` はインストーラがプロジェクトへコピーする step 割り当てのテンプレートです。
- 設計メモと `runtime.yaml` の雛形: [`ja/workflows/flash-default.yaml`](ja/workflows/flash-default.yaml) の冒頭コメント。
- 変更を出す前に、両言語について `scripts/use-lang.sh <lang>` のあと `takt workflow doctor flash-default` と `takt workflow inspect flash-default` を通してください。

## ライセンス
Apache License 2.0 です。[LICENSE](LICENSE) を参照してください。
