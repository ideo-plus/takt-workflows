# DDD Rust 知識

## 集約

集約は、非公開のフィールド、状態全体を受け取る非公開のコンストラクタ、操作固有のエラー enum を返す検証付きのファクトリ、永続化された状態のための `restore` 関数、`&mut self` を取り失敗時には何も変えないコマンドを持つ。

```rust
use crate::invoice::line::InvoiceLine;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenInvoiceError { MissingCustomer, NegativeTotal }

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueInvoiceError { AlreadyIssued, EmptyLines }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorruptInvoiceState;

#[derive(Debug)]
pub struct Invoice {
    customer: CustomerId,
    lines: Vec<InvoiceLine>,
    issued: bool,
}

impl Invoice {
    fn new(customer: CustomerId, lines: Vec<InvoiceLine>, issued: bool) -> Self {
        Self { customer, lines, issued }
    }

    pub fn open(customer: Option<CustomerId>, lines: Vec<InvoiceLine>) -> Result<Self, OpenInvoiceError> {
        let customer = customer.ok_or(OpenInvoiceError::MissingCustomer)?;
        if total_of(&lines) < 0 {
            return Err(OpenInvoiceError::NegativeTotal);
        }
        Ok(Self::new(customer, lines, false))
    }

    pub fn restore(customer: CustomerId, lines: Vec<InvoiceLine>, issued: bool) -> Result<Self, CorruptInvoiceState> {
        if (issued && lines.is_empty()) || total_of(&lines) < 0 {
            return Err(CorruptInvoiceState);
        }
        Ok(Self::new(customer, lines, issued))
    }

    pub fn issue(&mut self) -> Result<(), IssueInvoiceError> {
        if self.issued {
            return Err(IssueInvoiceError::AlreadyIssued);
        }
        if self.lines.is_empty() {
            return Err(IssueInvoiceError::EmptyLines);
        }
        self.issued = true;
        Ok(())
    }

    pub fn is_billed_to(&self, customer: &CustomerId) -> bool {
        &self.customer == customer
    }

    pub fn total(&self) -> i64 {
        total_of(&self.lines)
    }
}

fn total_of(lines: &[InvoiceLine]) -> i64 {
    lines.iter().fold(0, |sum, line| line.add_to(sum))
}
```

`restore` は、壊れた状態を専用の型で知らせる。業務上の失敗ではないからである。`total` は明細の金額を読み出さず、各明細に加算を頼む。

## 値オブジェクトと Domain Primitive

値オブジェクトは不変で、組み立て時に検証する。等価はその値で決まる。

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CustomerId(String);

impl CustomerId {
    pub fn parse(value: &str) -> Result<Self, InvalidCustomerId> {
        if value.is_empty() { return Err(InvalidCustomerId); }
        Ok(Self(value.to_owned()))
    }
}
```

| 条件 | 意味・選択肢 |
|------|-------------|
| 値に業務上の規則（形式、範囲）がある | 検証するコンストラクタを持つ Domain Primitive |
| 複数の値が規則とともに常に一緒に動く | 値オブジェクト |
| コレクションに規則（重複なし、合計の上限）がある | 専用のコレクション型 |

## イベントソーシング

判断と適用を分ける。コマンドは規則を確かめてイベントを返し、宣言した replay メソッドは 1 種類のイベントを適用して何も判断しない。

```rust
impl Invoice {
    pub fn issue(&self) -> Result<Vec<InvoiceEvent>, IssueInvoiceError> {
        if self.issued { return Err(IssueInvoiceError::AlreadyIssued); }
        Ok(vec![InvoiceEvent::Issued(InvoiceIssued { invoice_id: self.id.clone() })])
    }

    pub fn apply_issued(&mut self, _event: &InvoiceIssued) {
        self.issued = true;
    }
}
```

写像は `apply_issued` を `event_ref: event.invoice.issued` とともに `replay_methods` に挙げる。`apply` という名前のメソッドでも、宣言されていなければ replay メソッドではない。

## ポート、ユースケース、アダプタ

リポジトリポートは集約の名前を付けた trait である。ユースケースはそれをジェネリック引数（静的ディスパッチ）で持ち、実行時に選ぶ必要があるときだけ trait オブジェクトにする。

```rust
pub trait InvoiceRepository {
    fn find_by_id(&self, id: &InvoiceId) -> Result<Invoice, RepositoryError<InvoiceId>>;
    fn store(&mut self, id: &InvoiceId, invoice: &Invoice) -> Result<(), RepositoryError<InvoiceId>>;
    fn delete_by_id(&mut self, id: &InvoiceId) -> Result<(), RepositoryError<InvoiceId>>;
}

pub struct IssueInvoice<R: InvoiceRepository> {
    invoices: R,
}

impl<R: InvoiceRepository> IssueInvoice<R> {
    pub fn execute(&mut self, invoice_id: InvoiceId) -> Result<(), IssueInvoiceFailure> {
        let mut invoice = self.invoices.find_by_id(&invoice_id)?;
        invoice.issue()?;
        self.invoices.store(&invoice_id, &invoice)?;
        Ok(())
    }
}
```

アダプタは保存データを `restore` で、データベースのエラーを `RepositoryError` に変換する。

```rust
pub struct PostgresInvoiceRepository { pool: PgPool }

impl InvoiceRepository for PostgresInvoiceRepository {
    fn find_by_id(&self, id: &InvoiceId) -> Result<Invoice, RepositoryError<InvoiceId>> {
        let row = self.fetch_row(id)?;
        Invoice::restore(row.customer()?, row.lines()?, row.issued)
            .map_err(|_| RepositoryError::Corrupt(id.clone()))
    }
    // store and delete_by_id ...
}
```

## モジュール配置

| 配置 | 子を持つモジュール | 葉 |
|------|-------------------|----|
| `file` | `src/invoice.rs` と `src/invoice/line.rs` | `src/money.rs` |
| `mod-rs` | `src/invoice/mod.rs` と `src/invoice/line.rs` | `src/money.rs` |

`lib.rs`、`main.rs`、Cargo が指定するルートは、どちらの配置でも名前を変えない。配置はすべてのパッケージ、テスト、example、bench、ビルドスクリプトに適用する。

## ワークスペースの配置

```text
Cargo.toml
packages/
  command/
    billing-domain/            # domain（接尾辞 -domain）
    billing-use-case/          # use-case
    billing-interface-adapter/ # interface-adapter
  query/
    billing-query-use-case/
    billing-query-interface-adapter/
  rmu/
    billing-rmu/
  composition-root/
    billing-api/               # すべてを結線するバイナリ
```
