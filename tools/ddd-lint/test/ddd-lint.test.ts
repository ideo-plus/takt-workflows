import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { rustParentModuleFile, rustSample, rustSamples } from "./samples/rust.ts";
import { parentModuleFile, typeScriptSample, typeScriptSamples } from "./samples/typescript.ts";
import { loadAggregateMapping } from "../lib/aggregate-mapping/index.ts";
import { loadDomainModelSource } from "../lib/schema/loader.ts";

const CLI = resolve(import.meta.dir, "../ddd-lint.ts");
const scratch = mkdtempSync(join(tmpdir(), "ddd-lint-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Finding {
  readonly check: string;
  readonly rule_id: string;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
}

let counter = 0;

/** Writes `files` into a fresh project directory, applies `edit`, and runs ddd-lint on it. */
function lint(
  files: Readonly<Record<string, string>>,
  edit: (files: Record<string, string>) => void = () => {},
): { pass: boolean; exitCode: number; findings: Finding[]; unavailable: string[] } {
  const dir = join(scratch, `project-${counter++}`);
  const edited: Record<string, string> = { ...files };
  edit(edited);
  for (const [path, content] of Object.entries(edited)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const run = Bun.spawnSync(["bun", CLI, "--project", dir, "--json"]);
  const report = JSON.parse(run.stdout.toString()) as {
    pass: boolean;
    results: { check: string; findings: Omit<Finding, "check">[]; unavailable?: string }[];
  };
  return {
    pass: report.pass,
    exitCode: run.exitCode,
    findings: report.results.flatMap((result) => result.findings.map((entry) => ({ check: result.check, ...entry }))),
    unavailable: report.results.flatMap((result) => (result.unavailable ? [`${result.check}: ${result.unavailable}`] : [])),
  };
}

function replace(files: Record<string, string>, path: string, from: string, to: string): void {
  const content = files[path];
  if (content === undefined || !content.includes(from)) throw new Error(`${path} does not contain ${from}`);
  files[path] = content.replace(from, to);
}

function writeProject(files: Readonly<Record<string, string>>, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function buildTypeScriptSample(files: Readonly<Record<string, string>>): number {
  const dir = writeProject(files, "ddd-ts-build-");
  try {
    const scope = join(dir, "node_modules/@acme");
    mkdirSync(scope, { recursive: true });
    for (const [name, path] of [
      ["language-extensions", "packages/infrastructure/language-extensions"],
      ["billing-domain", "packages/command/billing-domain"],
      ["billing-use-case", "packages/command/billing-use-case"],
      ["billing-interface-adapter", "packages/command/billing-interface-adapter"],
    ]) symlinkSync(join(dir, path), join(scope, name), "dir");
    return spawnSync(resolve(import.meta.dir, "../node_modules/.bin/tsc"), ["-b", "--pretty", "false"], { cwd: dir }).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function buildRustSample(files: Readonly<Record<string, string>>): number {
  const dir = writeProject(files, "ddd-rust-build-");
  try {
    return spawnSync("cargo", ["check", "--workspace"], { cwd: dir }).status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the knowledge samples pass", () => {
  for (const sample of typeScriptSamples())
    test(sample.name, () => {
      const result = lint(sample.files);
      expect(result.unavailable).toEqual([]);
      expect(result.findings).toEqual([]);
      expect(result.pass).toBe(true);
    });
  for (const sample of rustSamples())
    test(sample.name, () => {
      const result = lint(sample.files);
      expect(result.unavailable).toEqual([]);
      expect(result.findings).toEqual([]);
      expect(result.pass).toBe(true);
    });
});

describe("Rust sample domain model generation", () => {
  for (const sample of rustSamples())
    test(`${sample.layout} declares Money with its unconstrained reason`, () => {
      const source = sample.files["docs/ddd/domain-model.yaml"] ?? "";
      const loaded = loadDomainModelSource(source, "docs/ddd/domain-model.yaml");
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const money = loaded.model.bounded_contexts[0]?.aggregates[0]?.elements.find(
        (element) => element.element_id === "primitive.money",
      );
      expect(money?.kind).toBe("domain-primitive");
      expect(money?.unconstrained).toBe("individual line amounts may be positive, zero, or negative");
    });
});

describe("Rust sample aggregate mapping", () => {
  for (const sample of rustSamples())
    test(`${sample.layout} maps Money to the Invoice line code location`, () => {
      const dir = writeProject(sample.files, "ddd-rust-mapping-");
      try {
        const loaded = loadAggregateMapping(join(dir, "docs/ddd/aggregate-mapping.yaml"));
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const invoiceLine = loaded.mapping.domain_packages.find((entry) => entry.term === "Invoice line");
        expect(invoiceLine?.model_refs).toEqual(["vo.invoice-line", "primitive.money"]);
        expect(invoiceLine?.code).toEqual({
          language: "rust",
          package: "billing-domain",
          module: ["invoice", "line"],
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
});

describe("sample builds", () => {
  for (const sample of typeScriptSamples())
    test(`${sample.name} builds with TypeScript`, () => expect(buildTypeScriptSample(sample.files)).toBe(0));
  for (const sample of rustSamples())
    test(`${sample.name} builds with Cargo`, () => expect(buildRustSample(sample.files)).toBe(0));
});

describe("TypeScript", () => {
  const sample = typeScriptSample("class", "named-file");
  const invoice = parentModuleFile("named-file");

  test("a command that changes state in place is reported", () => {
    const result = lint(sample.files, (files) => {
      replace(files, invoice, "  readonly #issued: boolean;", "  #issued: boolean;");
      replace(
        files,
        invoice,
        "    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, this.#lastAddLineCommandId);",
        "    this.#issued = true;\n    const invoice: Invoice = this;",
      );
    });
    expect(result.findings.map((entry) => entry.rule_id)).toEqual(["immutable", "immutable"]);
    expect(result.findings.map((entry) => entry.message).join("\n")).toContain("Invoice.issue changes state in place");
    expect(result.findings.map((entry) => entry.message).join("\n")).toContain("Invoice.#issued is not readonly");
  });

  test("a companion command that writes closure state is reported", () => {
    const companion = typeScriptSample("companion", "named-file");
    const result = lint(companion.files, (files) =>
      replace(
        files,
        invoice,
        "        const invoice: Invoice = Invoice.restore(state.id, state.customer, state.lines, true, state.lastAddLineCommandId);",
        "        state.issued = true;\n        const invoice: Invoice = instance;",
      ),
    );
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "immutable: method Invoice.issue changes state in place; return a new instance built through the full constructor",
    ]);
  });

  test("a built-in collection in closure state changed for its effect is reported", () => {
    const companion = typeScriptSample("companion", "named-file");
    const result = lint(companion.files, (files) =>
      replace(
        files,
        invoice,
        "        const next: InvoiceLines = state.lines.add(line);",
        "        const kept: InvoiceLine[] = [];\n        kept.push(line);\n        state.seen.add(commandId);\n        const next: InvoiceLines = state.lines.add(line);",
      ),
    );
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "immutable: method Invoice.addLine changes state in place; return a new instance built through the full constructor",
    ]);
  });

  test("a domain type holding a bare collection beside other state is reported", () => {
    const result = lint(sample.files, (files) => replace(files, invoice, "  readonly #lines: InvoiceLines;", "  readonly #lines: readonly InvoiceLine[];"));
    expect(result.findings.filter((entry) => entry.rule_id === "collection").map((entry) => entry.message)).toEqual([
      "Invoice holds #lines (readonly InvoiceLine[]) as a bare collection; wrap it in a first-class collection type",
    ]);
  });

  test("a repository port declared in a domain package is reported", () => {
    const result = lint(sample.files, (files) => {
      files[invoice] += "\nexport interface InvoiceRepository {\n  findById(invoiceId: string): Invoice | undefined;\n}\n";
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "port-placement").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "typescript-domain: repository port InvoiceRepository is declared in the domain layer; declare it in the use-case layer",
    ]);
  });

  test("a Domain Primitive factory that does not return Result is reported", () => {
    const result = lint(sample.files, (files) =>
      replace(files, "packages/command/billing-domain/src/customer-id.ts", "static parse(value: string): Result<CustomerId, ParseCustomerIdError>", "static parse(value: string): CustomerId"),
    );
    expect(result.findings.filter((entry) => entry.rule_id === "operation").map((entry) => `${entry.file}: ${entry.message}`)).toEqual([
      "packages/command/billing-domain/src/customer-id.ts: CustomerId.parse (factory.invoice.parse-customer-id) returns CustomerId; the mapping says Result<CustomerId, ParseCustomerIdError>",
    ]);
  });

  test("a return type that differs from the mapping, and a missing method, are reported", () => {
    const result = lint(sample.files, (files) => {
      replace(files, invoice, "issue(): Result<IssueInvoiceOutcome, IssueInvoiceError>", "issue(): Result<Invoice, IssueInvoiceError>");
      replace(files, "docs/ddd/aggregate-mapping.yaml", "method: addLine,", "method: appendLine,");
    });
    expect(result.findings.map((entry) => entry.rule_id)).toEqual(["operation", "operation"]);
    expect(result.findings.map((entry) => entry.message)).toEqual([
      "Invoice has no command method appendLine for command.invoice.add-line",
      "Invoice.issue (command.invoice.issue) returns Result<Invoice, IssueInvoiceError>; the mapping says Result<IssueInvoiceOutcome, IssueInvoiceError>",
    ]);
  });
});

describe("Rust", () => {
  const sample = rustSample("file");
  const invoice = rustParentModuleFile("file");

  test("a command that takes &self and returns no event is reported", () => {
    const result = lint(sample.files, (files) => {
      replace(files, invoice, "pub fn issue(&mut self) -> Result<InvoiceIssued, IssueInvoiceError>", "pub fn issue(&self) -> Result<(), IssueInvoiceError>");
      replace(files, invoice, "        self.issued = true;\n        Ok(InvoiceIssued::new(&self.id))", "        Ok(())");
    });
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "operation: Invoice::issue (command.invoice.issue) does not take &mut self and returns Result<(), IssueInvoiceError>, not Result<InvoiceIssued, IssueInvoiceError>",
    ]);
  });

  test("a #[cfg(test)] module in its own file is test code, not business code", () => {
    const result = lint(sample.files, (files) => {
      replace(files, invoice, "pub mod lines;\n", "pub mod lines;\n\n#[cfg(test)]\nmod tests;\n");
      files["packages/command/billing-domain/src/invoice/tests.rs"] =
        "use super::*;\n\n#[test]\nfn opens() {\n    let customer = CustomerId::parse(\"C000001\").unwrap();\n    assert!(Invoice::open(\"i1\", customer, InvoiceLines::of(Vec::new())).is_ok());\n}\n";
    });
    expect(result.findings).toEqual([]);
  });

  test("a value that returns a changed copy instead of changing in place is reported", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const lines = "packages/command/billing-domain/src/invoice/lines.rs";
    const result = lint(sample.files, (files) => {
       replace(files, line, "pub fn with_amount<R>(&self, use_amount: impl FnOnce(&Money) -> R) -> R {\n        use_amount(&self.amount)\n    }", "pub fn add_to(&self, total: i64) -> i64 {\n        total + self.amount.0\n    }");
      files[line] += "\nimpl std::ops::Add for InvoiceLine {\n    type Output = InvoiceLine;\n\n    fn add(self, other: InvoiceLine) -> InvoiceLine {\n        InvoiceLine::of(self.amount + other.amount)\n    }\n}\n";
      replace(files, lines, "pub fn add(&mut self, line: InvoiceLine) {\n        self.0.push(line);\n    }", "pub fn add(&self, line: InvoiceLine) -> Self {\n        let mut lines = self.0.clone();\n        lines.push(line);\n        InvoiceLines(lines)\n    }");
    });
    expect(result.findings.filter((entry) => entry.rule_id === "in-place").map((entry) => entry.message)).toEqual([
      "InvoiceLine::add_to returns a changed copy of total; make that value the receiver and change it through &mut self instead",
      "InvoiceLine implements Add, which returns a new value; implement AddAssign and change the value in place",
      "InvoiceLines::add returns a new InvoiceLines instead of changing it; take &mut self and change it in place",
    ]);
  });

  test("a method that changes an external &mut argument is reported", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const result = lint(sample.files, (files) =>
      replace(
        files,
        line,
         "pub fn with_amount<R>(&self, use_amount: impl FnOnce(&Money) -> R) -> R {\n        use_amount(&self.amount)\n    }",
        "pub fn add_to(&self, total: &mut i64) {\n        *total += self.amount.0;\n    }",
      ),
    );
    expect(result.findings.filter((entry) => entry.rule_id === "in-place").map((entry) => entry.message)).toEqual([
      "InvoiceLine::add_to changes a &mut argument it received; change the value itself through &mut self instead",
    ]);
  });

  test("an external &mut argument in a custom trait implementation is reported", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const result = lint(sample.files, (files) => {
      files[line] += `
pub trait AddsTo {
    fn add_to(&self, total: &mut i64);
}

impl AddsTo for InvoiceLine {
    fn add_to(&self, total: &mut i64) {
        *total += 1;
    }
}
`;
    });
    expect(result.findings.filter((entry) => entry.rule_id === "in-place").map((entry) => entry.message)).toContain(
      "InvoiceLine::add_to changes a &mut argument it received; change the value itself through &mut self instead",
    );
  });

  test("a shared argument in a custom trait implementation is kept", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const result = lint(sample.files, (files) => {
      files[line] += `
pub trait ObservesTotal {
    fn observes(&self, total: &i64);
}

impl ObservesTotal for InvoiceLine {
    fn observes(&self, _total: &i64) {}
}
`;
    });
    expect(result.findings.filter((entry) => entry.rule_id === "in-place")).toEqual([]);
  });

  test("a typed mutable receiver is treated as self rather than an external argument", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const result = lint(sample.files, (files) =>
      replace(
        files,
        line,
        "pub fn add(&mut self, rhs: &Money) {",
        "pub fn add(self: &mut Self, rhs: &Money) {",
      ),
    );
    expect(result.findings.filter((entry) => entry.rule_id === "in-place")).toEqual([]);
  });

  test("a typed mutable receiver does not exempt another external mutable argument", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const result = lint(sample.files, (files) =>
      replace(
        files,
        line,
        "pub fn add(&mut self, rhs: &Money) {",
        "pub fn add(self: &mut Self, rhs: &mut Money) {",
      ),
    );
    expect(result.findings.filter((entry) => entry.rule_id === "in-place").map((entry) => entry.message)).toContain(
      "Money::add changes a &mut argument it received; change the value itself through &mut self instead",
    );
  });

  test("a method that changes itself through &mut self and a plain &self query are kept", () => {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const result = lint(sample.files, (files) => {
      replace(
        files,
        line,
         "pub fn with_amount<R>(&self, use_amount: impl FnOnce(&Money) -> R) -> R {\n        use_amount(&self.amount)\n    }",
        "pub fn scale(&mut self, factor: i64) {\n        self.amount = Money::of(factor);\n    }\n\n    pub fn is_positive(&self) -> bool {\n        !self.amount.is_negative()\n    }",
      );
    });
    expect(result.findings.filter((entry) => entry.rule_id === "in-place").map((entry) => entry.message)).toEqual([]);
  });

  test("an undeclared &mut self method is reported on the aggregate root only", () => {
    const result = lint(sample.files, (files) =>
      replace(files, invoice, "    pub fn is_billed_to(", "    pub fn reopen(&mut self) {\n        self.issued = false;\n    }\n\n    pub fn is_billed_to("),
    );
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "b: mutating method Invoice::reopen is not declared as command.invoice.reopen",
    ]);
  });

  test("a domain struct holding a bare collection beside other fields is reported", () => {
    const result = lint(sample.files, (files) => replace(files, invoice, "    lines: InvoiceLines,\n    issued: bool,", "    lines: Vec<InvoiceLine>,\n    issued: bool,"));
    expect(result.findings.filter((entry) => entry.rule_id === "collection").map((entry) => entry.message)).toEqual([
      "Invoice holds lines as a bare collection (Vec<InvoiceLine>); wrap it in a first-class collection type",
    ]);
  });

  test("a repository port declared in a domain crate is reported", () => {
    const result = lint(sample.files, (files) => {
      files[invoice] += "\npub trait InvoiceRepository {\n    fn find_by_id(&self, invoice_id: &str) -> Option<Invoice>;\n}\n";
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "port-placement").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "rust-domain: repository port InvoiceRepository is declared in the domain layer; declare it in the use-case layer",
    ]);
  });

  test("an event with public fields built outside its impl is reported", () => {
    const result = lint(sample.files, (files) =>
      replace(files, invoice, "pub struct InvoiceIssued {\n    invoice_id: String,", "pub struct InvoiceIssued {\n    pub invoice_id: String,"),
    );
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "a: public field InvoiceIssued.invoice_id in domain layer",
    ]);
  });
});

