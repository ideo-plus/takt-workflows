import type { FindingInput } from "../../shared/findings.ts";
import { factoryPrimitive } from "../primitives.ts";
import { aggregateMappings } from "./aggregate-binding.ts";
import { factsOf } from "./file-facts.ts";
import { within } from "./symbols.ts";
import type { TsInspection, TsTarget } from "./types.ts";

export function rulePrimitiveInitialization(
  inspection: TsInspection,
  target: TsTarget,
): FindingInput[] {
  const findings: FindingInput[] = [];
  for (const type of inspection.symbols.types.filter(
    (entry) => entry.file === target.file,
  )) {
    const operations = aggregateMappings(inspection)
      .filter((entry) => entry.package === type.pkg.name)
      .flatMap((entry) => entry.operations)
      .filter(
        (entry) =>
          factoryPrimitive(inspection.model, entry.operation_ref)?.name ===
          type.name,
      );
    if (!operations.length) continue;
    const members =
      type.kind === "class"
        ? type.members.filter((entry) => entry.static)
        : (factsOf(inspection, target.file).declarations.find(
            (entry) => entry.kind === "variable" && entry.name === type.name,
          )?.members ?? []);
    const methods = members.filter((entry) => entry.kind === "method");
    const report = (message: string, line = type.home.start_line): void => {
      findings.push({
        rule_id: "primitive-initialization",
        file: target.file,
        message,
        line,
      });
    };
    const parsed = methods.find((entry) => entry.name === "parse");
    if (type.kind === "class") {
      const constructor = type.members.find(
        (entry) => entry.kind === "constructor",
      );
      const fields = type.members.filter(
        (entry) => entry.kind === "property" && !entry.static,
      );
      if (
        !constructor ||
        constructor.visibility !== "private" ||
        constructor.params?.length !== 1 ||
        fields.length !== 1 ||
        constructor.input_field !== fields[0].name
      )
        report(
          `${type.name} constructor must privately store the unchanged validated input`,
          constructor?.span.start_line,
        );
    }
    if (operations.some((entry) => entry.method !== "parse"))
      report(`${type.name} must map its invariant-checking factory to parse`);
    const of = methods.find((entry) => entry.name === "of");
    if (
      !of ||
      of.visibility !== "public" ||
      of.return_type_text?.replace(/\s/g, "") !== type.name ||
      of.params?.length !== 1 ||
      of.params[0].type_text !== parsed?.params?.[0]?.type_text ||
      ![type.name, "this"].includes(of.initialization?.parse_delegate ?? "")
    )
      report(
        `${type.name}.of must return ${type.name} through parse of the unchanged input, throwing on its failure`,
        of?.span.start_line,
      );
    const ownCreations =
      parsed?.initialization?.creations.filter(
        (entry) => entry.type_text === type.name,
      ) ?? [];
    if (
      !parsed ||
      parsed.visibility !== "public" ||
      parsed.params?.length !== 1 ||
      !ownCreations.length ||
      ownCreations.some((entry) => !entry.guarded)
    )
      report(
        `${type.name}.parse must reject invalid input with an invariant guard before every direct initialization`,
        parsed?.span.start_line,
      );
    for (const creation of factsOf(
      inspection,
      target.file,
    ).constructions.filter(
      (entry) => entry.type_text === type.name && within(entry.span, type.home),
    )) {
      const guarded = ownCreations.some(
        (entry) =>
          entry.guarded &&
          entry.span.start_line === creation.span.start_line &&
          entry.span.start_col === creation.span.start_col &&
          entry.span.end_line === creation.span.end_line &&
          entry.span.end_col === creation.span.end_col,
      );
      if (!guarded)
        report(
          `${type.name} initialization bypasses the invariant guard; initialize through of or parse`,
          creation.span.start_line,
        );
    }
  }
  return findings;
}
