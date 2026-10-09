/** Complete service projects share the existing Aggregate fixtures and construction rules. */
import { loadDomainModelSource } from "../../lib/schema/loader.ts";
import { eventRustSample, eventTypeScriptSample } from "./event-sourcing.ts";
import { typeScriptSample } from "./typescript.ts";

export function serviceModel(source = eventTypeScriptSample("named-file").files["docs/ddd/domain-model.yaml"]) {
  const loaded = loadDomainModelSource(source, "base.yaml");
  if (!loaded.ok) throw new Error("service fixture base model does not load");
  return {
    ...loaded.model,
    bounded_contexts: loaded.model.bounded_contexts.map((context, i) => i !== 0 ? context : {
      ...context,
      domain_services: [{
        element_id: "service.payment-eligibility", name: "PaymentEligibility", bounded_context: context.element_id,
        responsibility: "Combine invoice eligibility with the available payment funds without changing either input",
        operations: [{
          element_id: "service-operation.payment-eligibility.assess", name: "AssessPaymentEligibility",
          service: "service.payment-eligibility",
          inputs: [{ name: "invoice", type: "entity.invoice" }, { name: "funds", type: "primitive.money" }],
          result: { type: "boolean" }, statement: "Return true exactly when the invoice permits payment and the funds are not negative",
          domain_errors: [{ element_id: "error.payment-eligibility.assess.ineligible", name: "Ineligible", operation: "service-operation.payment-eligibility.assess", condition: "The inputs do not permit payment" }],
          failure_order: ["error.payment-eligibility.assess.ineligible"],
        }],
      }],
    }),
  };
}

export function serviceProject(companion = false) {
  const files = { ...(companion ? typeScriptSample("companion", "named-file") : eventTypeScriptSample("named-file")).files };
  files["docs/ddd/domain-model.yaml"] = Bun.YAML.stringify(serviceModel(files["docs/ddd/domain-model.yaml"]));
  const mapping = Bun.YAML.parse(files["docs/ddd/aggregate-mapping.yaml"]) as import("../../lib/aggregate-mapping/contract.ts").ImplementationMapping;
  files["docs/ddd/aggregate-mapping.yaml"] = Bun.YAML.stringify({
    ...mapping,
    service_mappings: [{ service_ref: "service.payment-eligibility", code: { language: "typescript", package: "@acme/billing-domain", module: ["payment-eligibility"], type: "PaymentEligibility" }, operations: [{ operation_ref: "service-operation.payment-eligibility.assess", code: { method: "assess", error_type: "AssessPaymentEligibilityError", success_type: "boolean" }, inputs: [{ input: "invoice", parameter: "invoice" }, { input: "funds", parameter: "funds" }], errors: [{ error_ref: "error.payment-eligibility.assess.ineligible", code: { case: "ineligible" } }] }] }],
    domain_packages: [...mapping.domain_packages, { term: "Payment eligibility", rationale: "Combine the invoice amount and available funds without owning either", model_refs: ["service.payment-eligibility"], code: { language: "typescript", package: "@acme/billing-domain", module: ["payment-eligibility"] } }],
  });
  files["packages/command/billing-domain/src/invoice.ts"] = files["packages/command/billing-domain/src/invoice.ts"].replace("export class Invoice {", "export class Invoice {\n  allowsPayment(this: Invoice): boolean { return !this.#issued; }\n");
  files["packages/command/billing-domain/src/payment-eligibility.ts"] = `import type { Result } from '@acme/language-extensions';
import type { Invoice } from './invoice.ts';
import type { Money } from './money.ts';
export type AssessPaymentEligibilityError = 'ineligible';
export class PaymentEligibility {
  private constructor() {}
  static create(): PaymentEligibility { return new PaymentEligibility(); }
  assess(this: PaymentEligibility, invoice: Invoice, funds: Money): Result<boolean, AssessPaymentEligibilityError> {
    if (funds.isNegative() || !invoice.allowsPayment()) return { ok: false, error: 'ineligible' };
    return { ok: true, value: true };
  }
}
`;
  if (companion) {
    const invoice = "packages/command/billing-domain/src/invoice.ts";
    files[invoice] = files[invoice].replace("  total(): Money;", "  allowsPayment(): boolean;\n  total(): Money;").replace("      isBilledTo(", "      allowsPayment(): boolean { return !state.issued; },\n      isBilledTo(");
    files["packages/command/billing-domain/src/payment-eligibility.ts"] = `import type { Result } from '@acme/language-extensions';
import type { Invoice } from './invoice.ts';
import type { Money } from './money.ts';
export type AssessPaymentEligibilityError = 'ineligible';
const brand: unique symbol = Symbol('PaymentEligibility');
export type PaymentEligibility = {
  readonly [brand]: true;
  assess(invoice: Invoice, funds: Money): Result<boolean, AssessPaymentEligibilityError>;
};
export const PaymentEligibility = {
  create(): PaymentEligibility {
    const instance: PaymentEligibility = {
      [brand]: true,
      assess(invoice: Invoice, funds: Money): Result<boolean, AssessPaymentEligibilityError> {
        if (funds.isNegative() || !invoice.allowsPayment()) return { ok: false, error: 'ineligible' };
        return { ok: true, value: true };
      },
    };
    return instance;
  },
};
`;
  }
  files["packages/command/billing-domain/src/index.ts"] += "\nexport { PaymentEligibility } from './payment-eligibility.ts';\nexport type { AssessPaymentEligibilityError } from './payment-eligibility.ts';\n";
  return files;
}

