import type { FindingInput } from "../../shared/findings.ts";
import { factoryPrimitive } from "../primitives.ts";
import type { InspectionContext, InspectionTarget } from "../types.ts";
import { within } from "./program.ts";

export function rulePrimitiveInitialization(
  target: InspectionTarget,
  context: InspectionContext,
): FindingInput[] {
  if (!target.file || context.rustMapping.kind !== "loaded") return [];
  const findings: FindingInput[] = [];
  for (const type of context.program.types.filter(
    (entry) => entry.file === target.file && entry.kind !== "trait",
  )) {
    const operations = context.rustMapping.view.aggregates
      .filter((entry) => entry.crate.replace(/-/g, "_") === type.crate)
      .flatMap((entry) => entry.operations)
      .filter(
        (entry) =>
          factoryPrimitive(context.model, entry.operation_ref)?.name ===
          type.name,
      );
    if (!operations.length) continue;
    const methods = type.methods
      .filter((entry) => !entry.trait)
      .map((entry) => entry.method);
    const report = (message: string, line?: number): void => {
      findings.push({
        rule_id: "primitive-initialization",
        file: target.file!,
        message,
        ...(line ? { line } : {}),
      });
    };
    if (type.derives.some((name) => name.split("::").at(-1) === "Deserialize"))
      report(
        `${type.name} derives Deserialize with uninspectable initialization; implement deserialization through parse`,
      );
    const parsed = methods.find((entry) => entry.name === "parse");
    if (operations.some((entry) => entry.method !== "parse"))
      report(`${type.name} must map its invariant-checking factory to parse`);
    const of = methods.find((entry) => entry.name === "of");
    if (
      !of ||
      of.visibility !== "pub" ||
      of.receiver !== "none" ||
      !["Self", type.name].includes(
        of.return_type_text?.replace(/\s/g, "") ?? "",
      ) ||
      of.params.length !== 1 ||
      of.params[0].type_text !== parsed?.params[0]?.type_text ||
      !["Self", type.name].includes(of.initialization.parse_delegate ?? "")
    )
      report(
        `${type.name}::of must return Self through parse of the unchanged input, panicking on its failure`,
        of?.line,
      );
    const own = (name: string): boolean => ["Self", type.name].includes(name);
    const creations =
      parsed?.initialization.creations.filter((entry) =>
        own(entry.type_text),
      ) ?? [];
    if (
      !parsed ||
      parsed.receiver !== "none" ||
      parsed.visibility !== "pub" ||
      parsed.params.length !== 1 ||
      !creations.length ||
      creations.some((entry) => !entry.guarded)
    )
      report(
        `${type.name}::parse must reject invalid input with an invariant guard before every direct initialization`,
        parsed?.line,
      );
    for (const method of methods.filter((entry) => entry.name !== "parse")) {
      if (method.initialization.creations.some((entry) => own(entry.type_text)))
        report(
          `${type.name}::${method.name} bypasses the invariant guard; initialize through of or parse`,
          method.line,
        );
    }
    const facts = context.program.facts.files.get(target.file)!;
    const module = context.program.files.get(target.file!)!.module;
    const ownImpls = facts.impls.filter(
      (entry) =>
        context.program.resolveType(
          target.file!,
          [...module, ...entry.module],
          entry.target_type_text,
        )?.key === type.key,
    );
    const raw = [
      ...facts.calls
        .filter(
          (call) =>
            call.kind === "path-call" &&
            (context.program.resolveType(
              target.file!,
              [
                ...context.program.files.get(target.file!)!.module,
                ...call.module,
              ],
              call.callee_text,
            )?.key === type.key ||
              (call.callee_text === "Self" &&
                ownImpls.some((entry) => within(call.span, entry.span)))),
        )
        .map((call) => call.span),
      ...facts.constructions
        .filter(
          (site) =>
            (site.kind === "struct-literal" || site.kind === "update-syntax") &&
            (site.type_text === type.name ||
              (site.type_text === "Self" &&
                ownImpls.some((entry) => within(site.span, entry.span)))),
        )
        .map((site) => site.span),
    ];
    for (const site of raw) {
      if (
        !creations.some(
          (creation) =>
            creation.guarded &&
            within(site, creation.span) &&
            within(creation.span, site),
        )
      )
        report(
          `${type.name} initialization bypasses the invariant guard; initialize through of or parse`,
          site.start_line,
        );
    }
  }
  return findings;
}
