# takt-workflows
[TAKT](https://github.com/nrslib/takt) のワークフロー、facet、そして実際に動かして得た運用ノウハウをまとめたコレクションです。どのプロジェクトにも導入でき、動作を検証できる形にしてあります。

[English](README.md) | [日本語](README.ja.md)

## ワークフロー
| ワークフロー | 概要 |
|---|---|
| [`flash-default`](#flash-default) | builtin の `default` 開発ワークフローにモデルの階層を入れたもの。テスト生成と実装を安価な Flash 級モデルで始め、失敗したステップだけを上位モデルへ昇格させます。 |

今後もワークフローを追加していきます。

## 特長
- **作業するプロジェクトに導入する。** ワンライナーのインストーラがバンドルをプロジェクトの `.takt/` にコピーします。リポジトリの中に clone する必要はありません。
- **設定はプロジェクトに閉じる。** モデルとステップの割り当ては、プロジェクトでコミットする `.takt/runtime.yaml` に置きます。`~/.takt` を介してプロジェクト同士が影響し合うことはありません。
- **英語版と日本語版。** `en/` と `ja/` は TAKT 本体の builtin と同じく、同一構造で並んでいます。
- **端から端まで検証済み。** サンドボックス用スクリプトが使い捨てのプロジェクトでワークフローを実走させ（TAKT の mock provider でも本物の provider でも可）、各ステップが実際にどのモデルで動いたかを確かめます。

## クイックスタート

### 必要なもの
- TAKT 0.66 以降（`npm i -g takt`）
- ワークフローの `runtime.yaml` に書かれた provider（各ワークフローの節を参照）

### 作業するプロジェクトに導入する
作業プロジェクトの中でワンライナーのインストーラを実行します。バンドルを tarball で取得し（git clone 不要）、`<lang>/{workflows,steps,facets}` をプロジェクトの `.takt/` にコピーし、無ければ `.takt/runtime.yaml` と `.takt/config.yaml` も作ります:

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
git add .takt && git commit -m "chore: add takt-workflows bundle"
takt workflow doctor flash-default
takt -w flash-default -t "〜をテスト付きで追加する"
```

- インストーラが書いたもの（`workflows/`、`steps/`、`facets/`、`runtime.yaml`、`config.yaml`、`.takt-workflows`）をコミットしてください。TAKT はタスクをリポジトリの worktree クローンで実行するため、`.takt/` 配下の未追跡ファイルは実行時に見えません。`runtime.yaml` はインストーラが `.takt/.gitignore` の許可リストに追加します。
- 初回実行の前に、`.takt/runtime.yaml` のモデルが自分の環境で使えるか確認してください。
- バンドルの更新や言語の切り替えは、インストーラをもう一度実行するだけです。自分のファイルだけを置き換え、既存の `runtime.yaml` と `config.yaml` は残し、`.takt/` にある他の workflow には触れません。

## 設定はプロジェクトに閉じる
バンドルの TAKT 設定はすべてプロジェクト内に置き、プロジェクトと一緒にコミットします。

| ファイル | 内容 | テンプレート |
|---|---|---|
| `.takt/runtime.yaml` | profile（provider と model）と各ワークフローのステップ割り当て | [`runtime.project.yaml`](runtime.project.yaml) |
| `.takt/config.yaml` | 言語とレート制限時のフォールバック連鎖 | [`config.project.yaml`](config.project.yaml) |

`~/.takt/runtime.yaml` や `~/.takt/config.yaml` があると、TAKT はそれもマージします。他のプロジェクトの設定を完全に締め出すには、`TAKT_CONFIG_DIR` をプロジェクト内のディレクトリに向けます。たとえば direnv を使う場合は次のとおりです。`.takt/.gitignore` はこのディレクトリを最初から無視します。

```sh
# .envrc
export TAKT_CONFIG_DIR="$PWD/.takt/home"
```

- `TAKT_CONFIG_DIR` を設定しないと、既存の `~/.takt/runtime.yaml` も効きます。同名の profile はプロジェクト側が優先し、`defaults` と `targets` はプロジェクト側が置き換えますが、グローバル側の `companion.enabled: false` はすべてのプロジェクトで companion を無効にします。
- ループバック以外の `base_url`（LAN 上の DGX Spark など）は、`TAKT_CONFIG_DIR` 層の runtime.yaml でしか受け付けられません。`TAKT_CONFIG_DIR` をプロジェクト内に向けていれば、この設定もプロジェクトに閉じます。
- `ladder` から参照する profile は `provider` と `model` の両方が必須です。
- 最上位モデルはレート制限に早く当たります。`.takt/config.yaml` のフォールバック連鎖により、制限に当たったステップは失敗せず次の provider で再実行されます。

## flash-default
builtin の `default` ワークフロー（シナリオベースの計画、テストファーストの実装、並列ピアレビュー、裁定、収束型の修正ループ、final gate）の実装系ステップを、モデルの階層に分けたものです。

### 階層（Tier）
| Tier | 用途 | 置くべきモデル | 動作確認済みの例（provider / model） |
|---|---|---|---|
| T0 | `write_tests`、初回の `implement` | Flash 級モデル（DGX Spark、Ollama Cloud、LM Studio） | `opencode` / `ollama/glm-5.3-flash:cloud`（テスト）、`opencode` / `opencode-go/gpt-5.6-luna`（実装） |
| T1 | `reimplement`、`fix`、review companion、facet selector | 構造化出力に対応した中規模モデル | `claude` / `claude-sonnet-5` |
| T2 | `reimplement_final`、`fix` の昇格先、その他すべてのステップの既定 | 最も強い汎用モデル | `claude` / `claude-opus-5-5` |
| T3（任意） | `plan`、`replan`、裁定、`final-gate` | トークン消費が少なく判断の影響が大きいステップ向けの最上位モデル | `claude` / `claude-fable-5-1`（計画）、`codex` / `gpt-6-astra`（検収） |

この例は、実走で実際に使った profile そのものです。T1 には構造化出力に対応した provider（`claude`、`claude-sdk`、`claude-terminal`、`codex`、`opencode` のいずれか）が必要です。

### `.takt/runtime.yaml`
```yaml
version: 1
companion:
  enabled: true
provider:
  defaults: { profile: t2 }
  profiles:
    # T0: Flash-class models for closed, well-specified work
    t0-test-code:       { provider: opencode, model: ollama/glm-5.3-flash:cloud }
    t0-production-code: { provider: opencode, model: opencode-go/gpt-5.6-luna }
    # T1: mid-size model with structured output (companions and the facet selector need it)
    t1: { provider: claude, model: claude-sonnet-5 }
    # T2: strongest general model; default for every step not listed below
    t2: { provider: claude, model: claude-opus-5-5 }
    # T3 (optional): planning and sign-off on different vendors
    t3-plan:  { provider: claude, model: claude-fable-5-1 }
    t3-judge: { provider: codex,  model: gpt-6-astra }
  targets:
    steps:
      # T3 (optional): remove these four lines to run them on t2 instead
      development-core/plan:                     { profile: t3-plan }
      development-core/replan:                   { profile: t3-plan }
      peer-review/review-adjudication:           { profile: t3-judge }
      peer-review/final-gate:                    { profile: t3-judge }
      # Tiers
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

あとで T0 を DGX Spark に切り替えるときは、`t0-*` の 2 つの profile だけを書き換えます。

## サンドボックスで検証する
[`scripts/sandbox-verify.sh`](scripts/sandbox-verify.sh) は、使い捨ての git プロジェクトにバンドルを導入し、空の `TAKT_CONFIG_DIR` で実行します。そのためプロジェクトの設定だけが使われます。`flash-default` を実走させ、実行ログを検査します。

```sh
scripts/sandbox-verify.sh --mode mock    # TAKT の mock provider。ネットワーク不要、数秒
scripts/sandbox-verify.sh --mode real    # runtime.project.yaml の provider を使う。約 1 時間
```

- 実行が exit 0 で完走すること。
- 各ステップが `runtime.yaml` の割り当てどおりの provider と model で動くこと。`ladder` のステップはどの段でもよい。
- 正常系の経路（`plan`、`write_tests`、`implement`、`review-adjudication`、`final-gate`）を通ること。
- companion が割り当てどおりの profile で動くこと。
- real モードのみ: テストファイルが作られ、サンドボックス内で `node --test` が通ること。

結果はサンドボックス内の `report.md` に書かれます。サンドボックスは失敗時か `--keep` 指定時に残ります。`--lang`、`--task`、`--timeout` で言語・タスク・制限時間を変えられます。mock モードは経路をそのまま保ち（各 profile を「provider は mock、model は profile 名」に置き換える）、judge の答えを台本化して正常系を通します。確かめるのは配線で、モデルの品質ではありません。

## ヘルプ
- Issues: https://github.com/ideo-plus/takt-workflows/issues
- TAKT 本体: [nrslib/takt](https://github.com/nrslib/takt)

## ワークフロー開発者向け

### リポジトリの約束事
- **2 言語、1 構造。** `en/` と `ja/` は常に同期させます。ファイル名は同一で、YAML は `description`、rule の `condition` 文、コメント以外は同じにします。builtin をコピーしたワークフローは、builtin の `en` / `ja` に同じ改変を加えたものなので、構造を変えるときは両方を変えてください。
- **builtin はコピーせず参照する。** builtin のワークフローをコピーするのは、ステップを変える必要があるときだけにします。builtin の facet は `builtin-` 接頭辞の 1 行 `{extends:...}` ファイルで参照します。
- **テンプレート。** `runtime.project.yaml` と `config.project.yaml` はインストーラがプロジェクトへコピーするものです。このリポジトリ内の `.takt/{workflows,steps,facets}` は `scripts/use-lang.sh`（リポジトリ直下で実行）が生成するもので、追跡しません。
- **検証。** 変更を出す前に、両言語で `scripts/sandbox-verify.sh --mode mock --lang <en|ja>` を通してください。CI でも実行します。facet や tier を変えたときは `--mode real` も実行してください。

### flash-default の設計メモ
- **コピーした builtin は 2 本だけ。** tier のステップを足すために `development-implement-dynamic` と `development-remediation-dynamic` を `flash-implement-dynamic` / `flash-remediation-dynamic` としてコピーしました。`flash-default` は builtin の `development-core` を引数を変えて呼びます。
- **昇格は `promotion` ではなくステップで表現する。** `promotion: [{at: N}]` は `ladder` を進めるだけで、子ワークフローの iteration カウンタは `workflow_call` のたびにリセットされます。そのため `implement → reimplement → reimplement_final` は別ステップです。`write_tests` と `fix` は 1 つのワークフロー内でループするので本物の ladder を使っています。
- **`write_tests` の promotion は step fragment で与える。** `steps/development-core-write-tests.yaml` が builtin の fragment を shadowing して `promotion` を足しているので、`development-core` 自体はコピーしていません。この shadowing は、導入したプロジェクト内で `development-core` を使うすべてのワークフローに効きます。
- **T0 の文脈予算。** `write_tests`、`implement`、`reimplement` に注入する policy + knowledge + instruction は 25 KB 以下に保ちます（`coding-lite`、`testing-lite`、`implementation-semantics`）。T0 のステップにフルサイズの builtin policy を足さないでください。
- 詳しい設計メモと `runtime.yaml` の雛形: [`ja/workflows/flash-default.yaml`](ja/workflows/flash-default.yaml) の冒頭コメント。

## ライセンス
Apache License 2.0 です。[LICENSE](LICENSE) を参照してください。
