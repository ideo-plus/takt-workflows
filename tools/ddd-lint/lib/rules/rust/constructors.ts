import type { FindingInput } from "../../shared/findings.ts";
import type { InspectionContext, InspectionTarget } from "../types.ts";
import type { LocatedMethod, RustType } from "./program.ts";
import { within } from "./program.ts";
import { constructorPathProblems } from "../constructor-graph.ts";
import { resultArguments } from "../repository-contract.ts";

export function primaryConstructor(type: RustType, context: InspectionContext): readonly LocatedMethod[] {
  return type.methods.filter((entry) => !entry.trait && entry.method.initialization.creations.some((site) =>
    site.type_text === "Self" || context.program.resolveType(entry.file, entry.module, site.type_text)?.key === type.key,
  ));
}

export function rulePrimaryConstructor(target: InspectionTarget, context: InspectionContext): FindingInput[] {
  if (!target.file) return [];
  const findings: FindingInput[] = [];
  for (const type of context.program.types.filter((entry) => entry.layer === "domain" && entry.kind === "struct" && entry.field_count > 0)) {
    const primaries = primaryConstructor(type, context);
    const report = (message: string, file = type.file, line?: number) => {
      if (file === target.file) findings.push({ rule_id: "primary-constructor", file, message: `${type.name}: ${message}`, ...(line ? { line } : {}) });
    };
    if (primaries.length !== 1) {
      report(`expected one primary constructor; found ${primaries.length}`);
      continue;
    }
    const primary = primaries[0];
    if (primary.method.visibility !== "private" || primary.method.receiver !== "none")
      report("the primary constructor must be a private associated function", primary.file, primary.method.line);
    const methods = type.methods.filter((entry) => !entry.trait && entry.method.receiver === "none");
    const key = (entry: LocatedMethod) => `${entry.file}:${entry.method.span.start_line}:${entry.method.name}`;
    const owns = (entry: LocatedMethod, text: string) => text === "Self" || context.program.resolveType(entry.file, entry.module, text)?.key === type.key;
    const paths = methods.filter((entry) => {
      const returned = entry.method.return_type_text ?? "";
      return owns(entry, resultArguments(returned)?.[0] ?? returned);
    }).map((entry) => {
      const facts = context.program.facts.files.get(entry.file)!;
      const targets = facts.constructions.flatMap((site) => {
        if (site.kind !== "associated-call" || !within(site.span, entry.method.span) || !owns(entry, site.type_text)) return [];
        return methods.filter((called) => called.method.name === site.callee_text && owns(called, resultArguments(called.method.return_type_text)?.[0] ?? called.method.return_type_text ?? "")).map(key);
      });
      return { key: key(entry), name: entry.method.name, line: entry.method.line, targets, file: entry.file };
    });
    for (const problem of constructorPathProblems(paths, key(primary))) report(problem.message, problem.path.file, problem.path.line);
    const data = context.program.facts.files.get(target.file);
    if (!data) continue;
    for (const site of data.constructions.filter((entry) => entry.kind === "struct-literal" || entry.kind === "update-syntax")) {
      const owner = type.methods.find((entry) => entry.file === target.file && within(site.span, entry.method.span));
      const own = site.type_text === "Self" ? !!owner : context.program.resolveType(target.file, context.program.files.get(target.file)!.module, site.type_text)?.key === type.key;
      if (own && (site.kind === "update-syntax" || primary.file !== target.file || !within(site.span, primary.method.span)))
        report("direct initialization is permitted only inside the primary constructor", target.file, site.span.start_line);
    }
    for (const site of data.calls.filter((entry) => entry.kind === "path-call")) {
      const owner = type.methods.find((entry) => entry.file === target.file && within(site.span, entry.method.span));
      const own = site.callee_text === "Self" ? !!owner : context.program.resolveType(target.file, [...context.program.files.get(target.file)!.module, ...site.module], site.callee_text)?.key === type.key;
      if (own && (primary.file !== target.file || !within(site.span, primary.method.span)))
        report("direct tuple initialization is permitted only inside the primary constructor", target.file, site.span.start_line);
    }
  }
  return findings;
}
