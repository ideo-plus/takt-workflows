# DDD TypeScript ポリシー

DDD の層の規則を、プロジェクトで 1 つのコード表現、実行時に隠れる状態、操作固有の Result エラー、明示的なパッケージ境界で TypeScript に適用する。

## 原則

| 原則 | 基準 |
|------|------|
| 表現は 1 つ | プロジェクト設定で `class` か `companion` を選び、すべての集約、Entity、Domain Primitive、値オブジェクトに使う |
| 実行時に隠れる状態 | 状態は `#` フィールドかファクトリのクロージャで隠す。`private`、`protected`、`readonly` では隠れない |
| Result は infrastructure から | `Result` は infrastructure の言語拡張パッケージで一度だけ宣言する |
| 閉じたエラーの union | 写像された各操作は、自分の文字列リテラルの union を返す |
| 明示的な境界 | 他のパッケージには、パッケージ名と公開された `exports` でだけ到達する |
| 検査できるコード | ドメインのソースは、構文と明記された型から判定できない構文を避ける |

## class 表現

| 基準 | 判定 |
|------|------|
| 状態を `#` フィールド以外のプロパティ（`private`、`protected`、`readonly`、パラメータプロパティを含む）に持っている | REJECT |
| コンストラクタが `private` でない、または状態全体を受け取らない | REJECT |
| ドメイン型の `new` が、その型自身の class 本体の外にある | REJECT |
| ドメインの class がアクセサ（`get`/`set`）、`extends`、`implements`、デコレータ、`declare`、`abstract` メンバー、計算メンバー名を使っている | REJECT |

## companion 表現

| 基準 | 判定 |
|------|------|
| ドメイン型が、1 つのファイルの中で同名の `type T = { … }` リテラルと `const T = { … }` の組になっていない | REJECT |
| 型リテラルがブランドとメソッドシグネチャ以外を持っている | REJECT |
| 型が、export しないトップレベルの `const brand: unique symbol = Symbol("T")` を持たない、`Symbol.for` を使う、またはブランドを export している | REJECT |
| インスタンスを完全コンストラクタのファクトリ以外で、またはスプレッド、`as`、`satisfies` で組み立てている | REJECT |
| ドメイン型が `interface` と `const` の組になっている | REJECT |
| ブランドのキー `[brand]` 以外の計算メンバーがある | REJECT |

## コマンドと状態

| 基準 | 判定 |
|------|------|
| 状態を変えるメソッドが、モデルのコマンドの slug で名付けられておらず（`command.invoice.add-line` なら `addLine`）、宣言済みの replay メソッドでもない | REJECT |
| 状態として持つコレクションを置き換えず（`[...lines, line]`）、その場で変更している | REJECT |
| ドメインのメソッドが別のドメインオブジェクトの getter を呼んでいる | REJECT |
| ドメインのメソッドの受け手に、1 つの型を名指す注釈がない | REJECT |

## Result とエラー

| 基準 | 判定 |
|------|------|
| ドメインのパッケージが独自の `Result` を宣言している、または Result のライブラリ（neverthrow、Effect、fp-ts）を使っている | REJECT |
| ドメインのパッケージが `Result` を、`dependencies` に挙げた言語拡張パッケージから `import type` でパッケージ名を使って読み込んでいない | REJECT |
| 写像されたファクトリやコマンドが、戻り値の型として `Result<success, E>` を明記していない | REJECT |
| `E` が、その操作に写像された `case` の文字列だけからなる export された union ではない | REJECT |
| 想定された業務上の失敗を `{ ok: false, error: "<case>" }` 以外の形で返している | REJECT |
| 操作に結び付かないファクトリ（`restore`、値オブジェクトの `of`）が値そのものを返す | OK |

## パッケージ境界とモジュール

| 基準 | 判定 |
|------|------|
| 他のパッケージに、相対パス、`paths` のエイリアス、`exports` が公開していないサブパスで到達している | REJECT |
| `tsconfig.json` が `baseUrl` や、他のパッケージへの `paths` を設定している | REJECT |
| パッケージのエントリが `export *` を使っている | REJECT。名前を 1 つずつ公開する |
| パッケージ内の相対指定子が `.ts` 拡張子を省いている | REJECT |
| `named-file` 配置で、子を持つモジュールが `src/<m>/index.ts` になっている | REJECT。`src/<m>/` の隣に `src/<m>.ts` を置く |
| `index-file` 配置で、子を持つモジュールが `src/<m>.ts` になっている | REJECT。`src/<m>/index.ts` を使う。葉は `<leaf>.ts` のまま |
| モジュールのファイル名が `<module>.ts` ではない（`invoice.model.ts`） | REJECT |

## 検査できるドメインのソース

| 基準 | 判定 |
|------|------|
| ドメインのソースが、分割代入、オブジェクトスプレッド、デコレータ、`import =`、`export =`、動的 `import()`、namespace、動的な呼び出し先を使っている | REJECT |
| オブジェクトリテラルに、ドメインの型を含む複合型（`{ lines: readonly InvoiceLine[] }`、`Record<string, Invoice>`）の注釈を付けている | REJECT。コレクション自身の変数に注釈を付ける |
| ユースケースの `execute` の引数、または `execute` や getter の受け手に型が明記されていない | REJECT |
| クエリ側のコードが、ドメインのパッケージを namespace として import している、または `export *` で再公開している | REJECT |
