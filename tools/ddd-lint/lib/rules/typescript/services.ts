import type { FindingInput } from "../../shared/findings.ts";
import { sameCases, scalarResult, serviceOperation } from "../service-contract.ts";
import { operationOwner } from "../operation-owner.ts";
import { join } from "node:path";
import { packageContaining } from "./edges.ts";
import { readLayoutSelection } from "../../module-layout/settings.ts";
import { factsOf, receiverType } from "./file-facts.ts";
import { resolveDeclaredType, resolveTypeName, within } from "./symbols.ts";
import type { TsDeclared, TsDomainType, TsMethod, TsInspection } from "./types.ts";

export function ruleServices(inspection: TsInspection): FindingInput[] {
  if (inspection.mapping.kind !== "loaded") return [];
  const { services, packages, aggregates } = inspection.mapping.view;
  const selection = services.length ? readLayoutSelection(join(inspection.run.root, ".ddd.toml")) : undefined;
  const findings: FindingInput[] = [];
  const index = inspection.model.index;
  const matches = (file: string, typeText: string, ref: string): boolean => {
    const element = index?.byId(ref);
    const found = resolveTypeName(inspection.packages, inspection.symbols, file, factsOf(inspection, file), typeText);
    if (!element || found.kind !== "domain") return false;
    const owner = aggregates.find(x => x.aggregate_ref === element.owner);
    const root = (index?.byId(element.owner ?? "")?.node as { root_element?: string } | undefined)?.root_element;
    if (root === ref) return !!owner && owner.type === found.type.name && owner.package === found.type.pkg.name && owner.module.join("/") === found.type.module.join("/");
    return found.type.name === element.name && packages.some(x => x.package === found.type.pkg.name && x.module.join("/") === found.type.module.join("/") && x.model_refs.includes(ref));
  };
  const declarations: TsDeclared[] = [...inspection.facts.files].flatMap(([file, facts]) => {
    const pkg = packageContaining(inspection.packages, join(inspection.run.root, file));
    return pkg ? facts.declarations.map(declaration => ({ file, pkg, declaration })) : [];
  });
  const errorOwners = new Map<string, Set<string>>();
  for (const mapping of [...aggregates, ...services]) for (const operation of mapping.operations) {
    const name = operationOwner(inspection.model, operation.operation_ref, mapping.type);
    for (const owner of inspection.symbols.types.filter(x => x.pkg.name === mapping.package && x.name === name && (name !== mapping.type || x.module.join("/") === mapping.module.join("/")))) {
      const error = resolveDeclaredType(inspection.packages, declarations, owner.file, factsOf(inspection, owner.file), operation.error_type);
      if (error.kind !== "found") continue;
      const key = `${error.entry.file}#${error.entry.declaration.name}`;
      const owners = errorOwners.get(key) ?? new Set<string>();
      owners.add(operation.operation_ref);
      errorOwners.set(key, owners);
    }
  }
  for (const mapping of services) {
    const types = inspection.symbols.types.filter(x => x.name === mapping.type && x.pkg.name === mapping.package && x.module.join("/") === mapping.module.join("/"));
    const file = types[0]?.file ?? "docs/ddd/aggregate-mapping.yaml";
    const report = (message: string, line?: number, at = file) => findings.push({ rule_id: "service-contract", file: at, message: `${mapping.type}: ${message}`, ...(line ? { line } : {}) });
    if (types.length !== 1) { report("mapped service must resolve to one domain type"); continue; }
    const type = types[0];
    if (selection && !("message" in selection) && type.kind !== selection.typescript?.codeRepresentation) report("service representation differs from the project selection");
    const facts = factsOf(inspection, file);
    const businessState = (text: string): boolean => {
      const found = resolveTypeName(inspection.packages, inspection.symbols, file, facts, text);
      return found.kind === "domain" && !!index?.elements("entity").some(x => x.name === found.type.name);
    };
    const fixedConfiguration = (text: string): boolean => {
      const seen = new Set<string>();
      let current = text;
      while (!seen.has(current)) {
        seen.add(current);
        if (["string", "number", "boolean"].includes(current)) return true;
        const found = resolveTypeName(inspection.packages, inspection.symbols, file, facts, current);
        if (found.kind === "domain") return services.some(x => x.type === found.type.name && x.package === found.type.pkg.name && x.module.join("/") === found.type.module.join("/")) || !!index?.elements().some(x => ["vo", "primitive"].includes(x.kind) && x.name === found.type.name);
        const alias = resolveDeclaredType(inspection.packages, declarations, file, facts, current);
        if (alias.kind !== "found" || alias.entry.declaration.generic || !alias.entry.declaration.type_text) return false;
        current = alias.entry.declaration.type_text;
      }
      return false;
    };
    for (const member of type.members.filter(x => x.kind === "property" && !x.computed_key)) {
      if (!member.readonly || !member.type_text || !fixedConfiguration(member.type_text)) report(`field ${member.name} cannot be established as fixed configuration`, member.span.start_line);
    }
    // A companion has no property fields: its factory can capture constructor arguments instead.
    if (type.kind === "companion") {
      const object = facts.declarations.find(x => x.kind === "variable" && x.name === type.name);
      for (const parameter of object?.members.flatMap(x => x.params ?? []) ?? [])
        if (parameter.type_text && businessState(parameter.type_text)) report(`companion initialization captures ${parameter.name} as business state`);
    }
    for (const method of type.methods) if (method.writes.length) report(`method ${method.name} writes service or captured state`, method.span.start_line);
    for (const operation of mapping.operations) {
      const model = serviceOperation(index, operation);
      if (!model) { report(`cannot resolve ${operation.operation_ref}`); continue; }
      const methods = type.methods.filter(x => x.name === operation.method);
      if (methods.length !== 1) { report(`operation ${operation.method} must name one instance method`); continue; }
      const method = methods[0];
      const member = type.members.find(x => x.kind === "method" && x.name === operation.method && !x.static);
      const expected = `Result<${operation.success_type},${operation.error_type}>`;
      if (!member || member.visibility !== "public" || member.return_type_text?.replace(/\s+/g, "") !== expected)
        report(`${operation.method} must be public and return ${expected}`, method.span.start_line);
      const params = method.params.filter(x => x.name !== "this");
      if (params.length !== model.inputs.length || params.some((param, i) => param.name !== operation.inputs?.[i]?.parameter || !param.type_text || !matches(file, param.type_text, model.inputs[i]?.type ?? "")))
        report(`${operation.method} inputs do not implement the declared model types and bindings`, method.span.start_line);
      const scalar = scalarResult(model.result.type, "typescript", operation.success_type ?? "");
      if (scalar === false || (scalar === undefined && !matches(file, operation.success_type ?? "", model.result.type)))
        report(`${operation.method} success type does not implement ${model.result.type}`, method.span.start_line);
      const error = resolveDeclaredType(inspection.packages, declarations, file, facts, operation.error_type);
      const expectedCases = operation.errors?.map(x => x.code.case) ?? [];
      if (error.kind !== "found" || !error.entry.declaration.exported || !error.entry.declaration.string_union || !sameCases(error.entry.declaration.string_union, expectedCases))
        report(`${operation.method} error type must export exactly its mapped string cases`, method.span.start_line);
      if (error.kind === "found" && (errorOwners.get(`${error.entry.file}#${error.entry.declaration.name}`)?.size ?? 0) > 1)
        report(`${operation.method} shares its resolved error type with another operation`, method.span.start_line);
      const seen = new Set<string>();
      const inspectMethod = (owner: TsDomainType, called: TsMethod) => {
        const key = `${called.file}:${called.span.start_line}`;
        if (seen.has(key)) return;
        seen.add(key);
        const source = factsOf(inspection, called.file);
        if (called.writes.length) report(`call to ${owner.name}.${called.name} writes state`, called.span.start_line, called.file);
        if (called.has_throw) report(`${owner.name}.${called.name} contains a throw outside the inspectable Result contract`, called.span.start_line, called.file);
        if (source.constructions.some(x => (x.kind === "type-assertion" || x.kind === "new-expression") && within(x.span, called.span))) report(`${owner.name}.${called.name} contains construction or an assertion outside the inspectable read-only contract`, called.span.start_line, called.file);
        for (const call of source.calls.filter(x => within(x.span, called.span))) {
          if (call.kind !== "method-call" || !call.receiver_text) { report(`cannot establish a read-only domain call to ${call.callee_text}`, call.span.start_line, called.file); continue; }
          const stated = receiverType(source, call) ?? (call.receiver_text === "this" ? owner.name : call.receiver_text);
          const receiver = resolveTypeName(inspection.packages, inspection.symbols, called.file, source, stated);
          if (receiver.kind !== "domain") { report(`cannot establish a read-only receiver of ${call.callee_text}`, call.span.start_line, called.file); continue; }
          const methods = receiver.type.methods.filter(x => x.name === call.callee_text);
          if (methods.length !== 1) { report(`call to ${receiver.type.name}.${call.callee_text} is not an inspectable read-only operation`, call.span.start_line, called.file); continue; }
          if (aggregates.some(x => x.type === receiver.type.name && x.package === receiver.type.pkg.name && x.module.join("/") === receiver.type.module.join("/") && x.operations.some(op => op.method === call.callee_text && op.operation_ref.startsWith("command."))))
            report(`service invokes aggregate command ${receiver.type.name}.${call.callee_text}`, call.span.start_line, called.file);
          inspectMethod(receiver.type, methods[0]);
        }
      };
      inspectMethod(type, method);
    }
  }
  return findings;
}