describe("model files", () => {
  const sample = typeScriptSample("class", "named-file");
  const LAST_ONE =
    'idempotency: { strategy: command-id-memory, retention: last-one, rationale: "a client sends the next add-line of an invoice only after the previous one is acknowledged, so an older add-line is never resent after a newer one" }';

  test("a command declares exactly one event", () => {
    const result = lint(sample.files, (files) =>
      replace(files, "docs/ddd/domain-model.yaml", "            event: event.invoice.issued\n", "            events: [event.invoice.issued]\n"),
    );
    const messages = result.findings.filter((entry) => entry.file === "docs/ddd/domain-model.yaml").map((entry) => entry.message);
    expect(messages.join("\n")).toContain('unknown key "events"');
    expect(messages.join("\n")).toContain('"event" must be a non-empty string');
  });

  test("keeping only the last command ID states why an older command is never resent", () => {
    const result = lint(sample.files, (files) =>
      replace(files, "docs/ddd/domain-model.yaml", LAST_ONE, "idempotency: { strategy: command-id-memory, retention: last-one }"),
    );
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "idempotency.last-one: command command.invoice.add-line keeps only the last command ID (retention last-one) but its rationale does not state why an older command is never resent after a newer one",
    ]);
  });

  test("a rationale of blanks does not state why an older command is never resent", () => {
    const result = lint(sample.files, (files) =>
      replace(files, "docs/ddd/domain-model.yaml", LAST_ONE, 'idempotency: { strategy: command-id-memory, retention: last-one, rationale: "   " }'),
    );
    expect(result.findings.map((entry) => entry.rule_id)).toEqual(["idempotency.last-one"]);
  });

  test("an accumulating command without command-id-memory is reported", () => {
    const result = lint(sample.files, (files) =>
      replace(
        files,
        "docs/ddd/domain-model.yaml",
        LAST_ONE,
        "idempotency: { strategy: none }",
      ),
    );
    expect(result.findings.some((entry) => entry.rule_id === "idempotency.j")).toBe(true);
  });

  test("a Domain Primitive declares its value rule or that it has none", () => {
    const model = "docs/ddd/domain-model.yaml";
    const primitive = (id: string, extra = "") =>
      `          - { element_id: primitive.${id}, kind: domain-primitive, name: X, aggregate: aggregate.invoice, attributes: [{ name: value, type: string, required: true }]${extra} }\n        invariants:\n`;
    const findings = (edit: (files: Record<string, string>) => void) =>
      lint(sample.files, edit).findings.filter((entry) => entry.rule_id === "completeness.primitive-rule").map((entry) => entry.message);
    expect(findings((files) => replace(files, model, "        invariants:\n", primitive("invoice-number")))).toEqual([
      'domain-primitive primitive.invoice-number declares no value rule (an invariant on it and a factory rule that builds it) and no "unconstrained" rationale',
    ]);
    expect(findings((files) => replace(files, model, "        invariants:\n", primitive("memo", ", unconstrained: any text the customer writes")))).toEqual([]);
    expect(
      findings((files) =>
        replace(files, model, "name: CustomerId, aggregate: aggregate.invoice,", "name: CustomerId, aggregate: aggregate.invoice, unconstrained: any string,"),
      ),
    ).toEqual(["domain-primitive primitive.customer-id declares unconstrained but also a value rule; keep one"]);
  });

  test("a command without success_type in the mapping is reported", () => {
    const result = lint(sample.files, (files) =>
      replace(files, "docs/ddd/aggregate-mapping.yaml", "method: issue, success_type: IssueInvoiceOutcome,", "method: issue,"),
    );
    expect(result.findings.map((entry) => entry.message).join("\n")).toContain('a command names its "success_type"');
  });

  test("a project without .ddd.toml is reported", () => {
    const result = lint(sample.files, (files) => {
      delete files[".ddd.toml"];
    });
    expect(result.findings.map((entry) => entry.rule_id)).toContain("settings.missing");
  });
});

