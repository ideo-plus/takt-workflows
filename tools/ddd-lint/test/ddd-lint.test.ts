import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { rustParentModuleFile, rustSample, rustSamples } from "./samples/rust.ts";
import { parentModuleFile, typeScriptSample, typeScriptSamples } from "./samples/typescript.ts";

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
): { pass: boolean; findings: Finding[]; unavailable: string[] } {
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
    findings: report.results.flatMap((result) => result.findings.map((entry) => ({ check: result.check, ...entry }))),
    unavailable: report.results.flatMap((result) => (result.unavailable ? [`${result.check}: ${result.unavailable}`] : [])),
  };
}

function replace(files: Record<string, string>, path: string, from: string, to: string): void {
  const content = files[path];
  if (content === undefined || !content.includes(from)) throw new Error(`${path} does not contain ${from}`);
  files[path] = content.replace(from, to);
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

describe("TypeScript", () => {
  const sample = typeScriptSample("class", "named-file");
  const invoice = parentModuleFile("named-file");

  test("a command that changes state in place is reported", () => {
    const result = lint(sample.files, (files) => {
      replace(files, invoice, "  readonly #issued: boolean;", "  #issued: boolean;");
      replace(
        files,
        invoice,
        "    const invoice: Invoice = new Invoice(this.#id, this.#customer, this.#lines, true, [...this.#addLineRequests]);",
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
        "        const invoice: Invoice = Invoice.restore(state.id, state.customer, state.lines, true, [...state.requests]);",
        "        state.issued = true;\n        const invoice: Invoice = instance;",
      ),
    );
    expect(result.findings.map((entry) => `${entry.rule_id}: ${entry.message}`)).toEqual([
      "immutable: method Invoice.issue changes state in place; return a new instance built through the full constructor",
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
      replace(files, invoice, "pub mod line;\n", "pub mod line;\n\n#[cfg(test)]\nmod tests;\n");
      files["packages/command/billing-domain/src/invoice/tests.rs"] =
        "use super::*;\n\n#[test]\nfn opens() {\n    assert!(Invoice::open(\"i1\", \"c1\", Vec::new()).is_ok());\n}\n";
    });
    expect(result.findings).toEqual([]);
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

  test("a command declares exactly one event", () => {
    const result = lint(sample.files, (files) =>
      replace(files, "docs/ddd/domain-model.yaml", "            event: event.invoice.issued\n", "            events: [event.invoice.issued]\n"),
    );
    const messages = result.findings.filter((entry) => entry.file === "docs/ddd/domain-model.yaml").map((entry) => entry.message);
    expect(messages.join("\n")).toContain('unknown key "events"');
    expect(messages.join("\n")).toContain('"event" must be a non-empty string');
  });

  test("an accumulating command without command-id-memory is reported", () => {
    const result = lint(sample.files, (files) =>
      replace(
        files,
        "docs/ddd/domain-model.yaml",
        "idempotency: { strategy: command-id-memory, retention: multiple, retention_count: 1000, rationale: a retried request must not add its line twice }",
        "idempotency: { strategy: none }",
      ),
    );
    expect(result.findings.some((entry) => entry.rule_id === "idempotency.j")).toBe(true);
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
        "packages/infrastructure/language-extensions/src/result.ts",
        "packages/command/billing-use-case/src/invoice-repository.ts",
        "packages/command/billing-use-case/src/issue-invoice.ts",
        "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts",
      ])
        expect(examples).toContain(classSample[path]);
    });
    test(`${lang} ddd-rust`, () => {
      const examples = blocks(`${lang}/facets/knowledge/ddd-rust.md`);
      expect(examples).toContain(rustSample("file").files[rustParentModuleFile("file")]);
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
