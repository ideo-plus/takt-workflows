import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { rustParentModuleFile, rustSample, rustSamples } from "./samples/rust.ts";
import { parentModuleFile, typeScriptSample, typeScriptSamples } from "./samples/typescript.ts";
import { loadAggregateMapping } from "../lib/aggregate-mapping/index.ts";
import { loadDomainModelSource } from "../lib/schema/loader.ts";
import { serializedMemoryExamples } from "./samples/serialized-memory.ts";
import { eventRustSample, eventTypeScriptSample } from "./samples/event-sourcing.ts";

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

describe("Domain Primitive initialization", () => {
  for (const sample of typeScriptSamples()) {
    const path = "packages/command/billing-domain/src/customer-id.ts";
    test(`${sample.name} rejects a constrained primitive without of`, () => {
      const result = lint(sample.files, (files) => {
        files[path] = files[path].replace(/(?:static )?of\(value: string\): CustomerId \{[\s\S]*?\n  \},?\n/, "");
      });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("of"))).toBe(true);
    });
    test(`${sample.name} rejects initialization without its invariant guard`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, path, '    if (!/^C[0-9]{6}$/.test(value)) return { ok: false, error: "invalid-format" };\n', "");
      });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("guard"))).toBe(true);
    });
  }
  for (const sample of rustSamples()) {
    const path = "packages/command/billing-domain/src/customer_id.rs";
    test(`${sample.name} rejects a constrained primitive without of`, () => {
      const result = lint(sample.files, (files) => {
        files[path] = files[path].replace(/    pub fn of\(value: &str\) -> Self \{[\s\S]*?\n    \}\n/, "");
      });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("of"))).toBe(true);
    });
    test(`${sample.name} rejects initialization without its invariant guard`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, path, `        let digits = value.strip_prefix('C').ok_or(ParseCustomerIdError::InvalidFormat)?;
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(ParseCustomerIdError::InvalidFormat);
        }
`, "");
      });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("guard"))).toBe(true);
    });
  }
});

describe("Domain Primitive validated input", () => {
  for (const sample of typeScriptSamples()) {
    const path = "packages/command/billing-domain/src/customer-id.ts";
    test(`${sample.name} rejects of validating a different input`, () => {
      const result = lint(sample.files, (files) => replace(files, path, "CustomerId.parse(value)", 'CustomerId.parse("bad")'));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("of"))).toBe(true);
    });
    test(`${sample.name} rejects initializing a different value after validation`, () => {
      const result = lint(sample.files, (files) => {
        if (files[path].includes("new CustomerId(value)")) replace(files, path, "new CustomerId(value)", 'new CustomerId("bad")');
        else replace(files, path, "const state = { value };", 'const state = { value: "bad" };');
      });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("guard"))).toBe(true);
    });
    test(`${sample.name} rejects a guard mentioning only an unrelated property name`, () => {
      const result = lint(sample.files, (files) => replace(files, path, "!/^C[0-9]{6}$/.test(value)", "({ value: false }).value"));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("guard"))).toBe(true);
    });
  }
  for (const sample of rustSamples()) {
    const path = "packages/command/billing-domain/src/customer_id.rs";
    test(`${sample.name} rejects of validating a different input`, () => {
      const result = lint(sample.files, (files) => replace(files, path, "Self::parse(value)", 'Self::parse("bad")'));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("of"))).toBe(true);
    });
    test(`${sample.name} rejects initializing a different value after validation`, () => {
      const result = lint(sample.files, (files) => replace(files, path, "Ok(Self::new(value.to_string()))", 'Ok(Self::new("bad".to_string()))'));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("guard"))).toBe(true);
    });
  }
});

describe("Domain Primitive construction bypasses", () => {
  for (const sample of typeScriptSamples()) {
    const path = "packages/command/billing-domain/src/customer-id.ts";
    test(`${sample.name} rejects construction before the input guard`, () => {
      const result = lint(sample.files, (files) => {
        if (files[path].includes("new CustomerId(value)")) {
          replace(files, path, '    if (!/^C[0-9]{6}$/.test(value))', '    const unchecked = new CustomerId(value);\n    if (!/^C[0-9]{6}$/.test(value))');
        } else {
          const guard = '    if (!/^C[0-9]{6}$/.test(value)) return { ok: false, error: "invalid-format" };\n';
          replace(files, path, guard, "");
          replace(files, path, '    return { ok: true, value: instance };', guard + '    return { ok: true, value: instance };');
        }
      });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("guard"))).toBe(true);
    });
    if (sample.files[path].includes("private constructor")) {
      test(`${sample.name} rejects a constructor replacing the validated input`, () => {
        const result = lint(sample.files, (files) => replace(files, path, "this.#value = value;", 'this.#value = "bad";'));
        expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("constructor"))).toBe(true);
      });
      test(`${sample.name} rejects another factory bypassing parse`, () => {
        const result = lint(sample.files, (files) => replace(files, path, "  static parse(", '  static unchecked(value: string): CustomerId { return new CustomerId(value); }\n\n  static parse('));
        expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("bypass"))).toBe(true);
      });
    }
  }
  for (const sample of rustSamples()) {
    const path = "packages/command/billing-domain/src/customer_id.rs";
    test(`${sample.name} rejects a free function bypassing parse`, () => {
      const result = lint(sample.files, (files) => { files[path] += '\npub fn unchecked(value: &str) -> CustomerId { CustomerId(value.to_string()) }\n'; });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("bypass"))).toBe(true);
    });
    test(`${sample.name} rejects initialization in an unchecked callback`, () => {
      const result = lint(sample.files, (files) => replace(files, path, "        Ok(Self::new(value.to_string()))", '        let unchecked = || CustomerId("bad".to_string());\n        Ok(Self::new(value.to_string()))'));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("bypass"))).toBe(true);
    });
    test(`${sample.name} rejects an unchecked From conversion`, () => {
      const result = lint(sample.files, (files) => { files[path] += '\nimpl From<String> for CustomerId { fn from(value: String) -> Self { Self(value) } }\n'; });
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("bypass"))).toBe(true);
    });
    test(`${sample.name} rejects derived deserialization bypassing parse`, () => {
      const result = lint(sample.files, (files) => replace(files, path, "pub struct CustomerId", "#[derive(serde::Deserialize)]\npub struct CustomerId"));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("Deserialize"))).toBe(true);
    });
  }
});

