import { describe, expect, test } from "bun:test";
import { loadDomainModelSource } from "../lib/schema/loader.ts";
import { serviceModel, serviceProject, rustServiceProject } from "./samples/services.ts";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

function inspect(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ddd-service-"));
  try {
    for (const [file, source] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); }
    const result = Bun.spawnSync(["bun", join(import.meta.dir, "../ddd-lint.ts"), "--project", root, "--json"]);
    return JSON.parse(result.stdout.toString()) as { pass: boolean; results: { findings: { rule_id: string; message: string }[] }[] };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("independent domain service declarations", () => {
  test("accepts an operation owned by its context's service without an aggregate event", () => {
    const result = loadDomainModelSource(Bun.YAML.stringify(serviceModel()), "service.yaml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.index.resolve("service.payment-eligibility", "service").ok).toBe(true);
      expect(result.index.byId("service-operation.payment-eligibility.assess")?.owner).toBe("service.payment-eligibility");
    }
  });
  for (const [name, edit] of [
    ["a foreign context", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].bounded_context = "bc.other"; }],
    ["a foreign service owner", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].service = "service.other"; }],
    ["an undefined input", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].inputs[0].type = "entity.missing"; }],
    ["a bare input", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].inputs[0].type = "boolean"; }],
    ["duplicate input names", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].inputs[1].name = "invoice"; }],
    ["an entity result", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].result.type = "entity.invoice"; }],
    ["a missing failure priority", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].failure_order = []; }],
    ["duplicate failure priority", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].failure_order.push(s![0].operations[0].failure_order[0]); }],
    ["another operation's error", (s: ReturnType<typeof serviceModel>["bounded_contexts"][number]["domain_services"]) => { s![0].operations[0].domain_errors[0].operation = "factory.invoice.open"; }],
  ] as const) test(`rejects ${name}`, () => {
    const model = serviceModel();
    edit(model.bounded_contexts[0].domain_services);
    expect(loadDomainModelSource(Bun.YAML.stringify(model), "service.yaml").ok).toBe(false);
  });
});

