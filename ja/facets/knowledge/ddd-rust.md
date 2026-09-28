# DDD Rust 知識

## 集約

集約は、非公開のフィールド、状態全体を受け取る非公開のコンストラクタ、操作固有のエラー enum を返す検証付きのファクトリ、永続化された状態のための `restore` 関数、`&mut self` を取って状態を変え、生んだ 1 つのイベントを返すコマンドを持つ。失敗したコマンドは何も変えず、イベントも生まない。

```rust
pub mod line;

use self::line::InvoiceLine;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenInvoiceError {
    MissingCustomer,
    NegativeTotal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddInvoiceLineError {
    AlreadyIssued,
    NegativeTotal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueInvoiceError {
    AlreadyIssued,
    EmptyLines,
}

/// A persisted state the invariants forbid: corrupt storage, not a business failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CorruptInvoiceState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceLineAdded {
    invoice_id: String,
    request_id: String,
    line: InvoiceLine,
}

impl InvoiceLineAdded {
    fn new(invoice_id: &str, request_id: &str, line: InvoiceLine) -> Self {
        InvoiceLineAdded { invoice_id: invoice_id.to_string(), request_id: request_id.to_string(), line }
    }

    pub fn invoice_id(&self) -> &str {
        &self.invoice_id
    }

    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    pub fn line(&self) -> &InvoiceLine {
        &self.line
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceIssued {
    invoice_id: String,
}

impl InvoiceIssued {
    fn new(invoice_id: &str) -> Self {
        InvoiceIssued { invoice_id: invoice_id.to_string() }
    }

    pub fn invoice_id(&self) -> &str {
        &self.invoice_id
    }
}

/// A request id already applied changes nothing and produces no event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddInvoiceLineOutcome {
    Applied(InvoiceLineAdded),
    Duplicate,
}

fn sum_of(lines: &[InvoiceLine]) -> i64 {
    lines.iter().fold(0, |sum, line| line.add_to(sum))
}

#[derive(Debug, Clone)]
pub struct Invoice {
    id: String,
    customer: String,
    lines: Vec<InvoiceLine>,
    issued: bool,
    add_line_requests: Vec<String>,
}

impl Invoice {
    fn new(id: String, customer: String, lines: Vec<InvoiceLine>, issued: bool, add_line_requests: Vec<String>) -> Self {
        Invoice { id, customer, lines, issued, add_line_requests }
    }

    pub fn open(id: &str, customer: &str, lines: Vec<InvoiceLine>) -> Result<Self, OpenInvoiceError> {
        if customer.is_empty() {
            return Err(OpenInvoiceError::MissingCustomer);
        }
        if sum_of(&lines) < 0 {
            return Err(OpenInvoiceError::NegativeTotal);
        }
        Ok(Self::new(id.to_string(), customer.to_string(), lines, false, Vec::new()))
    }

    pub fn restore(
        id: &str,
        customer: &str,
        lines: Vec<InvoiceLine>,
        issued: bool,
        add_line_requests: Vec<String>,
    ) -> Result<Self, CorruptInvoiceState> {
        if customer.is_empty() || (issued && lines.is_empty()) || sum_of(&lines) < 0 {
            return Err(CorruptInvoiceState);
        }
        Ok(Self::new(id.to_string(), customer.to_string(), lines, issued, add_line_requests))
    }

    pub fn add_line(&mut self, request_id: &str, line: InvoiceLine) -> Result<AddInvoiceLineOutcome, AddInvoiceLineError> {
        if self.add_line_requests.iter().any(|seen| seen == request_id) {
            return Ok(AddInvoiceLineOutcome::Duplicate);
        }
        if self.issued {
            return Err(AddInvoiceLineError::AlreadyIssued);
        }
        if line.add_to(sum_of(&self.lines)) < 0 {
            return Err(AddInvoiceLineError::NegativeTotal);
        }
        self.lines.push(line.clone());
        self.add_line_requests.push(request_id.to_string());
        Ok(AddInvoiceLineOutcome::Applied(InvoiceLineAdded::new(&self.id, request_id, line)))
    }

    pub fn issue(&mut self) -> Result<InvoiceIssued, IssueInvoiceError> {
        if self.issued {
            return Err(IssueInvoiceError::AlreadyIssued);
        }
        if self.lines.is_empty() {
            return Err(IssueInvoiceError::EmptyLines);
        }
        self.issued = true;
        Ok(InvoiceIssued::new(&self.id))
    }

    pub fn is_billed_to(&self, customer: &str) -> bool {
        self.customer == customer
    }

    pub fn total(&self) -> i64 {
        sum_of(&self.lines)
    }

    pub fn lines(&self) -> Vec<InvoiceLine> {
        self.lines.clone()
    }
}
```

`restore` は、壊れた状態を専用の型で知らせる。業務上の失敗ではないからである。`add_line` は反映した要求 ID を記憶し、再送された要求をほかのどの判定より先に認識する。そのときは `AddInvoiceLineOutcome::Duplicate` を返し、何も変えず、イベントも生まないので、イベントが二重に公開されない。イベントもドメイン型であり、フィールドは非公開、集約のモジュールの中で自分の `new` によって組み立て、公開する側には読み取り専用のアクセサを提供する。`total` は明細の金額を読み出さず、各明細に加算を頼む。例は短くするために ID と顧客を `&str` / `String` のままにしている。実際のコードでは Domain Primitive で包む。

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