describe("Domain Primitive runtime contracts", () => {
  for (const sample of typeScriptSamples()) test(`${sample.name} enforces of and parse at runtime`, () => {
    const dir = writeProject(sample.files, "ddd-primitive-ts-");
    try {
      const code = `import assert from "node:assert/strict";
import { CustomerId } from "./packages/command/billing-domain/src/customer-id.ts";
import { Money } from "./packages/command/billing-domain/src/money.ts";
assert.equal(CustomerId.parse("C000001").ok, true);
assert.equal(CustomerId.parse("bad").ok, false);
assert.throws(() => CustomerId.of("bad"));
assert.equal(CustomerId.of("C000001").equals(CustomerId.of("C000001")), true);
assert.equal(CustomerId.of("C000001").equals(CustomerId.of("C000002")), false);
assert.equal(Money.parse(100).ok, true);
assert.equal(Money.parse(0).ok, true);
assert.equal(Money.of(-100).isNegative(), true);
for (const value of [1, 99, 100.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(Money.parse(value).ok, false);
  assert.throws(() => Money.of(value));
}`;
      const result = spawnSync("bun", ["-e", code], { cwd: dir, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      expect(result.status).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  for (const sample of rustSamples()) test(`${sample.name} enforces of and parse at runtime`, () => {
    const dir = writeProject(sample.files, "ddd-primitive-rust-");
    try {
      const path = join(dir, "packages/command/billing-domain/tests/primitives.rs");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `use billing_domain::{customer_id::CustomerId, money::Money};
#[test]
fn parses_valid_values_and_returns_errors_for_invalid_values() {
    assert!(CustomerId::parse("C000001").is_ok());
    assert!(CustomerId::parse("bad").is_err());
    assert_eq!(CustomerId::of("C000001"), CustomerId::of("C000001"));
    assert_ne!(CustomerId::of("C000001"), CustomerId::of("C000002"));
    assert!(Money::parse(100).is_ok());
    assert!(Money::parse(0).is_ok());
    assert!(Money::of(-100).is_negative());
    assert!(Money::parse(1).is_err());
    assert!(Money::parse(99).is_err());
}
#[test]
#[should_panic]
fn of_rejects_an_invalid_customer_id() { CustomerId::of("bad"); }
#[test]
#[should_panic]
fn of_rejects_an_invalid_money_increment() { Money::of(1); }
`);
      const result = spawnSync("cargo", ["test", "--workspace"], { cwd: dir, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr + result.stdout);
      expect(result.status).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("in-memory aggregate storage", () => {
  for (const sample of [...typeScriptSamples(), ...rustSamples()]) {
    test(`${sample.name} rejects storing a wrapper even without restoration`, () => {
      const result = lint(sample.files, (files) => {
        const rust = sample.name.startsWith("rust");
        const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
        if (rust) {
          replace(files, path, "HashMap<String, Invoice>", "HashMap<String, StoredInvoice>");
          replace(files, path, "self.stored.get(invoice_id).cloned()", "self.stored.get(invoice_id).map(|stored| stored.invoice.clone())");
          replace(files, path, "self.stored.insert(invoice_id.to_string(), invoice)", "self.stored.insert(invoice_id.to_string(), StoredInvoice { invoice })");
          files[path] += '\nstruct StoredInvoice { invoice: Invoice }\n';
        } else {
          replace(files, path, "Map<string, Invoice>", "Map<string, StoredInvoice>");
          replace(files, path, "this.#stored.get(invoiceId)", "this.#stored.get(invoiceId)?.invoice");
          replace(files, path, "this.#stored.set(invoiceId, invoice)", "this.#stored.set(invoiceId, { invoice })");
          files[path] += '\ntype StoredInvoice = { readonly invoice: Invoice };\n';
        }
      });
      expect(result.findings.some((entry) => entry.rule_id === "in-memory-restoration" && entry.message.includes("stores StoredInvoice"))).toBe(true);
    });
    test(`${sample.name} keeps event streams outside the state storage rule`, () => {
      const result = lint(sample.files, (files) => {
        const rust = sample.name.startsWith("rust");
        const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
        replace(files, "docs/ddd/aggregate-mapping.yaml", "persistence_method: state-sourcing", "persistence_method: event-sourcing");
        replace(files, "docs/ddd/layer-structure.yaml", "via: stored-instance", "via: event-replay");
        replace(files, path, rust ? "    stored: HashMap<String, Invoice>," : "  readonly #stored: Map<string, Invoice>;", rust ? "    stored: HashMap<String, Invoice>,\n    events: HashMap<String, Vec<InvoiceIssued>>," : "  readonly #stored: Map<string, Invoice>;\n  readonly #events: Map<string, readonly InvoiceIssued[]> = new Map();");
        files[path] = (rust ? "use billing_domain::invoice::InvoiceIssued;\n" : 'import type { InvoiceIssued } from "@acme/billing-domain";\n') + files[path];
      });
      expect(result.findings.filter((entry) => ["in-memory-restoration", "event-sourcing-storage", "repository-result-contract"].includes(entry.rule_id) || entry.rule_id.startsWith("layer-declaration."))).toEqual([]);
    });
    test(`${sample.name} requires both event streams and an aggregate snapshot for Event Sourcing`, () => {
      const rust = sample.name.startsWith("rust");
      const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
      const declareEventSourcing = (files: Record<string, string>) => {
        replace(files, "docs/ddd/aggregate-mapping.yaml", "persistence_method: state-sourcing", "persistence_method: event-sourcing");
        replace(files, "docs/ddd/layer-structure.yaml", "via: stored-instance", "via: event-replay");
        files[path] = (rust ? "use billing_domain::invoice::InvoiceIssued;\n" : 'import type { InvoiceIssued } from "@acme/billing-domain";\n') + files[path];
      };
      const onlyEvents = lint(sample.files, (files) => {
        declareEventSourcing(files);
        replace(files, path, rust ? "HashMap<String, Invoice>" : "Map<string, Invoice>", rust ? "HashMap<String, Vec<InvoiceIssued>>" : "Map<string, readonly InvoiceIssued[]>");
      });
      expect(onlyEvents.findings.some((entry) => entry.rule_id === "event-sourcing-storage" && entry.message.includes("keeps no aggregate snapshot"))).toBe(true);
      const twoSnapshots = lint(sample.files, (files) => {
        declareEventSourcing(files);
        replace(files, path, rust ? "    stored: HashMap<String, Invoice>," : "  readonly #stored: Map<string, Invoice>;", rust ? "    stored: HashMap<String, Invoice>,\n    copies: HashMap<String, Invoice>,\n    events: HashMap<String, Vec<InvoiceIssued>>," : "  readonly #stored: Map<string, Invoice>;\n  readonly #copies: Map<string, Invoice> = new Map();\n  readonly #events: Map<string, readonly InvoiceIssued[]> = new Map();");
      });
      expect(twoSnapshots.findings.some((entry) => entry.rule_id === "event-sourcing-storage" && entry.message.includes("more than one snapshot map"))).toBe(true);
    });
    test(`${sample.name} rejects aggregate state storage declared as Event Sourcing`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, "docs/ddd/aggregate-mapping.yaml", "persistence_method: state-sourcing", "persistence_method: event-sourcing");
        replace(files, "docs/ddd/layer-structure.yaml", "via: stored-instance", "via: event-replay");
      });
      expect(result.findings.some((entry) => entry.rule_id === "event-sourcing-storage")).toBe(true);
    });
    test(`${sample.name} requires event replay for Event Sourcing`, () => {
      const result = lint(sample.files, (files) => replace(files, "docs/ddd/aggregate-mapping.yaml", "persistence_method: state-sourcing", "persistence_method: event-sourcing"));
      expect(result.findings.some((entry) => entry.rule_id === "layer-declaration.restoration-path" && entry.message.includes("event-replay"))).toBe(true);
    });
    test(`${sample.name} rejects the former in-memory restoration declaration`, () => {
      const result = lint(sample.files, (files) =>
        replace(files, "docs/ddd/layer-structure.yaml", "via: stored-instance", "via: full-constructor"),
      );
      expect(result.findings.some((entry) => entry.rule_id === "layer-declaration.restoration-path")).toBe(true);
    });
    test(`${sample.name} rejects reconstructing a stored aggregate`, () => {
      const result = lint(sample.files, (files) => {
        const rust = sample.name.startsWith("rust");
        const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
        files[path] = rust ? serializedMemoryExamples.rust : serializedMemoryExamples.typescript;
      });
      expect(result.findings.some((entry) => entry.rule_id === "in-memory-restoration")).toBe(true);
    });
    test(`${sample.name} permits restoration from an external persisted representation`, () => {
      const result = lint(sample.files, (files) => {
        const rust = sample.name.startsWith("rust");
        const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
        files[path] = rust ? serializedMemoryExamples.rust : serializedMemoryExamples.typescript;
        replace(files, "docs/ddd/layer-structure.yaml", "persistence_backend: in-memory", "persistence_backend: file");
        replace(files, "docs/ddd/layer-structure.yaml", "via: stored-instance", "via: full-constructor");
      });
      expect(result.findings.filter((entry) => entry.rule_id === "in-memory-restoration")).toEqual([]);
    });
  }
});

for (const sample of typeScriptSamples()) test(`${sample.name} rejects a wrapper in explicit Map initializer arguments`, () => {
  const path = "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
  const result = lint(sample.files, (files) => replace(files, path, "readonly #stored: Map<string, Invoice>;", "readonly #stored = new Map<string, StoredInvoice>();"));
  expect(result.findings.some((entry) => entry.rule_id === "in-memory-restoration" && entry.message.includes("stores StoredInvoice"))).toBe(true);
});

describe("repository Result contracts", () => {
  for (const sample of typeScriptSamples()) {
    const path = "packages/command/billing-use-case/src/invoice-repository.ts";
    test(`${sample.name} rejects a per-operation Result alias without additional meaning`, () => {
      const result = lint(sample.files, (files) => { files[path] += '\nexport type StoreInvoiceResult = Result<void, RepositoryError>;\n'; });
      expect(result.findings.some((entry) => entry.rule_id === "repository-result-contract")).toBe(true);
    });
    test(`${sample.name} accepts a reusable generic Result alias`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, path, 'store(invoiceId: string, invoice: Invoice): Result<void, RepositoryError>', 'store(invoiceId: string, invoice: Invoice): StoreResult<RepositoryError>');
        files[path] += '\nexport type StoreResult<E> = Result<void, E>;\n';
      });
      expect(result.findings).toEqual([]);
    });
    test(`${sample.name} rejects a persistence wrapper as the loaded aggregate`, () => {
      const result = lint(sample.files, (files) => replace(files, path, 'Result<Invoice | undefined, RepositoryError>', 'Result<StoredInvoice | undefined, RepositoryError>'));
      expect(result.findings.some((entry) => entry.rule_id === "repository-result-contract")).toBe(true);
    });
    test(`${sample.name} rejects a different repository error type`, () => {
      const result = lint(sample.files, (files) => replace(files, path, 'Result<void, RepositoryError>', 'Result<void, StoreInvoiceError>'));
      expect(result.findings.some((entry) => entry.rule_id === "repository-result-contract")).toBe(true);
    });
  }
  for (const sample of rustSamples()) {
    const path = "packages/command/billing-use-case/src/invoice_repository.rs";
    test(`${sample.name} rejects a per-operation Result alias without additional meaning`, () => {
      const result = lint(sample.files, (files) => { files[path] += '\npub type StoreInvoiceResult = Result<(), RepositoryError>;\n'; });
      expect(result.findings.some((entry) => entry.rule_id === "repository-result-contract")).toBe(true);
    });
    test(`${sample.name} accepts a reusable generic Result alias`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, path, 'fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>', 'fn store(&mut self, invoice_id: &str, invoice: Invoice) -> StoreResult<RepositoryError>');
        files[path] += '\npub type StoreResult<E> = Result<(), E>;\n';
      });
      expect(result.findings).toEqual([]);
    });
    test(`${sample.name} rejects a persistence wrapper as the loaded aggregate`, () => {
      const result = lint(sample.files, (files) => replace(files, path, 'Result<Option<Invoice>, RepositoryError>', 'Result<Option<StoredInvoice>, RepositoryError>'));
      expect(result.findings.some((entry) => entry.rule_id === "repository-result-contract")).toBe(true);
    });
    test(`${sample.name} rejects a different repository error type`, () => {
      const result = lint(sample.files, (files) => replace(files, path, 'Result<(), RepositoryError>', 'Result<(), StoreInvoiceError>'));
      expect(result.findings.some((entry) => entry.rule_id === "repository-result-contract")).toBe(true);
    });
  }
});