export function rustServiceProject() {
  const files = { ...eventRustSample("file").files };
  files["docs/ddd/domain-model.yaml"] = Bun.YAML.stringify(serviceModel(files["docs/ddd/domain-model.yaml"]));
  const mapping = Bun.YAML.parse(files["docs/ddd/aggregate-mapping.yaml"]) as import("../../lib/aggregate-mapping/contract.ts").ImplementationMapping;
  files["docs/ddd/aggregate-mapping.yaml"] = Bun.YAML.stringify({ ...mapping,
    service_mappings: [{ service_ref: "service.payment-eligibility", code: { language: "rust", package: "billing-domain", module: ["payment_eligibility"], type: "PaymentEligibility" }, operations: [{ operation_ref: "service-operation.payment-eligibility.assess", code: { method: "assess", success_type: "bool", error_type: "AssessPaymentEligibilityError" }, inputs: [{ input: "invoice", parameter: "invoice" }, { input: "funds", parameter: "funds" }], errors: [{ error_ref: "error.payment-eligibility.assess.ineligible", code: { case: "Ineligible" } }] }] }],
    domain_packages: [...mapping.domain_packages, { term: "Payment eligibility", rationale: "Combine invoice eligibility and available funds without owning either", model_refs: ["service.payment-eligibility"], code: { language: "rust", package: "billing-domain", module: ["payment_eligibility"] } }],
  });
  files["packages/command/billing-domain/src/lib.rs"] += "\npub mod payment_eligibility;\n";
  files["packages/command/billing-domain/src/invoice.rs"] = files["packages/command/billing-domain/src/invoice.rs"].replace("impl Invoice {", "impl Invoice {\n    pub fn allows_payment(&self) -> bool { !self.issued }\n");
  files["packages/command/billing-domain/src/payment_eligibility.rs"] = `use crate::invoice::Invoice;
use crate::money::Money;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssessPaymentEligibilityError { Ineligible }
pub struct PaymentEligibility;
impl PaymentEligibility {
    pub fn create() -> Self { Self }
    pub fn assess(&self, invoice: &Invoice, funds: &Money) -> Result<bool, AssessPaymentEligibilityError> {
        if !invoice.allows_payment() || funds.is_negative() { return Err(AssessPaymentEligibilityError::Ineligible); }
        Ok(true)
    }
}
`;
  return files;
}