describe("layer declaration", () => {
  /** The aggregate-only declaration the real run wrote: one package, no port, no repository. */
  const aggregateOnlyLayers = [
    "model_ref: domain-model.yaml",
    "layer_structures:",
    "  - context_ref: bc.billing",
    "    cqrs: false",
    "    packages:",
    '      - { role: command, code: { language: typescript, package: "@acme/billing-domain" } }',
    "    dependencies:",
    '      - { code: { language: typescript, package: "@acme/billing-domain" }, depends_on: [] }',
    "    ports: []",
    "    repositories: []",
    "    restoration_paths:",
    "      - { aggregate_ref: aggregate.invoice, via: full-constructor }",
    "    persistence_backend: none",
    "",
  ].join("\n");

  /** The class sample stripped down to the language-extensions and domain packages. */
  const aggregateOnlyProject = (): Record<string, string> => {
    const files: Record<string, string> = { ...typeScriptSample("class", "named-file").files };
    const kept = Object.entries(files).filter(([path]) => !path.includes("billing-use-case") && !path.includes("billing-interface-adapter"));
    const keptFiles: Record<string, string> = Object.fromEntries(kept);
    keptFiles["tsconfig.json"] = `${JSON.stringify({ files: [], references: ["./packages/infrastructure/language-extensions", "./packages/command/billing-domain"].map((path) => ({ path })) }, null, 2)}\n`;
    return keptFiles;
  };

  const layerFindings = (files: Record<string, string>) =>
    lint(files).findings.filter((entry) => entry.file === "docs/ddd/layer-structure.yaml");

  test("an aggregate-only structure with persistence_backend none is accepted", () => {
    const files = aggregateOnlyProject();
    files["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers;
    expect(layerFindings(files)).toEqual([]);
  });

  test("a persistence-bearing structure with empty ports and repositories is rejected", () => {
    const files = aggregateOnlyProject();
    files["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers
      .replace("persistence_backend: none", "persistence_backend: in-memory");
    expect(layerFindings(files).map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "layer-declaration.required-items: layer_structures[bc.billing]: at least one of the dependencies, ports, repositories and restoration paths of the context is empty",
    ]);
  });

  for (const [present, declaration] of [
    ["ports", "    ports:\n      - { name: InvoiceRepository, kind: repository, verbs: [find_by_id, store] }\n    repositories: []"],
    ["repositories", "    ports: []\n    repositories:\n      - { name: InvoiceRepository, aggregate_ref: aggregate.invoice, io_unit: single, verbs: [find_by_id, store], store_semantics: upsert }"],
  ] as const)
    test(`an aggregate-only exception rejects one-sided ${present}`, () => {
      const files = aggregateOnlyProject();
      files["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers.replace(
        "    ports: []\n    repositories: []",
        declaration,
      );
      expect(layerFindings(files).map((entry) => entry.rule_id)).toContain("layer-declaration.required-items");
    });

  for (const packageName of ["@acme/billing-use-case", "@acme/billing-interface-adapter"])
    test(`an aggregate-only exception is rejected when ${packageName} is declared`, () => {
      const files = aggregateOnlyProject();
      files[`packages/command/${packageName.slice("@acme/".length)}/package.json`] = JSON.stringify({ name: packageName });
      replace(files, "docs/ddd/aggregate-mapping.yaml", "domain_packages:\n",
        `domain_packages:\n  - { term: Billing, model_refs: [bc.billing], rationale: handles billing, code: { language: typescript, package: "${packageName}", module: [] } }\n`);
      files["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers
        .replace(
          '      - { role: command, code: { language: typescript, package: "@acme/billing-domain" } }',
          `      - { role: command, code: { language: typescript, package: "@acme/billing-domain" } }\n      - { role: command, code: { language: typescript, package: "${packageName}" } }`,
        )
        .replace(
          '      - { code: { language: typescript, package: "@acme/billing-domain" }, depends_on: [] }',
          `      - { code: { language: typescript, package: "@acme/billing-domain" }, depends_on: [] }\n      - { code: { language: typescript, package: "${packageName}" }, depends_on: [{ language: typescript, package: "@acme/billing-domain" }] }`,
        );
      const result = lint(files);
      expect(result.unavailable).toEqual([]);
      expect(result.findings.filter((entry) => entry.check === "mapping")).toEqual([]);
      expect(result.findings.map((entry) => entry.rule_id)).toContain("layer-declaration.required-items");
      expect(result.pass).toBe(false);
      expect(result.exitCode).toBe(1);
    });

  for (const language of ["typescript", "rust"] as const)
    for (const classification of ["suffix", "placement"] as const)
      for (const layer of ["domain", "use-case", "interface-adapter"] as const)
        test(`${language} aggregate-only exception checks ${layer} ${classification} despite domain mapping`, () => {
          const files = language === "typescript" ? aggregateOnlyProject() : { ...rustSample("file").files };
          if (language === "rust") {
            for (const path of Object.keys(files))
              if (path.includes("billing-use-case") || path.includes("billing-interface-adapter")) delete files[path];
            files["Cargo.toml"] = '[workspace]\nmembers = ["packages/command/billing-domain"]\nresolver = "2"\n';
          }
          const name = classification === "suffix" ? `billing-${layer}` : "billing";
          const packageName = language === "typescript" ? `@acme/${name}` : name;
          const oldDir = "packages/command/billing-domain";
          const newDir = classification === "suffix" ? `packages/command/${name}` : `packages/command/${layer}/${name}`;
          // Move the mapped package, keeping every declaration and reference consistent. Only its
          // name/placement (the existing layer contract) decides whether the exception applies.
          const moved: Record<string, string> = {};
          for (const [path, content] of Object.entries(files))
            moved[path.replaceAll(oldDir, newDir)] = content
              .replaceAll(oldDir, newDir)
              .replaceAll(language === "typescript" ? "@acme/billing-domain" : "billing-domain", packageName);
          moved["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers
            .replaceAll("language: typescript", `language: ${language}`)
            .replaceAll("@acme/billing-domain", packageName);
          const result = lint(moved);
          expect(result.unavailable).toEqual([]);
          expect(result.findings.filter((entry) => entry.check === "mapping")).toEqual([]);
          if (layer === "domain") {
            expect(result.findings).toEqual([]);
            expect(result.pass).toBe(true);
            expect(result.exitCode).toBe(0);
          } else {
            expect(result.findings.map((entry) => entry.rule_id)).toContain("layer-declaration.required-items");
            expect(result.pass).toBe(false);
            expect(result.exitCode).toBe(1);
          }
        });

  test("an empty dependency list or an empty restoration list is still rejected", () => {
    const withoutDependencyRow = aggregateOnlyProject();
    withoutDependencyRow["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers
      .replace(
        '      - { code: { language: typescript, package: "@acme/billing-domain" }, depends_on: [] }\n',
        "",
      )
      .replace("    dependencies:\n", "    dependencies: []\n");
    expect(layerFindings(withoutDependencyRow).map((entry) => entry.rule_id)).toContain("layer-declaration.dependency-row");

    const withoutRestoration = aggregateOnlyProject();
    withoutRestoration["docs/ddd/layer-structure.yaml"] = aggregateOnlyLayers
      .replace("      - { aggregate_ref: aggregate.invoice, via: full-constructor }\n", "")
      .replace("    restoration_paths:\n", "    restoration_paths: []\n");
    expect(layerFindings(withoutRestoration).map((entry) => entry.rule_id)).toContain("layer-declaration.restoration-path");
  });
});

describe("knowledge examples are the samples", () => {
  const blocks = (path: string) =>
    [...readFileSync(resolve(import.meta.dir, "../../..", path), "utf8").matchAll(/```(ts|rust|yaml|toml)\n([\s\S]*?)```/g)].map(
      (match) => match[2],
    );
  for (const lang of ["en", "ja"]) {
    test(`${lang} ddd-typescript`, () => {
      const examples = blocks(`${lang}/facets/knowledge/ddd-typescript.md`);
      const classSample = typeScriptSample("class", "named-file").files;
      const companionSample = typeScriptSample("companion", "named-file").files;
      expect(examples).toContain(classSample[parentModuleFile("named-file")]);
      expect(examples).toContain(companionSample[parentModuleFile("named-file")]);
      for (const path of [
        "packages/command/billing-domain/src/customer-id.ts",
        "packages/command/billing-domain/src/invoice/lines.ts",
        "packages/infrastructure/language-extensions/src/result.ts",
        "packages/command/billing-use-case/src/invoice-repository.ts",
        "packages/command/billing-use-case/src/issue-invoice.ts",
        "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts",
      ])
        expect(examples).toContain(classSample[path]);
    });
    test(`${lang} ddd-rust`, () => {
      const examples = blocks(`${lang}/facets/knowledge/ddd-rust.md`);
      const files = rustSample("file").files;
      expect(examples).toContain(files[rustParentModuleFile("file")]);
      for (const path of ["customer_id.rs", "invoice/line.rs", "invoice/lines.rs"])
        expect(examples).toContain(files[`packages/command/billing-domain/src/${path}`]);
    });
    test(`${lang} ddd-modeling: the model file examples fit the TypeScript sample`, () => {
      const [model, mapping, layers] = [...readFileSync(resolve(import.meta.dir, "../../..", `${lang}/facets/knowledge/ddd-modeling.md`), "utf8").matchAll(/```yaml\n([\s\S]*?)```/g)].map(
        (match) => match[1],
      );
      const result = lint(typeScriptSample("class", "named-file").files, (files) => {
        files["docs/ddd/domain-model.yaml"] = model ?? "";
        files["docs/ddd/aggregate-mapping.yaml"] = mapping ?? "";
        files["docs/ddd/layer-structure.yaml"] = layers ?? "";
      });
      expect(result.findings).toEqual([]);
    });
  }
});
