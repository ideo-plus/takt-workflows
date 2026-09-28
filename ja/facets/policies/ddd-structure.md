# DDD 構造ポリシー

層、依存方向、パッケージ名、モジュール配置を固定し、構造そのものがドメインとその境界を表すようにする。

## 原則

| 原則 | 基準 |
|------|------|
| 層はパッケージで決まる | パッケージの層は名前と配置で決め、設定による上書きをしない |
| 依存は内側へ向かう | 許可された方向だけを使い、結線は composition root が行う |
| infrastructure は言語拡張 | infrastructure 層は言語を拡張する層であり、保存やネットワークのクライアントはアダプタに置く |
| 名前はユビキタス言語から | ドメインのパッケージとモジュールは業務用語で名付け、技術分類では名付けない |
| 配置はプロジェクトで 1 つ | モジュール配置はプロジェクト設定で一度選び、すべてに適用する |

## 層

パッケージ（Cargo の crate、または `package.json` を持つ TypeScript のパッケージ）は、接尾辞（`-domain`、`-use-case`、`-interface-adapter`、`-infrastructure`）か配置（`packages/<layer>/`、`modules/<layer>/`）で層が決まる。コマンド側、クエリ側、読み取りモデル更新器のパッケージは `command`、`query`、`rmu` の区切りを持つ。接尾辞が `-composition-root` のパッケージ、バイナリだけのパッケージ、`composition-root/` の下のパッケージは composition root である。

| 基準 | 判定 |
|------|------|
| パッケージの接尾辞と配置が別の層を指している | REJECT |
| パッケージがどの層の規則にも当てはまらない | REJECT |
| パッケージが `command`、`query`、`rmu` のうち 2 つ以上を持つ | REJECT |
| パッケージがバイナリのターゲットと、ある層のライブラリコードを混在させている | REJECT |

## 依存方向

| 依存元 | 依存してよい先 |
|--------|----------------|
| interface-adapter | use-case、domain、infrastructure |
| use-case | domain、infrastructure |
| domain | infrastructure |
| infrastructure | なし |
| 読み取りモデル更新器 | domain、interface-adapter、infrastructure、両側 |
| composition root | すべての層 |

| 基準 | 判定 |
|------|------|
| 上の表にない依存がある | REJECT |
| ドメインやユースケースのコードが I/O のライブラリ（データベースドライバ、HTTP のクライアントやサーバー、メッセージブローカー）に依存している | REJECT |
| 実装とポートの結線を composition root の外で行っている | REJECT |
| データベースや RPC のクライアントを infrastructure 層に置いている | REJECT。インターフェイスアダプタ層に置く |
| infrastructure 層が `Result` などの言語拡張をパッケージのエントリから公開する | OK。infrastructure の関数を公開しないという一般的な指針は、この言語拡張には当てはまらない |

## ドメインのパッケージ分け

| 基準 | 判定 |
|------|------|
| パッケージやモジュールの名前が `aggregate(s)`、`impl(s)`、`implementation(s)`、`vo(s)`、`entity`、`entities`、`value_object(s)`、`valueobject(s)`、または単独の `domain` | REJECT |
| 同じ業務概念の集約、Entity、値オブジェクトを型の種類だけでモジュールに分けている | REJECT |
| 共有する値を、責務の名前（`money`、`address`）のモジュールではなく `common/vo` のような入れ物に置いている | REJECT |
| `common`、`shared`、`utils` がドメインの概念を持っている | 警告。業務用語としての根拠を示すか、名前を変える |
| ドメインのパッケージやモジュールが、業務用語とともに集約写像に宣言されていない | REJECT |
| `-domain` の接尾辞や `packages/domain` の配置のような層の標識 | OK。技術分類ではなく層の標識である |

`aggregate/`、`model/`、`services/`、`repositories/` のようにコードをまとめるディレクトリの例は、この構造のドメインコードには当てはまらない。

## モジュール配置

プロジェクト設定で言語ごとに 1 つのモジュール配置を選ぶ。既存のファイルは配置の根拠にならず、既存のスタイルに合わせることが設定より優先されることはない。

| 基準 | 判定 |
|------|------|
| コードを生成する前に、プロジェクト設定で配置を選んでいない | REJECT。先に 1 つ選ぶ |
| どのパッケージ、層、テスト、example、ビルドスクリプトであれ、選んだ配置と異なる置き方のモジュールがある | REJECT |
| 1 つのモジュールに両方の置き方がある（`invoice.rs` と `invoice/mod.rs`、`src/invoice.ts` と `src/invoice/index.ts`） | REJECT |
| crate のルートから到達できないファイルがある、または子が移動した後に古い `mod.rs` や `index.ts` が残っている | REJECT |
| TypeScript のテスト、宣言ファイル、`.tsx`・`.mts`・`.cts` のソースをパッケージの `src` の中に置いている | REJECT。`src` の外に置く |