describe("independent service code contracts", () => {
  for (const [name, edit] of [
    ["missing service mapping", (m: import("../lib/aggregate-mapping/contract.ts").ImplementationMapping) => ({ ...m, service_mappings: [] })],
    ["missing operation mapping", (m: import("../lib/aggregate-mapping/contract.ts").ImplementationMapping) => ({ ...m, service_mappings: m.service_mappings!.map(s => ({ ...s, operations: [] })) })],
    ["foreign operation", (m: import("../lib/aggregate-mapping/contract.ts").ImplementationMapping) => ({ ...m, service_mappings: m.service_mappings!.map(s => ({ ...s, operations: s.operations.map(o => ({ ...o, operation_ref: "command.invoice.issue" })) })) })],
    ["swapped input bindings", (m: import("../lib/aggregate-mapping/contract.ts").ImplementationMapping) => ({ ...m, service_mappings: m.service_mappings!.map(s => ({ ...s, operations: s.operations.map(o => ({ ...o, inputs: [...o.inputs].reverse() })) })) })],
    ["duplicate service mapping", (m: import("../lib/aggregate-mapping/contract.ts").ImplementationMapping) => ({ ...m, service_mappings: [...m.service_mappings!, ...m.service_mappings!] })],
    ["shared aggregate type", (m: import("../lib/aggregate-mapping/contract.ts").ImplementationMapping) => ({ ...m, service_mappings: m.service_mappings!.map(s => ({ ...s, code: { ...s.code, ...m.aggregate_mappings[0].code } })) })],
  ] as const) test(`rejects mapping with ${name}`, () => {
    const files = serviceProject();
    const mapping = Bun.YAML.parse(files["docs/ddd/aggregate-mapping.yaml"]) as import("../lib/aggregate-mapping/contract.ts").ImplementationMapping;
    files["docs/ddd/aggregate-mapping.yaml"] = Bun.YAML.stringify(edit(mapping));
    expect(inspect(files).results.flatMap(x => x.findings).some(x => x.rule_id.startsWith("aggregate-mapping."))).toBe(true);
  });
  test("rejects a constructor of a helper inside an otherwise read-only operation", () => {
    const files = serviceProject();
    const path = "packages/command/billing-domain/src/payment-eligibility.ts";
    files[path] = files[path].replace("    return { ok: true", "    new Date();\n    return { ok: true");
    expect(inspect(files).results.flatMap(x => x.findings).some(x => x.rule_id === "service-contract")).toBe(true);
  });
  test("rejects a primitive-error alias reused by a service operation", () => {
    const files = serviceProject();
    const model = serviceModel();
    const operation = model.bounded_contexts[0].domain_services![0].operations[0];
    operation.domain_errors[0].name = "InvalidIncrement";
    files["docs/ddd/domain-model.yaml"] = Bun.YAML.stringify(model);
    const path = "packages/command/billing-domain/src/payment-eligibility.ts";
    files[path] = files[path].replace("export type AssessPaymentEligibilityError = 'ineligible';", "import type { ParseMoneyError as AssessPaymentEligibilityError } from './money.ts';").replace("error: 'ineligible'", "error: 'invalid-increment'");
    const mapping = Bun.YAML.parse(files["docs/ddd/aggregate-mapping.yaml"]) as import("../lib/aggregate-mapping/contract.ts").ImplementationMapping;
    files["docs/ddd/aggregate-mapping.yaml"] = Bun.YAML.stringify({ ...mapping, service_mappings: mapping.service_mappings!.map(s => ({ ...s, operations: s.operations.map(o => ({ ...o, errors: o.errors.map(e => ({ ...e, code: { case: "invalid-increment" } })) })) })) });
    expect(inspect(files).results.flatMap(x => x.findings).some(x => x.rule_id === "service-contract" && x.message.includes("shares"))).toBe(true);
  });
  test("accepts TypeScript fixed configuration instead of rejecting every field", () => {
    const files = serviceProject();
    const path = "packages/command/billing-domain/src/payment-eligibility.ts";
    files[path] = files[path].replace("private constructor() {}", "readonly #enabled: boolean; private constructor(enabled: boolean) { this.#enabled = enabled; }").replace("static create()", "static create(enabled: boolean)").replace("new PaymentEligibility()", "new PaymentEligibility(enabled)").replace("if (funds.isNegative()", "if (!this.#enabled || funds.isNegative()");
    expect(inspect(files).pass).toBe(true);
  });
  test("accepts Rust fixed configuration through the existing private constructor", () => {
    const files = rustServiceProject();
    const path = "packages/command/billing-domain/src/payment_eligibility.rs";
    files[path] = files[path].replace("pub struct PaymentEligibility;", "pub struct PaymentEligibility { enabled: bool }").replace("pub fn create() -> Self { Self }", "fn new(enabled: bool) -> Self { Self { enabled } }\n    pub fn create(enabled: bool) -> Self { Self::new(enabled) }").replace("if (!invoice", "if (!invoice").replace("if !invoice", "if !self.enabled || !invoice");
    expect(inspect(files).pass).toBe(true);
  });
  test("accepts the service in the project's companion representation", () => {
    const result = inspect(serviceProject(true));
    expect(result.results.flatMap(x => x.findings)).toEqual([]);
    expect(result.pass).toBe(true);
  });
  test("accepts the Rust service without a command event or mutable receiver", () => {
    const result = inspect(rustServiceProject());
    expect(result.results.flatMap(x => x.findings)).toEqual([]);
    expect(result.pass).toBe(true);
  });
  test("accepts the mapped service alongside the existing aggregate", () => {
    const result = inspect(serviceProject());
    expect(result.results.flatMap(x => x.findings)).toEqual([]);
    expect(result.pass).toBe(true);
  });
  test("rejects an input whose code type does not implement the declared element", () => {
    const files = serviceProject();
    const path = "packages/command/billing-domain/src/payment-eligibility.ts";
    files[path] = files[path].replace("invoice: Invoice", "invoice: Money").replace("!invoice.allowsPayment()", "invoice.isNegative()");
    const result = inspect(files);
    expect(result.results.flatMap(x => x.findings).some(x => x.rule_id === "service-contract")).toBe(true);
  });
  for (const [name, edit] of [
    ["missing method", (s: string) => s.replace("  assess(this:", "  renamed(this:")],
    ["wrong result type", (s: string) => s.replace("Result<boolean,", "Result<Money,")],
    ["extra error case", (s: string) => s.replace("= 'ineligible';", "= 'ineligible' | 'other';")],
    ["widened error", (s: string) => s.replace("= 'ineligible';", "= string;")],
    ["unexported error", (s: string) => s.replace("export type Assess", "type Assess")],
    ["captured entity", (s: string) => s.replace("private constructor() {}", "readonly #previous: Invoice; private constructor(invoice: Invoice) { this.#previous = invoice; }").replace("static create()", "static create(invoice: Invoice)").replace("new PaymentEligibility()", "new PaymentEligibility(invoice)")],
    ["global history", (s: string) => "let previous: boolean = false;\n" + s.replace("    return { ok: true", "    previous = true;\n    return { ok: true")],
    ["aggregate command", (s: string) => s.replace("    return { ok: true", "    invoice.issue();\n    return { ok: true")],
    ["throwing refusal", (s: string) => s.replace("return { ok: false, error: 'ineligible' };", "throw new Error('ineligible');")],
  ] as const) test(`rejects TypeScript ${name}`, () => {
    const files = serviceProject();
    const path = "packages/command/billing-domain/src/payment-eligibility.ts";
    files[path] = edit(files[path]);
    expect(inspect(files).results.flatMap(x => x.findings).some(x => x.rule_id === "service-contract")).toBe(true);
  });
  for (const [name, edit] of [
    ["missing method", (s: string) => s.replace("pub fn assess", "pub fn renamed")],
    ["mutable receiver", (s: string) => s.replace("assess(&self", "assess(&mut self")],
    ["mutable input", (s: string) => s.replace("invoice: &Invoice", "invoice: &mut Invoice")],
    ["mutable input with whitespace", (s: string) => s.replace("invoice: &Invoice", "invoice: & mut Invoice")],
    ["wrong input", (s: string) => s.replace("invoice: &Invoice", "invoice: &Money").replace("!invoice.allows_payment()", "invoice.is_negative()")],
    ["wrong result", (s: string) => s.replace("Result<bool,", "Result<Money,")],
    ["extra error", (s: string) => s.replace("{ Ineligible }", "{ Ineligible, Other }")],
    ["error payload", (s: string) => s.replace("{ Ineligible }", "{ Ineligible(String) }")],
    ["captured entity", (s: string) => s.replace("pub struct PaymentEligibility;", "pub struct PaymentEligibility { previous: Invoice }")],
    ["unsafe global history", (s: string) => "static mut PREVIOUS: bool = false;\n" + s.replace("        Ok(true)", "        unsafe { PREVIOUS = true; }\n        Ok(true)")],
    ["panic refusal", (s: string) => s.replace("return Err(AssessPaymentEligibilityError::Ineligible);", "panic!(\"ineligible\");")],
  ] as const) test(`rejects Rust ${name}`, () => {
    const files = rustServiceProject();
    const path = "packages/command/billing-domain/src/payment_eligibility.rs";
    files[path] = edit(files[path]);
    expect(inspect(files).results.flatMap(x => x.findings).some(x => x.rule_id === "service-contract")).toBe(true);
  });
});