コマンドは規則を確かめ、宣言した replay メソッドを通して状態を変え、生んだ 1 つのイベントを返す。復元は保存済みのイベントを同じメソッドで再生するので、コマンドによる変更と再生による変更がずれない。replay メソッドは何も判断しない。

```rust
impl Invoice {
    pub fn issue(&mut self) -> Result<InvoiceIssued, IssueInvoiceError> {
        if self.issued { return Err(IssueInvoiceError::AlreadyIssued); }
        if self.lines.is_empty() { return Err(IssueInvoiceError::EmptyLines); }
        let event = InvoiceIssued::new(&self.id);
        self.apply_issued(&event);
        Ok(event)
    }

    pub fn apply_issued(&mut self, _event: &InvoiceIssued) {
        self.issued = true;
    }
}
```

写像は `apply_issued` を `event_ref: event.invoice.issued` とともに `replay_methods` に挙げる。`apply` という名前のメソッドでも、宣言されていなければ replay メソッドではない。

## ポート、ユースケース、アダプタ

リポジトリポートは集約の名前を付けた trait で、ユースケースのクレートで宣言する。ユースケースはそれを trait オブジェクト（静的ディスパッチならジェネリック引数）で持ち、コマンドが変えた請求書を保存し、永続化の後に呼び出し側が公開できるようイベントを返す。

```rust
use billing_domain::invoice::Invoice;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvoiceNotFound;

pub trait InvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Invoice, InvoiceNotFound>;
    fn store(&self, invoice_id: &str, invoice: Invoice);
}

use billing_domain::invoice::{InvoiceIssued, IssueInvoiceError};

use crate::invoice_repository::{InvoiceNotFound, InvoiceRepository};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueInvoiceFailure {
    NotFound(InvoiceNotFound),
    Rejected(IssueInvoiceError),
}

pub struct IssueInvoice<'a> {
    invoices: &'a dyn InvoiceRepository,
}

impl<'a> IssueInvoice<'a> {
    pub fn new(invoices: &'a dyn InvoiceRepository) -> Self {
        IssueInvoice { invoices }
    }

    /// Issues the invoice, stores it, and hands back the event for the caller to publish.
    pub fn execute(&self, invoice_id: &str) -> Result<InvoiceIssued, IssueInvoiceFailure> {
        let mut invoice = self.invoices.find_by_id(invoice_id).map_err(IssueInvoiceFailure::NotFound)?;
        let issued = invoice.issue().map_err(IssueInvoiceFailure::Rejected)?;
        self.invoices.store(invoice_id, invoice);
        Ok(issued)
    }
}
```

アダプタはポートを実装し、名前に保存媒体の接頭辞を付けてよい。集約は `restore`、各明細は `of` で組み立て直す。

```rust
use std::cell::RefCell;
use std::collections::HashMap;

use billing_domain::invoice::line::InvoiceLine;
use billing_domain::invoice::Invoice;
use billing_use_case::invoice_repository::{InvoiceNotFound, InvoiceRepository};

pub struct InvoiceRecord {
    pub customer: String,
    pub amounts: Vec<i64>,
    pub issued: bool,
    pub add_line_requests: Vec<String>,
}

/// The invoices stored here take precedence over the records they were first read from.
pub struct InMemoryInvoiceRepository {
    records: HashMap<String, InvoiceRecord>,
    stored: RefCell<HashMap<String, Invoice>>,
}

impl InMemoryInvoiceRepository {
    pub fn new(records: HashMap<String, InvoiceRecord>) -> Self {
        InMemoryInvoiceRepository { records, stored: RefCell::new(HashMap::new()) }
    }
}

impl InvoiceRepository for InMemoryInvoiceRepository {
    fn find_by_id(&self, invoice_id: &str) -> Result<Invoice, InvoiceNotFound> {
        if let Some(stored) = self.stored.borrow().get(invoice_id) {
            return Ok(stored.clone());
        }
        let record = self.records.get(invoice_id).ok_or(InvoiceNotFound)?;
        let lines: Vec<InvoiceLine> = record.amounts.iter().map(|amount| InvoiceLine::of(*amount)).collect();
        Invoice::restore(invoice_id, &record.customer, lines, record.issued, record.add_line_requests.clone())
            .map_err(|_| InvoiceNotFound)
    }

    fn store(&self, invoice_id: &str, invoice: Invoice) {
        self.stored.borrow_mut().insert(invoice_id.to_string(), invoice);
    }
}
```

## モジュール配置

| 配置 | 子を持つモジュール | 葉 |
|------|-------------------|----|
| `file` | `src/invoice.rs` と `src/invoice/line.rs` | `src/money.rs` |
| `mod-rs` | `src/invoice/mod.rs` と `src/invoice/line.rs` | `src/money.rs` |

`lib.rs`、`main.rs`、Cargo が指定するルートは、どちらの配置でも名前を変えない。配置はすべてのパッケージ、テスト、example、bench、ビルドスクリプトに適用する。`#[cfg(test)]` のモジュールは、別ファイルでもインラインでもテストコードであり、業務コードとしては検査しない。

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
