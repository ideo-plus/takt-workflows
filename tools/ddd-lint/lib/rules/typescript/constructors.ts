import type { FindingInput } from "../../shared/findings.ts";
import { constructorPathProblems } from "../constructor-graph.ts";
import { resultArguments } from "../repository-contract.ts";
import { companionsOf, instancesOf, within, resolveTypeName } from "./symbols.ts";
import { factsOf } from "./file-facts.ts";
import type { TsInspection, TsTarget } from "./types.ts";

export function rulePrimaryConstructor(inspection: TsInspection, target: TsTarget): FindingInput[] {
  const facts = factsOf(inspection, target.file);
  const findings: FindingInput[] = [];
  for (const type of inspection.symbols.types.filter((entry) => entry.file === target.file)) {
    const report = (message: string, line = type.home.start_line) => findings.push({ rule_id: "primary-constructor", file: target.file, line, message: `${type.name}: ${message}` });
    const members = type.kind === "class" ? type.members.filter((entry) => entry.static && entry.kind === "method" && entry.writes !== undefined)
      : facts.declarations.find((entry) => entry.kind === "variable" && entry.name === type.name)?.members.filter((entry) => entry.kind === "method") ?? [];
    let primary = "constructor";
    const direct = new Set<string>();
    if (type.kind === "class") {
      const constructors = type.members.filter((entry) => entry.kind === "constructor" && entry.has_body);
      const fields = type.members.filter((entry) => entry.kind === "property" && !entry.static);
      if (!fields.length && !constructors.length) continue;
      if (constructors.length !== 1) { report(`expected one primary constructor implementation; found ${constructors.length}`); continue; }
      const constructor = constructors[0];
      if (constructor.visibility !== "private") report("the primary constructor must be private", constructor.span.start_line);
      if (constructor.constructor_fields === undefined) {
        inspection.undecided.add(target.file, constructor.span.start_line, `${type.name} primary constructor initialization`);
      } else if (fields.some((field) => !constructor.constructor_fields!.includes(field.name))) {
        report("the primary constructor must initialize every instance field", constructor.span.start_line);
      }
      for (const method of members) if (facts.constructions.some((site) => site.kind === "new-expression" && within(site.span, method.span) && (site.type_text === type.name || site.type_text === "this"))) direct.add(method.name);
    } else {
      const pair = companionsOf(facts).find((entry) => entry.type.name === type.name)!;
      const sites = instancesOf(facts, pair);
      const owners = members.filter((method) => sites.some((site) => within(site.span, method.span)));
      if (owners.length !== 1) { report(`expected one primary constructor factory; found ${owners.length}`); continue; }
      primary = owners[0].name;
      if (sites.some((site) => !within(site.span, owners[0].span))) report("direct initialization is permitted only inside the primary constructor");
    }
    const owns = (text: string) => {
      if (text === type.name) return true;
      const found = resolveTypeName(inspection.packages, inspection.symbols, target.file, facts, text);
      return found.kind === "domain" && found.type.key === type.key;
    };
    // A method that takes an instance of the type evolves it (Event Sourcing `replay(events, snapshot)`); it constructs nothing new.
    const evolves = (method: (typeof members)[number]) => (method.params ?? []).some((param) => param.type_text !== undefined && owns(param.type_text));
    const paths = members.filter((method) => method.name === primary || (owns(resultArguments(method.return_type_text)?.[0] ?? method.return_type_text ?? "") && !evolves(method))).map((method) => {
      const targets = facts.calls.flatMap((call) => {
        if (!within(call.span, method.span) || call.kind !== "method-call" || !call.receiver_text) return [];
        const nested = facts.constructions.filter((site) => site.kind === "typed-object-literal").flatMap((site) => site.members)
          .some((member) => member.kind === "method" && within(call.span, member.span) && within(member.span, method.span));
        if (nested) return [];
        if (call.receiver_text !== "this" && !owns(call.receiver_text)) return [];
        return members.filter((candidate) => candidate.name === call.callee_text && (candidate.name === primary || owns(resultArguments(candidate.return_type_text)?.[0] ?? candidate.return_type_text ?? ""))).map((candidate) => candidate.name);
      });
      if (direct.has(method.name)) targets.push("constructor");
      return { key: method.name, name: method.name, file: target.file, line: method.span.start_line, targets };
    });
    if (type.kind === "class") paths.push({ key: "constructor", name: "constructor", file: target.file, line: type.home.start_line, targets: [] });
    for (const problem of constructorPathProblems(paths, primary)) report(problem.message, problem.path.line);
  }
  return findings;
}