describe("Rust sample domain model generation", () => {
  for (const sample of rustSamples())
    test(`${sample.layout} declares Money with its domain invariant and parser`, () => {
      const source = sample.files["docs/ddd/domain-model.yaml"] ?? "";
      const loaded = loadDomainModelSource(source, "docs/ddd/domain-model.yaml");
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const money = loaded.model.bounded_contexts[0]?.aggregates[0]?.elements.find(
        (element) => element.element_id === "primitive.money",
      );
      expect(money?.kind).toBe("domain-primitive");
      const aggregate = loaded.model.bounded_contexts[0]!.aggregates[0]!;
      expect(aggregate.invariants.some((entry) => entry.element === money?.element_id && entry.element_id === "invariant.invoice.money-increment")).toBe(true);
      expect(aggregate.factory_rules.some((entry) => entry.target_element === money?.element_id && entry.preconditions.includes("invariant.invoice.money-increment"))).toBe(true);
    });
});

describe("Rust sample aggregate mapping", () => {
  for (const sample of rustSamples())
    test(`${sample.layout} maps Money to a module of its own`, () => {
      const dir = writeProject(sample.files, "ddd-rust-mapping-");
      try {
        const loaded = loadAggregateMapping(join(dir, "docs/ddd/aggregate-mapping.yaml"));
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const money = loaded.mapping.domain_packages.find((entry) => entry.term === "Money");
        expect(money?.model_refs).toEqual(["primitive.money"]);
        expect(money?.code).toEqual({
          language: "rust",
          package: "billing-domain",
          module: ["money"],
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
});

describe("primary constructor contracts", () => {
  for (const sample of typeScriptSamples()) {
    const file = "packages/command/billing-domain/src/money.ts";
    if (sample.representation === "class") {
      test(`${sample.name}: primary constructor must be private`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "private constructor", "constructor"));
        expect(result.findings.some((entry) => entry.rule_id === "primary-constructor")).toBe(true);
      });
      test(`${sample.name}: primary constructor must assign all state`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "this.#value = value;", ""));
        expect(result.findings.some((entry) => entry.rule_id === "primary-constructor")).toBe(true);
      });
      test(`${sample.name}: cyclic auxiliary paths are rejected`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "  static of(", "  static first(value: number): Money { return Money.second(value); }\n  static second(value: number): Money { return Money.first(value); }\n\n  static of("));
        expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("cycle"))).toBe(true);
      });
      test(`${sample.name}: indirect delegation reaches the sole constructor`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "  static of(", "  static make(value: number): Money { return Money.of(value); }\n\n  static of("));
        expect(result.findings).toEqual([]);
      });
      test(`${sample.name}: an opaque auxiliary constructor cannot skip delegation verification`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "  static of(", "  static build(factory: () => Money): Money { return factory(); }\n\n  static of("));
        expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("reach"))).toBe(true);
      });
      test(`${sample.name}: overload declarations are not multiple implementations`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "  private constructor(value: number) {", "  private constructor(value: number);\n  private constructor(value: number) {"));
        expect(result.findings.filter((entry) => entry.rule_id === "primary-constructor")).toEqual([]);
      });
    } else {
      test(`${sample.name}: two direct initialization factories are rejected`, () => {
        const result = lint(sample.files, (files) => {
          const source = files[file]; const begin = source.indexOf("  parse(value:"), end = source.indexOf("  zero():", begin);
          const duplicate = source.slice(begin, end).replace("  parse(value:", "  otherParse(value:");
          files[file] = source.slice(0,end) + duplicate + source.slice(end);
        });
        expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("found 2"))).toBe(true);
      });
      test(`${sample.name}: constructor cycles are rejected`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "  of(value:", "  first(value: number): Money { return Money.second(value); },\n  second(value: number): Money { return Money.first(value); },\n  of(value:"));
        expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("cycle"))).toBe(true);
      });
      test(`${sample.name}: indirect delegation and delayed instance operations remain valid`, () => {
        const result = lint(sample.files, (files) => replace(files, file, "  of(value:", "  make(value: number): Money { return Money.of(value); },\n  of(value:"));
        expect(result.findings).toEqual([]);
      });
    }
  }
  for (const sample of rustSamples()) {
    const file = "packages/command/billing-domain/src/money.rs";
    test(`${sample.name}: primary constructor must be private`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "fn new(value:", "pub fn new(value:"));
      expect(result.findings.some((entry) => entry.rule_id === "primary-constructor")).toBe(true);
    });
    test(`${sample.name}: duplicate raw initialization definitions are rejected`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "    fn new(", "    fn other(value: i64) -> Self { Self(value) }\n\n    fn new("));
      expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("found 2"))).toBe(true);
    });
    test(`${sample.name}: cyclic auxiliary paths are rejected`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "    pub fn of(", "    pub fn first(value: i64) -> Self { Self::second(value) }\n    pub fn second(value: i64) -> Self { Self::first(value) }\n\n    pub fn of("));
      expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("cycle"))).toBe(true);
    });
    test(`${sample.name}: direct primary calls cannot bypass parsed invariants`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "    pub fn of(", "    pub fn unchecked(value: i64) -> Self { Self::new(value) }\n\n    pub fn of("));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("bypass"))).toBe(true);
    });
    test(`${sample.name}: primary constructor preserves validated input`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "Self { Self(value) }", "Self { Self(value + 100) }"));
      expect(result.findings.some((entry) => entry.rule_id === "primitive-initialization" && entry.message.includes("unchanged"))).toBe(true);
    });
    test(`${sample.name}: indirect checked auxiliary paths remain valid`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "    pub fn of(", "    pub fn make(value: i64) -> Self { Self::of(value) }\n\n    pub fn of("));
      expect(result.findings).toEqual([]);
    });
    test(`${sample.name}: an opaque auxiliary constructor cannot skip delegation verification`, () => {
      const result = lint(sample.files, (files) => replace(files, file, "    pub fn of(", "    pub fn build(factory: fn() -> Self) -> Self { factory() }\n\n    pub fn of("));
      expect(result.findings.some((entry) => entry.rule_id === "primary-constructor" && entry.message.includes("reach"))).toBe(true);
    });
    test(`${sample.name}: cfg(test) helper structs are outside the construction rules`, () => {
      const result = lint(sample.files, (files) => {
        files[rustParentModuleFile(sample.layout)] += "\n#[cfg(test)]\nstruct Fixture {\n    value: i64,\n}\n\n#[cfg(test)]\nmod helpers {\n    struct Helper {\n        value: i64,\n    }\n}\n";
      });
      expect(result.findings).toEqual([]);
    });
    test(`${sample.name}: cfg(test) helper factories are outside the naming rules`, () => {
      const result = lint(sample.files, (files) => {
        files[rustParentModuleFile(sample.layout)] += "\n#[cfg(test)]\nstruct Fixture {\n    value: i64,\n}\n\n#[cfg(test)]\nimpl Fixture {\n    fn of(value: i64) -> Option<Self> {\n        Some(Self { value })\n    }\n}\n";
      });
      expect(result.findings).toEqual([]);
    });
  }
});

