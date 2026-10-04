import type { FindingInput } from "../../shared/findings.ts";
import { domainElementKind, factoryContractProblem, factoryType } from "../factory-contract.ts";
import { aggregateMappings } from "./aggregate-binding.ts";
import { factsOf } from "./file-facts.ts";
import { resolveTypeName } from "./symbols.ts";
import type { TsInspection, TsTarget } from "./types.ts";

export function ruleFactoryNaming(inspection: TsInspection, target: TsTarget): FindingInput[] {
  const facts = factsOf(inspection, target.file);
  const findings: FindingInput[] = [];
  for (const type of inspection.symbols.types.filter((entry) => entry.file === target.file)) {
    const mappings = aggregateMappings(inspection).filter((entry) => entry.package === type.pkg.name);
    const kind = mappings.some((entry) => entry.type === type.name && entry.module.join("/") === type.module.join("/"))
      ? "entity" : domainElementKind(inspection.model, mappings.map((entry) => entry.aggregate_ref), type.name);
    const members = type.kind === "class" ? type.members.filter((entry) => entry.static)
      : facts.declarations.find((entry) => entry.kind === "variable" && entry.name === type.name)?.members ?? [];
    const aliases = facts.declarations.filter((entry) => entry.kind === "type-alias" && !entry.type_literal && entry.type_text);
    const expand = (text: string): string => {
      const seen = new Set<string>();
      while (!seen.has(text)) {
        seen.add(text);
        const alias = aliases.find((entry) => entry.name === text);
        if (!alias?.type_text) break;
        text = alias.type_text;
      }
      return text;
    };
    const isOwn = (text: string): boolean => {
      const name = expand(text).replace(/\s+/g, "");
      if (name === type.name) return true;
      const resolved = resolveTypeName(inspection.packages, inspection.symbols, target.file, facts, name);
      return resolved.kind === "domain" && resolved.type.key === type.key;
    };
    const parsed = members.find((entry) => entry.kind === "method" && entry.name === "parse");
    const backing = [parsed?.params?.[0]?.type_text, type.members.find((entry) => entry.kind === "constructor")?.params?.[0]?.type_text]
      .filter((entry): entry is string => entry !== undefined).map(expand);
    for (const method of members.filter((entry) => entry.kind === "method" && entry.visibility === "public")) {
      const params = method.params ?? [];
      const problem = factoryContractProblem({
        name: method.name, language: "typescript", elementKind: kind,
        params: params.map((param) => ({ type_text: param.type_text && expand(param.type_text) })),
        returned: method.return_type_text && expand(method.return_type_text), backingTypes: backing,
        sourceIsOwn: params.length === 1 && !!params[0].type_text && isOwn(factoryType(expand(params[0].type_text))), isOwn,
      });
      if (problem) findings.push({ rule_id: "factory-naming", file: target.file, line: method.span.start_line, message: `${type.name}.${method.name}: ${problem}` });
    }
  }
  return findings;
}