describe("service examples at public runtime interfaces", () => {
  for (const companion of [false, true]) test(`TypeScript ${companion ? "companion" : "class"} sample builds and keeps inputs and invocation history independent`, () => {
    const files = serviceProject(companion);
    const root = mkdtempSync(join(tmpdir(), "ddd-service-runtime-"));
    try {
      for (const [file, source] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); }
      const scope = join(root, "node_modules/@acme");
      mkdirSync(scope, { recursive: true });
      for (const name of ["billing-domain", "billing-use-case", "billing-interface-adapter"]) symlinkSync(join(root, "packages/command", name), join(scope, name), "dir");
      symlinkSync(join(root, "packages/infrastructure/language-extensions"), join(scope, "language-extensions"), "dir");
      const build = Bun.spawnSync([resolve(import.meta.dir, "../node_modules/.bin/tsc"), "-b", "--pretty", "false"], { cwd: root });
      expect(build.stdout.toString()).toBe("");
      expect(build.exitCode).toBe(0);
      const path = join(root, "service-runtime.test.ts");
      writeFileSync(path, `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Invoice, Money, CustomerId, InvoiceLine, InvoiceLines, PaymentEligibility } from '@acme/billing-domain';
test('service preserves inputs and is independent of other invocations', () => {
  const opened = Invoice.open('I1', CustomerId.of('C123456'), InvoiceLines.of([InvoiceLine.of(Money.of(100))]));
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error('fixture cannot open');
  const invoice = opened.value;
  const issued = invoice.issue();
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error('fixture cannot issue');
  const other = issued.value.invoice;
  const service = PaymentEligibility.create();
  const funds = Money.of(100);
  assert.deepEqual(service.assess(invoice, funds), { ok: true, value: true });
  assert.deepEqual(service.assess(other, funds), { ok: false, error: 'ineligible' });
  assert.deepEqual(service.assess(invoice, funds), { ok: true, value: true });
  assert.deepEqual(PaymentEligibility.create().assess(invoice, funds), { ok: true, value: true });
  assert.deepEqual(service.assess(invoice, Money.of(-100)), { ok: false, error: 'ineligible' });
  assert.equal(invoice.allowsPayment(), true);
  assert.equal(other.allowsPayment(), false);
  assert.equal(funds.isNegative(), false);
});
`);
      const run = Bun.spawnSync(["node", "--test", path], { cwd: root });
      expect(run.exitCode).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  test("Rust sample builds and tests the public service without changing inputs", () => {
    const files = rustServiceProject();
    const root = mkdtempSync(join(tmpdir(), "ddd-service-rust-runtime-"));
    try {
      files["packages/command/billing-domain/tests/service_runtime.rs"] = `use billing_domain::invoice::Invoice;
use billing_domain::invoice::line::InvoiceLine;
use billing_domain::invoice::lines::InvoiceLines;
use billing_domain::customer_id::CustomerId;
use billing_domain::money::Money;
use billing_domain::payment_eligibility::{PaymentEligibility, AssessPaymentEligibilityError};
#[test]
fn invocation_history_and_inputs_are_independent() {
    let invoice = Invoice::open("I1", CustomerId::of("C123456"), InvoiceLines::of(vec![InvoiceLine::of(Money::of(100))])).unwrap();
    let service = PaymentEligibility::create();
    let funds = Money::of(100);
    assert_eq!(service.assess(&invoice, &funds), Ok(true));
    assert_eq!(service.assess(&invoice, &Money::of(-100)), Err(AssessPaymentEligibilityError::Ineligible));
    assert_eq!(service.assess(&invoice, &funds), Ok(true));
    assert_eq!(PaymentEligibility::create().assess(&invoice, &funds), Ok(true));
    assert!(invoice.allows_payment());
    assert!(!funds.is_negative());
    assert_eq!(invoice.sequence_number(), 1);
}
`;
      for (const [file, source] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); }
      const run = Bun.spawnSync(["cargo", "test", "--quiet", "--workspace"], { cwd: root });
      expect(run.exitCode).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  for (const lang of ["ja", "en"]) test(`${lang} existing knowledge reproduces the validated service samples`, () => {
    const base = resolve(import.meta.dir, "../../..", lang, "facets/knowledge");
    const ts = readFileSync(join(base, "ddd-typescript.md"), "utf8");
    const rust = readFileSync(join(base, "ddd-rust.md"), "utf8");
    expect(ts).toContain(serviceProject()["packages/command/billing-domain/src/payment-eligibility.ts"]);
    expect(rust).toContain(rustServiceProject()["packages/command/billing-domain/src/payment_eligibility.rs"]);
    const blocks = [...readFileSync(join(base, "ddd-modeling.md"), "utf8").matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map(x => Bun.YAML.parse(x[1]) as Record<string, unknown>);
    expect(blocks[3].domain_services).toEqual(serviceModel().bounded_contexts[0].domain_services);
    const mapping = Bun.YAML.parse(serviceProject()["docs/ddd/aggregate-mapping.yaml"]) as import("../lib/aggregate-mapping/contract.ts").ImplementationMapping;
    expect(blocks[4].service_mappings).toEqual(mapping.service_mappings);
  });
});