describe("domain factory naming", () => {
  function declareConversion(files: Record<string, string>, rust: boolean): void {
    const model: any = Bun.YAML.parse(files["docs/ddd/domain-model.yaml"]!);
    model.bounded_contexts[0].aggregates[0].factory_rules.push({
      element_id: "factory.invoice.convert-money-text", name: "ConvertMoneyText", target_element: "primitive.money",
      preconditions: ["invariant.invoice.money-increment"],
      domain_errors: [{ element_id: "error.invoice.convert-money-text.invalid-amount", name: "InvalidAmount", operation: "factory.invoice.convert-money-text", condition: "the text is not a valid monetary amount" }],
    });
    files["docs/ddd/domain-model.yaml"] = Bun.YAML.stringify(model);
    const mapping: any = Bun.YAML.parse(files["docs/ddd/aggregate-mapping.yaml"]!);
    mapping.aggregate_mappings[0].operations.push({ operation_ref: "factory.invoice.convert-money-text", code: { method: rust ? "try_from" : "from", error_type: "ConvertMoneyError" }, errors: [{ error_ref: "error.invoice.convert-money-text.invalid-amount", code: { case: rust ? "InvalidAmount" : "invalid-amount" } }] });
    files["docs/ddd/aggregate-mapping.yaml"] = Bun.YAML.stringify(mapping);
  }
  for (const sample of typeScriptSamples()) {
    const line = "packages/command/billing-domain/src/invoice/line.ts";
    const money = "packages/command/billing-domain/src/money.ts";
    const addMethod = (files: Record<string, string>, path: string, method: string) => {
      const prefix = sample.representation === "class" ? "  static " : "  ";
      replace(files, path, `${prefix}of(`, `${prefix}${method}${sample.representation === "companion" ? "," : ""}\n\n${prefix}of(`);
    };
    const cases = [
      ["parse returns Result", line, "parse(source: Money): InvoiceLine { return InvoiceLine.of(source); }"],
      ["from accepts one source", line, "from(left: Money, right: Money): InvoiceLine { return InvoiceLine.of(left.add(right)); }"],
      ["from does not copy its own type", line, "from(source: InvoiceLine): InvoiceLine { return source; }"],
      ["from does not replace primitive of/parse", money, "from(value: number): Money { return Money.of(value); }"],
    ] as const;
    for (const [name, path, method] of cases)
      test(`${sample.name}: ${name}`, () => {
        const result = lint(sample.files, (files) => addMethod(files, path, method));
        expect(result.findings.some((entry) => entry.rule_id === "factory-naming")).toBe(true);
      });
    test(`${sample.name}: of returns a value rather than an unnecessary Result`, () => {
      const result = lint(sample.files, (files) => {
        files[line] = 'import type { Result } from "@acme/language-extensions";\n' + files[line];
        replace(files, line, "of(amount: Money): InvoiceLine", "of(amount: Money): Result<InvoiceLine, never>");
        replace(files, line, sample.representation === "class" ? "return new InvoiceLine(amount);" : "return instance;", sample.representation === "class" ? "return { ok: true, value: new InvoiceLine(amount) };" : "return { ok: true, value: instance };");
      });
      expect(result.findings.some((entry) => entry.rule_id === "factory-naming")).toBe(true);
    });
    test(`${sample.name}: of does not create an Entity`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, parentModuleFile(sample.layout), sample.representation === "class" ? "static open(" : "  open(", sample.representation === "class" ? "static of(" : "  of(");
        replace(files, "docs/ddd/aggregate-mapping.yaml", "method: open,", "method: of,");
      });
      expect(result.findings.some((entry) => entry.rule_id === "factory-naming" && entry.message.includes("Entity"))).toBe(true);
    });
    test(`${sample.name}: value factories, conversions, typed parse and standard calls remain valid`, () => {
      const result = lint(sample.files, (files) => {
        addMethod(files, line, "from(source: Money): InvoiceLine { return InvoiceLine.of(source); }");
        addMethod(files, line, 'create(source: Money): InvoiceLine { return InvoiceLine.of(source); }');
        addMethod(files, money, 'generate(seed: number): Money { return Money.of(Number.parseInt(String(seed), 10) * 100); }');
        if (sample.representation === "class") replace(files, line, "  addTo(", "  valueOf(): InvoiceLine { return this; }\n\n  addTo(");
      });
      expect(result.findings).toEqual([]);
      expect(result.unavailable).toEqual([]);
    });
    test(`${sample.name}: aliases cannot conceal a same-type copy`, () => {
      const result = lint(sample.files, (files) => {
        files[line] = 'type SourceLine = InvoiceLine;\n' + files[line];
        addMethod(files, line, "from(source: SourceLine): InvoiceLine { return source; }");
      });
      expect(result.findings.some((entry) => entry.rule_id === "factory-naming")).toBe(true);
    });
    test(`${sample.name}: a declared DP conversion still initializes through its typed parse`, () => {
      const result = lint(sample.files, (files) => {
        declareConversion(files, false);
        files[money] = 'export type ConvertMoneyError = "invalid-amount";\n' + files[money];
        addMethod(files, money, 'from(source: string): Result<Money, ConvertMoneyError> { const parsed = Money.parse(Number(source)); if (!parsed.ok) return { ok: false, error: "invalid-amount" }; return parsed; }');
      });
      expect(result.findings).toEqual([]);
      expect(result.unavailable).toEqual([]);
    });
  }
  for (const sample of rustSamples()) {
    const line = "packages/command/billing-domain/src/invoice/line.rs";
    const money = "packages/command/billing-domain/src/money.rs";
    const addMethod = (files: Record<string, string>, path: string, method: string) =>
      replace(files, path, "    pub fn of(", `    pub fn ${method}\n\n    pub fn of(`);
    const cases = [
      ["parse returns Result", line, "parse(source: Money) -> Self { Self::of(source) }"],
      ["from accepts one source", line, "from(left: Money, right: Money) -> Self { let mut total = left; total.add(&right); Self::of(total) }"],
      ["from does not copy its own type", line, "from(source: Self) -> Self { source }"],
      ["from does not replace primitive of/parse", money, "from(value: i64) -> Self { Self::of(value) }"],
      ["fallible conversion uses try_from", line, "from(source: Money) -> Result<Self, ()> { Ok(Self::of(source)) }"],
      ["try_from returns Result", line, "try_from(source: Money) -> Self { Self::of(source) }"],
      ["borrowed same-type conversion is a copy", line, "from<'a>(source: &'a Self) -> Self { source.clone() }"],
    ] as const;
    for (const [name, path, method] of cases)
      test(`${sample.name}: ${name}`, () => {
        const result = lint(sample.files, (files) => addMethod(files, path, method));
        expect(result.findings.some((entry) => entry.rule_id === "factory-naming")).toBe(true);
      });
    test(`${sample.name}: of returns a value rather than an unnecessary Result`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, line, "of(amount: Money) -> Self", "of(amount: Money) -> Result<Self, std::convert::Infallible>");
        replace(files, line, "InvoiceLine { amount }", "Ok(InvoiceLine { amount })");
      });
      expect(result.findings.some((entry) => entry.rule_id === "factory-naming")).toBe(true);
    });
    test(`${sample.name}: of does not create an Entity`, () => {
      const result = lint(sample.files, (files) => {
        replace(files, rustParentModuleFile(sample.layout), "pub fn open(", "pub fn of(");
        replace(files, "docs/ddd/aggregate-mapping.yaml", "method: open,", "method: of,");
      });
      expect(result.findings.some((entry) => entry.rule_id === "factory-naming" && entry.message.includes("Entity"))).toBe(true);
    });
    test(`${sample.name}: inherent and standard trait conversions preserve the construction contract`, () => {
      const result = lint(sample.files, (files) => {
        addMethod(files, line, "try_from(source: Money) -> Result<Self, ()> { Ok(Self::of(source)) }");
        files[line] += "\nimpl From<Money> for InvoiceLine { fn from(source: Money) -> Self { Self::of(source) } }\n";
      });
      expect(result.findings).toEqual([]);
    });
    test(`${sample.name}: a declared DP conversion still initializes through its typed parse`, () => {
      const result = lint(sample.files, (files) => {
        declareConversion(files, true);
        files[money] = '#[derive(Debug, Clone, Copy, PartialEq, Eq)]\npub enum ConvertMoneyError { InvalidAmount }\n' + files[money];
        addMethod(files, money, 'try_from(source: &str) -> Result<Self, ConvertMoneyError> { let value = source.parse::<i64>().map_err(|_| ConvertMoneyError::InvalidAmount)?; Self::parse(value).map_err(|_| ConvertMoneyError::InvalidAmount) }');
      });
      expect(result.findings).toEqual([]);
    });
  }
});

