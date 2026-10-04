import type { FindingInput } from "../../shared/findings.ts";
import { domainElementKind, factoryContractProblem, factoryType } from "../factory-contract.ts";
import type { InspectionContext, InspectionTarget } from "../types.ts";

export function ruleFactoryNaming(target: InspectionTarget, context: InspectionContext): FindingInput[] {
  if (!target.file) return [];
  const findings: FindingInput[] = [];
  for (const type of context.program.types.filter((entry) => entry.layer === "domain" && entry.kind !== "trait")) {
    const mappings = context.rustMapping.kind === "loaded" ? context.rustMapping.view.aggregates.filter((entry) => entry.crate.replace(/-/g, "_") === type.crate) : [];
    const kind = mappings.some((entry) => entry.type === type.name && entry.module.join("::") === type.module.join("::"))
      ? "entity" : domainElementKind(context.model, mappings.map((entry) => entry.aggregate_ref), type.name);
    const methods = type.methods.filter((entry) => !entry.trait || /(?:^|::)(?:From|TryFrom)</.test(entry.trait.replace(/\s/g, "")));
    const parsed = methods.find((entry) => !entry.trait && entry.method.name === "parse")?.method;
    for (const { method, trait, file, module } of methods) {
      if (file !== target.file) continue;
      if (method.receiver !== "none" || (!trait && method.visibility !== "pub")) continue;
      const facts = context.program.facts.files.get(file)!;
      const aliases = facts.aliases.filter((entry) => !entry.generic && !entry.local && entry.module.length === 0);
      const expand = (text: string): string => {
        const seen = new Set<string>();
        while (!seen.has(text)) {
          seen.add(text);
          const alias = aliases.find((entry) => entry.name === text.trim());
          if (!alias) break;
          text = alias.type_text;
        }
        return text;
      };
      const isOwn = (text: string): boolean => {
        const name = expand(text).replace(/\s+/g, "");
        return !name.startsWith("&") && (name === "Self" || context.program.resolveType(file, module, name)?.key === type.key);
      };
      const problem = factoryContractProblem({
        name: method.name, language: "rust", elementKind: kind, params: method.params.map((param) => ({ type_text: expand(param.type_text) })),
        returned: method.return_type_text && expand(method.return_type_text), backingTypes: parsed?.params[0] ? [expand(parsed.params[0].type_text)] : [],
        sourceIsOwn: method.params.length === 1 && isOwn(factoryType(method.params[0].type_text)), isOwn,
      });
      if (problem) findings.push({ rule_id: "factory-naming", file: target.file, line: method.line, message: `${type.name}::${method.name}: ${problem}` });
    }
  }
  return findings;
}
