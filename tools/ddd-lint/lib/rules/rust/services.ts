import type { FindingInput } from "../../shared/findings.ts";
import { sameCases, scalarResult, serviceOperation } from "../service-contract.ts";
import { operationOwner } from "../operation-owner.ts";
import type { InspectionContext, InspectionTarget } from "../types.ts";
import { within, type RustType, type LocatedMethod } from "./program.ts";

export function ruleServices(target: InspectionTarget, context: InspectionContext): FindingInput[] {
  if (context.rustMapping.kind !== "loaded" || !target.file) return [];
  const { services, aggregates, packages } = context.rustMapping.view;
  const findings: FindingInput[] = [];
  const index = context.model.index;
  const sameCrate = (a: string, b: string) => a.replace(/-/g, "_") === b.replace(/-/g, "_");
  const sharedReference = (text: string): boolean => {
    const match = /^&\s*(?:'\w+\s+)?(.+)$/.exec(text.trim());
    return !!match && !/^mut\b/.test(match[1]);
  };
  const errorOwners = new Map<string, Set<string>>();
  for (const mapping of [...aggregates, ...services]) for (const operation of mapping.operations) {
    const name = operationOwner(context.model, operation.operation_ref, mapping.type);
    for (const owner of context.program.types.filter(x => sameCrate(x.crate, mapping.crate) && x.name === name && (name !== mapping.type || x.module.join("::") === mapping.module.join("::")))) {
      const error = context.program.resolveType(owner.file, owner.module, operation.error_type);
      if (!error) continue;
      const owners = errorOwners.get(error.key) ?? new Set<string>();
      owners.add(operation.operation_ref);
      errorOwners.set(error.key, owners);
    }
  }
  const matches = (location: LocatedMethod, text: string, ref: string): boolean => {
    if (/[<>\[\]()]/.test(text)) return false;
    const element = index?.byId(ref);
    const type = context.program.resolveType(location.file, location.module, text);
    if (!element || !type) return false;
    const owner = aggregates.find(x => x.aggregate_ref === element.owner);
    const root = (index?.byId(element.owner ?? "")?.node as { root_element?: string } | undefined)?.root_element;
    if (root === ref) return !!owner && owner.type === type.name && sameCrate(owner.crate, type.crate) && owner.module.join("::") === type.module.join("::");
    return type.name === element.name && packages.some(x => sameCrate(x.crate, type.crate) && x.module.join("::") === type.module.join("::") && x.model_refs.includes(ref));
  };
  for (const mapping of services) {
    const types = context.program.types.filter(x => x.layer === "domain" && !x.auxiliary && x.name === mapping.type && sameCrate(x.crate, mapping.crate) && x.module.join("::") === mapping.module.join("::"));
    // An absent service is reported once, rather than disappearing because it has no source target.
    const file = types[0]?.file ?? context.targets.find(x => x.file)?.file;
    if (file !== target.file) continue;
    const report = (message: string, line?: number) => findings.push({ rule_id: "service-contract", file: target.file!, message: `${mapping.type}: ${message}`, ...(line ? { line } : {}) });
    if (types.length !== 1 || types[0].kind !== "struct") { report("mapped service must resolve to one domain struct"); continue; }
    const type = types[0];
    if (type.field_count !== type.fields.length) report("tuple state cannot be established as fixed configuration");
    for (const field of type.fields) {
      const held = context.program.resolveType(type.file, type.module, field.type_text);
      const entity = held && (index?.elements("entity").some(x => x.name === held.name) || aggregates.some(x => x.type === held.name && sameCrate(x.crate, held.crate) && x.module.join("::") === held.module.join("::")));
      let scalar = field.type_text.trim();
      const aliases = context.program.facts.files.get(type.file)?.aliases ?? [];
      const seen = new Set<string>();
      while (!seen.has(scalar)) {
        seen.add(scalar);
        const alias = aliases.find(x => !x.local && !x.generic && x.name === scalar);
        if (!alias) break;
        scalar = alias.type_text;
      }
      const fixedScalar = !held && /^(?:bool|String|[iu](?:8|16|32|64|128)|f(?:32|64))$/.test(scalar);
      const fixedValue = held && (index?.elements().some(x => ["vo", "primitive"].includes(x.kind) && x.name === held.name) || services.some(x => x.type === held.name && sameCrate(x.crate, held.crate) && x.module.join("::") === held.module.join("::")) || (held.kind === "enum" && held.variants.every(x => x.unit)));
      if (entity || (!fixedScalar && !fixedValue) || /(?:Cell|RefCell|Mutex|RwLock|Atomic\w*|Vec|HashMap|HashSet)\s*(?:<|$)/.test(scalar)) report(`field ${field.name} cannot be established as fixed configuration`, field.line);
    }
    for (const method of type.methods) if (!method.trait && method.method.receiver === "mut-self") report(`method ${method.method.name} mutates the service`, method.method.line);
    for (const operation of mapping.operations) {
      const model = serviceOperation(index, operation);
      if (!model) { report(`cannot resolve ${operation.operation_ref}`); continue; }
      const methods = type.methods.filter(x => !x.trait && x.method.name === operation.method);
      if (methods.length !== 1) { report(`operation ${operation.method} must name one inherent method`); continue; }
      const location = methods[0];
      const method = location.method;
      const expected = `Result<${operation.success_type},${operation.error_type}>`;
      if (method.receiver !== "ref-self" || method.visibility !== "pub" || method.return_type_text?.replace(/\s+/g, "") !== expected) report(`${operation.method} must take &self and return ${expected}`, method.line);
      if (method.params.length !== model.inputs.length || method.params.some((param, i) => param.name !== operation.inputs?.[i]?.parameter || !sharedReference(param.type_text) || !matches(location, param.type_text, model.inputs[i]?.type ?? ""))) report(`${operation.method} inputs must be shared references to the declared model types`, method.line);
      const scalar = scalarResult(model.result.type, "rust", operation.success_type ?? "");
      if (scalar === false || (scalar === undefined && !matches(location, operation.success_type ?? "", model.result.type))) report(`${operation.method} success type does not implement ${model.result.type}`, method.line);
      const error = context.program.resolveType(location.file, location.module, operation.error_type);
      if (!error || error.kind !== "enum" || error.visibility !== "pub" || error.variants.some(x => !x.unit) || !sameCases(error.variants.map(x => x.name), operation.errors?.map(x => x.code.case) ?? [])) report(`${operation.method} error type must be a public enum with exactly its mapped unit variants`, method.line);
      if (error && (errorOwners.get(error.key)?.size ?? 0) > 1) report(`${operation.method} shares its resolved error type with another operation`, method.line);
      const seen = new Set<string>();
      const inspectMethod = (owner: RustType, called: LocatedMethod) => {
        const key = `${called.file}:${called.method.span.start_line}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (called.method.receiver !== "ref-self" || called.method.unverified_effects) report(`${owner.name}::${called.method.name} is outside the inspectable read-only form`, called.method.line);
        const facts = context.program.facts.files.get(called.file)!;
        for (const call of facts.calls.filter(x => within(x.span, called.method.span))) {
          if (call.kind === "path-call" && /^(?:Ok|Err)$/.test(call.callee_text)
            && !facts.functions.some(x => x.name === call.callee_text)
            && !facts.uses.some(x => /\b(?:Ok|Err)\b/.test(x.path_text))) continue;
          if (call.kind !== "method-call") { report(`cannot establish a read-only call to ${call.callee_text}`, call.span.start_line); continue; }
          const receiver = context.program.receiver(called.file, call);
          const method = receiver?.methods.filter(x => !x.trait && x.method.name === call.callee_text);
          if (!receiver || method?.length !== 1) { report(`cannot establish a read-only receiver of ${call.callee_text}`, call.span.start_line); continue; }
          if (aggregates.some(x => x.type === receiver.name && sameCrate(x.crate, receiver.crate) && x.module.join("::") === receiver.module.join("::") && x.operations.some(op => op.method === call.callee_text && op.operation_ref.startsWith("command.")))) report(`service invokes aggregate command ${receiver.name}::${call.callee_text}`, call.span.start_line);
          inspectMethod(receiver, method[0]);
        }
      };
      inspectMethod(type, location);
    }
  }
  return findings;
}