describe("sample builds", () => {
  for (const layout of ["named-file", "index-file"] as const) {
    test(`Event Sourcing TypeScript ${layout} passes lint`, () => expect(lint(eventTypeScriptSample(layout).files).findings).toEqual([]));
    test(`Event Sourcing TypeScript ${layout} builds`, () => expect(buildTypeScriptSample(eventTypeScriptSample(layout).files)).toBe(0));
  }
  for (const layout of ["file", "mod-rs"] as const) {
    test(`Event Sourcing Rust ${layout} passes lint`, () => expect(lint(eventRustSample(layout).files).findings).toEqual([]));
    test(`Event Sourcing Rust ${layout} builds`, () => expect(buildRustSample(eventRustSample(layout).files)).toBe(0));
  }
  for (const sample of typeScriptSamples())
    test(`${sample.name} builds with TypeScript`, () => expect(buildTypeScriptSample(sample.files)).toBe(0));
  for (const sample of rustSamples())
    test(`${sample.name} builds with Cargo`, () => expect(buildRustSample(sample.files)).toBe(0));
});

describe("Event Sourcing repository contract", () => {
  for (const sample of [eventTypeScriptSample(), eventRustSample()]) {
    test(`${sample.name} rejects primitive values as event streams`, () => {
      const rust = sample.name.includes("rust");
      const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
      const aliased = lint(sample.files, (files) => {
        replace(files, path, rust ? "use billing_domain::invoice::{Invoice, InvoiceEvent};" : 'import type { InvoiceEvent } from "@acme/billing-domain";', rust ? "use billing_domain::invoice::Invoice;\nuse billing_domain::money::Money as InvoiceEvent;" : 'import type { Money as InvoiceEvent } from "@acme/billing-domain";');
      });
      expect(aliased.findings.some((finding) => finding.rule_id === "event-sourcing-storage")).toBe(true);
    });
    test(`${sample.name} keeps loadEvents outside the repository port`, () => {
      const rust = sample.name.includes("rust");
      const path = rust ? "packages/command/billing-use-case/src/invoice_repository.rs" : "packages/command/billing-use-case/src/invoice-repository.ts";
      const result = lint(sample.files, (files) => replace(files, path, rust ? "find_by_id" : "findById", rust ? "load_events" : "loadEvents"));
      expect(result.findings.some((finding) => finding.rule_id === "repository-result-contract")).toBe(true);
    });
    test(`${sample.name} returns an aggregate rather than exposing history`, () => {
      const path = sample.name.includes("typescript") ? "packages/command/billing-use-case/src/invoice-repository.ts" : "packages/command/billing-use-case/src/invoice_repository.rs";
      const result = lint(sample.files, (files) => replace(files, path, sample.name.includes("typescript") ? "Result<Invoice | undefined, RepositoryError>" : "Result<Option<Invoice>, RepositoryError>", sample.name.includes("typescript") ? "Result<readonly InvoiceEvent[] | undefined, RepositoryError>" : "Result<Option<Vec<InvoiceEvent>>, RepositoryError>"));
      expect(result.findings.some((finding) => finding.rule_id === "repository-result-contract")).toBe(true);
    });
    test(`${sample.name} stores the event with the aggregate snapshot after it`, () => {
      const rust = sample.name.includes("rust");
      const path = rust ? "packages/command/billing-use-case/src/invoice_repository.rs" : "packages/command/billing-use-case/src/invoice-repository.ts";
      const stated = rust ? "fn store(&mut self, event: InvoiceEvent, snapshot: Invoice)" : "store(event: InvoiceEvent, snapshot: Invoice)";
      for (const wrong of rust
        ? ["fn store(&mut self, invoice_id: &str, event: InvoiceEvent)", "fn store(&mut self, event: InvoiceEvent)", "fn store(&mut self, snapshot: Invoice, event: InvoiceEvent)", "fn store(&mut self, event: Invoice, snapshot: Invoice)"]
        : ["store(invoiceId: string, event: InvoiceEvent)", "store(event: InvoiceEvent)", "store(snapshot: Invoice, event: InvoiceEvent)", "store(event: Invoice, snapshot: Invoice)"]) {
        const result = lint(sample.files, (files) => replace(files, path, stated, wrong));
        expect(result.findings.filter((finding) => finding.rule_id === "event-sourcing-store").length).toBe(1);
      }
      const borrowed = lint(sample.files, (files) => replace(files, path, stated, rust ? "fn store(&mut self, event: &InvoiceEvent, snapshot: &Invoice)" : stated));
      expect(borrowed.findings.filter((finding) => finding.rule_id === "event-sourcing-store")).toEqual([]);
    });
    test(`${sample.name} exposes nothing beyond the repository port`, () => {
      const rust = sample.name.includes("rust");
      const path = rust ? "packages/command/billing-interface-adapter/src/in_memory_invoice_repository.rs" : "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts";
      const accessor = lint(sample.files, (files) => {
        if (rust) replace(files, path, "impl InvoiceRepository for InMemoryInvoiceRepository {", "impl InMemoryInvoiceRepository {\n    pub fn events_for(&self, invoice_id: &str) -> &[InvoiceEvent] { self.events.get(invoice_id).map(Vec::as_slice).unwrap_or(&[]) }\n    fn helper(&self) -> usize { self.events.len() }\n}\n\nimpl InvoiceRepository for InMemoryInvoiceRepository {");
        else replace(files, path, "  findById(invoiceId: string)", "  eventsFor(invoiceId: string): readonly InvoiceEvent[] {\n    return this.#events.get(invoiceId) ?? [];\n  }\n\n  #helper(): number {\n    return this.#events.size;\n  }\n\n  findById(invoiceId: string)");
      });
      const reported = accessor.findings.filter((finding) => finding.rule_id === "repository-adapter-surface");
      expect(reported.length).toBe(1);
      expect(reported[0]!.message).toContain(rust ? "events_for" : "eventsFor");
      const field = lint(sample.files, (files) => replace(files, path, rust ? "    snapshot_interval: u64," : "  readonly #snapshotInterval: number;", rust ? "    pub snapshot_interval: u64," : "  readonly snapshotInterval: number;"));
      expect(field.findings.filter((finding) => finding.rule_id === "repository-adapter-surface").length).toBe(1);
    });
    test(`${sample.name} rejects a creation event attributed to a primitive parser`, () => {
      const result = lint(sample.files, (files) => replace(files, "docs/ddd/domain-model.yaml", "produced_by: factory.invoice.open", "produced_by: factory.invoice.parse-money"));
      expect(result.findings.some((finding) => finding.rule_id === "schema.creation-event-producer")).toBe(true);
    });
  }
  test("TypeScript replays the events after the latest snapshot inside the repository", () => {
    const dir = writeProject(eventTypeScriptSample().files, "ddd-es-runtime-");
    try {
      const scope = join(dir,"node_modules/@acme"); mkdirSync(scope,{recursive:true});
      for(const [name,relative] of [["language-extensions","packages/infrastructure/language-extensions"],["billing-domain","packages/command/billing-domain"],["billing-use-case","packages/command/billing-use-case"],["billing-interface-adapter","packages/command/billing-interface-adapter"]]) symlinkSync(join(dir,relative!),join(scope,name!),"dir");
      const code = `import assert from 'node:assert/strict';
import {Invoice,CustomerId,InvoiceLine,InvoiceLines,Money} from '@acme/billing-domain';
import {IssueInvoiceUseCase} from '@acme/billing-use-case';
import {InMemoryInvoiceRepository} from '@acme/billing-interface-adapter';
const open=(id)=>{const opened=Invoice.open(id,CustomerId.of('C000001'),InvoiceLines.of([InvoiceLine.of(Money.of(100))])); if(!opened.ok)throw Error('open'); return opened.value;};
const addLine=(invoice,commandId)=>{const added=invoice.addLine(commandId,InvoiceLine.of(Money.of(100))); if(!added.ok||added.value.kind!=='applied')throw Error('add'); return added.value;};
const initial=open('i1');
assert.equal(initial.sequenceNumber(),1);
assert.throws(()=>new InMemoryInvoiceRepository(0));
const repository=new InMemoryInvoiceRepository(2);
assert.deepEqual(repository.findById('missing'),{ok:true,value:undefined});
assert.equal(repository.store(initial.openedEvent(),open('i2')).ok,false);
assert.equal(repository.store(initial.openedEvent(),initial).ok,true);
const second=addLine(repository.findById('i1').value,'c1');
assert.equal(second.event.sequenceNumber,2);
assert.equal(repository.findById('i1').value.lines().length,1);
assert.equal(repository.store(second.event,initial).ok,false);
assert.equal(repository.store(second.event,second.invoice).ok,true);
assert.equal(repository.store(second.event,second.invoice).ok,false);
assert.equal(repository.findById('i1').value.addLine('c1',InvoiceLine.of(Money.of(100))).value.kind,'duplicate');
const third=addLine(repository.findById('i1').value,'c2');
assert.equal(repository.store(third.event,third.invoice).ok,true);
const latest=repository.findById('i1').value;
assert.equal(latest.sequenceNumber(),3);
assert.equal(latest.lines().length,3);
assert.equal(new IssueInvoiceUseCase(repository).execute('i1').ok,true);
assert.equal(new IssueInvoiceUseCase(repository).execute('i1').ok,false);
assert.equal(repository.findById('i1').value.sequenceNumber(),4);
assert.throws(()=>Invoice.replay([initial.openedEvent()],initial));
assert.throws(()=>Invoice.replay([second.event,second.event],initial));`;
      const result=spawnSync("bun",["-e",code],{cwd:dir,encoding:"utf8"});
      if(result.status!==0)throw Error(result.stderr+result.stdout); expect(result.status).toBe(0);
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
  test("Rust replays the events after the latest snapshot inside the repository", () => {
    const dir=writeProject(eventRustSample().files,"ddd-es-rust-runtime-");
    try {
      const path=join(dir,"packages/command/billing-interface-adapter/tests/history.rs");mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,`use billing_domain::{customer_id::CustomerId,invoice::{AddInvoiceLineOutcome,Invoice,InvoiceEvent,line::InvoiceLine,lines::InvoiceLines},money::Money};
use billing_use_case::{invoice_repository::InvoiceRepository,issue_invoice::IssueInvoiceUseCase};
use billing_interface_adapter::in_memory_invoice_repository::InMemoryInvoiceRepository;
fn open(id: &str) -> Invoice { Invoice::open(id,CustomerId::of("C000001"),InvoiceLines::of(vec![InvoiceLine::of(Money::of(100))])).unwrap() }
fn add_line(invoice: &mut Invoice, command_id: &str) -> InvoiceEvent {
 let AddInvoiceLineOutcome::Applied(event)=invoice.add_line(command_id,InvoiceLine::of(Money::of(100))).unwrap() else { panic!("applied") };
 InvoiceEvent::LineAdded(event)
}
#[test] fn find_by_id_replays_the_events_after_the_latest_snapshot() {
 let initial=open("i1");
 assert_eq!(initial.sequence_number(),1);
 let mut repository=InMemoryInvoiceRepository::new(2);
 assert!(repository.find_by_id("missing").unwrap().is_none());
 assert!(repository.store(InvoiceEvent::Opened(initial.opened_event()),open("i2")).is_err());
 repository.store(InvoiceEvent::Opened(initial.opened_event()),initial.clone()).unwrap();
 let mut second=repository.find_by_id("i1").unwrap().unwrap();
 let added=add_line(&mut second,"c1");
 assert_eq!(added.sequence_number(),2);
 assert_eq!(repository.find_by_id("i1").unwrap().unwrap().lines().to_vec().len(),1);
 assert!(repository.store(added.clone(),initial.clone()).is_err());
 repository.store(added.clone(),second.clone()).unwrap();
 assert!(repository.store(added.clone(),second).is_err());
 let mut third=repository.find_by_id("i1").unwrap().unwrap();
 assert_eq!(third.add_line("c1",InvoiceLine::of(Money::of(100))).unwrap(),AddInvoiceLineOutcome::Duplicate);
 let next=add_line(&mut third,"c2");
 repository.store(next,third).unwrap();
 let latest=repository.find_by_id("i1").unwrap().unwrap();
 assert_eq!(latest.sequence_number(),3);
 assert_eq!(latest.lines().to_vec().len(),3);
 assert!(IssueInvoiceUseCase::new(&mut repository).execute("i1").is_ok());
 assert!(IssueInvoiceUseCase::new(&mut repository).execute("i1").is_err());
 assert_eq!(repository.find_by_id("i1").unwrap().unwrap().sequence_number(),4);
 assert!(Invoice::replay(&[InvoiceEvent::Opened(initial.opened_event())],initial.clone()).is_err());
 assert!(Invoice::replay(&[added.clone(),added],initial).is_err());
}
#[test] #[should_panic] fn a_zero_snapshot_interval_is_rejected() { InMemoryInvoiceRepository::new(0); }`);
      const result=spawnSync("cargo",["test","--workspace"],{cwd:dir,encoding:"utf8"});if(result.status!==0)throw Error(result.stderr+result.stdout);expect(result.status).toBe(0);
    } finally {rmSync(dir,{recursive:true,force:true});}
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

  test("a use case type not named <Verb><Object>UseCase is reported", () => {
    const result = lint(sample.files, (files) => {
      replace(files, "packages/command/billing-use-case/src/issue-invoice.ts", "export class IssueInvoiceUseCase {", "export class IssueInvoice {");
      replace(files, "packages/command/billing-use-case/src/index.ts", "export { IssueInvoiceUseCase }", "export { IssueInvoice }");
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "use-case-name").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "typescript-use-case: use case IssueInvoice is not named <Verb><Object>UseCase; name it IssueInvoiceUseCase",
    ]);
  });

  test("a repository port method that does not return Result is reported", () => {
    const port = "packages/command/billing-use-case/src/invoice-repository.ts";
    const result = lint(sample.files, (files) => {
      replace(files, port, "  store(invoiceId: string, invoice: Invoice): Result<void, RepositoryError>;", "  store(invoiceId: string, invoice: Invoice): void;");
      files[port] += "\nexport type PaymentRepository = {\n  findById(paymentId: string): Promise<string>;\n  remove: (paymentId: string) => void;\n  count: () => Result<number, RepositoryError>;\n  readonly name: string;\n};\n";
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "repository-result").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "typescript-use-case: repository port method InvoiceRepository.store returns void; return Result<…, RepositoryError> so the use case sees a failed load or store",
      "typescript-use-case: repository port method PaymentRepository.findById returns Promise<string>; return Result<…, RepositoryError> so the use case sees a failed load or store",
      "typescript-use-case: repository port method PaymentRepository.remove returns void; return Result<…, RepositoryError> so the use case sees a failed load or store",
    ]);
  });

  test("a repository port method returns Result whatever parentheses wrap it, and only when every member of its union is one", () => {
    const port = "packages/command/billing-use-case/src/invoice-repository.ts";
    const result = lint(sample.files, (files) => {
      replace(files, port, "  store(invoiceId: string, invoice: Invoice): Result<void, RepositoryError>;", "  store(invoiceId: string, invoice: Invoice): Result<void, RepositoryError> | undefined;");
      files[port] +=
        "\nexport type PaymentRepository = {\n  remove(paymentId: string): (Result<void, RepositoryError>);\n  count: () => Result<number, RepositoryError> | Result<0, RepositoryError>;\n  findAll(): billing.Result<readonly string[], RepositoryError>;\n  listen: () => Result<() => void, RepositoryError> | undefined;\n  clear: (() => void);\n};\n";
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "repository-result").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "typescript-use-case: repository port method InvoiceRepository.store returns Result<void, RepositoryError> | undefined; return Result<…, RepositoryError> so the use case sees a failed load or store",
      "typescript-use-case: repository port method PaymentRepository.listen returns Result<() => void, RepositoryError> | undefined; return Result<…, RepositoryError> so the use case sees a failed load or store",
      "typescript-use-case: repository port method PaymentRepository.clear returns void; return Result<…, RepositoryError> so the use case sees a failed load or store",
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
    const money = "packages/command/billing-domain/src/money.rs";
    const result = lint(sample.files, (files) =>
      replace(
        files,
        money,
        "pub fn add(&mut self, rhs: &Money) {",
        "pub fn add(self: &mut Self, rhs: &Money) {",
      ),
    );
    expect(result.findings.filter((entry) => entry.rule_id === "in-place")).toEqual([]);
  });

  test("a typed mutable receiver does not exempt another external mutable argument", () => {
    const money = "packages/command/billing-domain/src/money.rs";
    const result = lint(sample.files, (files) =>
      replace(
        files,
        money,
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

  test("a use case type not named <Verb><Object>UseCase is reported", () => {
    const useCase = "packages/command/billing-use-case/src/issue_invoice.rs";
    const result = lint(sample.files, (files) => {
      replace(files, useCase, "pub struct IssueInvoiceUseCase<'a, R: InvoiceRepository> {", "pub struct IssueInvoice<'a, R: InvoiceRepository> {");
      replace(files, useCase, "impl<'a, R: InvoiceRepository> IssueInvoiceUseCase<'a, R> {", "impl<'a, R: InvoiceRepository> IssueInvoice<'a, R> {");
      replace(files, useCase, "        IssueInvoiceUseCase { invoice_repository }", "        IssueInvoice { invoice_repository }");
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "use-case-name").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "rust-use-case: use case IssueInvoice is not named <Verb><Object>UseCase; name it IssueInvoiceUseCase",
    ]);
  });

  test("a repository port method that does not return Result is reported", () => {
    const port = "packages/command/billing-use-case/src/invoice_repository.rs";
    const result = lint(sample.files, (files) => {
      replace(files, port, "    fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;", "    fn store(&mut self, invoice_id: &str, invoice: Invoice);");
      replace(files, port, "    fn find_by_id(&self, invoice_id: &str) -> Result<Option<Invoice>, RepositoryError>;", "    fn find_by_id(&self, invoice_id: &str) -> Option<Invoice>;");
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "repository-result").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "rust-use-case: repository port method InvoiceRepository::find_by_id returns Option<Invoice>; return Result<…, RepositoryError> so the use case sees a failed load or store",
      "rust-use-case: repository port method InvoiceRepository::store returns (); return Result<…, RepositoryError> so the use case sees a failed load or store",
    ]);
  });

  test("a repository port method that stores through &self is reported unless the port is Sync", () => {
    const port = "packages/command/billing-use-case/src/invoice_repository.rs";
    const reported = lint(sample.files, (files) =>
      replace(files, port, "    fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;", "    fn store(&self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;\n    fn delete_by_id(&self, invoice_id: &str) -> Result<(), RepositoryError>;"),
    );
    expect(reported.unavailable).toEqual([]);
    expect(reported.findings.filter((entry) => entry.rule_id === "repository-mut-self").map((entry) => `${entry.check}: ${entry.message}`)).toEqual([
      "rust-use-case: repository port method InvoiceRepository::store changes what is stored but does not take &mut self; take &mut self, or declare the port Send + Sync when it is shared across threads behind a lock",
      "rust-use-case: repository port method InvoiceRepository::delete_by_id changes what is stored but does not take &mut self; take &mut self, or declare the port Send + Sync when it is shared across threads behind a lock",
    ]);
    const shared = lint(sample.files, (files) => {
      replace(files, port, "    fn store(&mut self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;", "    fn store(&self, invoice_id: &str, invoice: Invoice) -> Result<(), RepositoryError>;");
      replace(files, port, "pub trait InvoiceRepository {", "pub trait InvoiceRepository: Send + Sync {");
    });
    expect(shared.findings.filter((entry) => entry.rule_id === "repository-mut-self")).toEqual([]);
  });

  test("a repository port method returning a path-qualified Result, absolute or not, is kept", () => {
    const port = "packages/command/billing-use-case/src/invoice_repository.rs";
    const result = lint(sample.files, (files) => {
      replace(files, port, "-> Result<(), RepositoryError>;", "-> std::result::Result<(), RepositoryError>;");
      replace(files, port, "-> Result<Option<Invoice>, RepositoryError>;", "-> ::std::result::Result<Option<Invoice>, RepositoryError>;");
    });
    expect(result.unavailable).toEqual([]);
    expect(result.findings.filter((entry) => entry.rule_id === "repository-result")).toEqual([]);
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

  test("a Domain Primitive always declares its domain invariant and parser", () => {
    const model = "docs/ddd/domain-model.yaml";
    const primitive = (id: string, extra = "") =>
      `          - { element_id: primitive.${id}, kind: domain-primitive, name: X, aggregate: aggregate.invoice, attributes: [{ name: value, type: string, required: true }]${extra} }\n        invariants:\n`;
    const findings = (edit: (files: Record<string, string>) => void) =>
      lint(sample.files, edit).findings.filter((entry) => entry.rule_id === "completeness.primitive-rule").map((entry) => entry.message);
    expect(findings((files) => replace(files, model, "        invariants:\n", primitive("invoice-number")))).toEqual([
      'domain-primitive primitive.invoice-number declares no domain invariant and no factory rule that builds it and returns its errors',
    ]);
    const unconstrained = lint(sample.files, (files) =>
        replace(files, model, "name: CustomerId, aggregate: aggregate.invoice,", "name: CustomerId, aggregate: aggregate.invoice, unconstrained: any string,"),
    );
    expect(unconstrained.pass).toBe(false);
    expect(unconstrained.findings.some((entry) => entry.message.includes("unconstrained"))).toBe(true);
    expect(findings((files) => replace(files, model, "preconditions: [invariant.invoice.customer-id-format]", "preconditions: [invariant.invoice.total-not-negative]"))).toContain("domain-primitive primitive.customer-id has an invariant but no factory rule that checks all of its invariants and returns its errors");
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
      .replace("persistence_backend: none", "persistence_backend: in-memory")
      .replace("via: full-constructor", "via: stored-instance");
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
      const classSample = eventTypeScriptSample("named-file").files;
      expect(examples).toContain(classSample[parentModuleFile("named-file")]);
      expect(examples).toContain(eventTypeScriptSample("index-file").files["packages/command/billing-domain/src/index.ts"]);
      for (const path of [
        "packages/command/billing-domain/src/customer-id.ts",
        "packages/command/billing-domain/src/invoice/line.ts",
        "packages/command/billing-domain/src/invoice/lines.ts",
        "packages/command/billing-domain/src/money.ts",
        "packages/infrastructure/language-extensions/src/result.ts",
        "packages/command/billing-use-case/src/invoice-repository.ts",
        "packages/command/billing-use-case/src/issue-invoice.ts",
        "packages/command/billing-interface-adapter/src/in-memory-invoice-repository.ts",
      ])
        expect(examples).toContain(classSample[path]);
    });
    test(`${lang} ddd-rust`, () => {
      const examples = blocks(`${lang}/facets/knowledge/ddd-rust.md`);
      const files = eventRustSample("file").files;
      expect(examples).toContain(files[rustParentModuleFile("file")]);
      for (const path of ["customer_id.rs", "invoice/line.rs", "invoice/lines.rs", "money.rs"])
        expect(examples).toContain(files[`packages/command/billing-domain/src/${path}`]);
    });
    test(`${lang} ddd-modeling: the model file examples fit the TypeScript sample`, () => {
      const [model, mapping, layers] = [...readFileSync(resolve(import.meta.dir, "../../..", `${lang}/facets/knowledge/ddd-modeling.md`), "utf8").matchAll(/```yaml\n([\s\S]*?)```/g)].map(
        (match) => match[1],
      );
      const result = lint(eventTypeScriptSample("named-file").files, (files) => {
        files["docs/ddd/domain-model.yaml"] = model ?? "";
        files["docs/ddd/aggregate-mapping.yaml"] = mapping ?? "";
        files["docs/ddd/layer-structure.yaml"] = layers ?? "";
      });
      expect(result.findings).toEqual([]);
    });
  }
});
