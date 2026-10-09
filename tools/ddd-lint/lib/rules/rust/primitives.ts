import type { FindingInput } from "../../shared/findings.ts";
import { factoryPrimitive } from "../primitives.ts";
import type { InspectionContext, InspectionTarget } from "../types.ts";
import { within } from "./program.ts";
import { primaryConstructor } from "./constructors.ts";

export function rulePrimitiveInitialization(
  target: InspectionTarget,
  context: InspectionContext,
): FindingInput[] {
  if (!target.file || context.rustMapping.kind !== "loaded") return [];
  const findings: FindingInput[] = [];
  for (const type of context.program.types.filter(
    (entry) => entry.file === target.file && !entry.auxiliary && entry.kind !== "trait",
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
    if (!operations.some((entry) => entry.method === "parse"))
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
    const primaries = primaryConstructor(type, context);
    const primary = primaries.length === 1 ? primaries[0] : undefined;
    const creations = parsed?.initialization.delegations.filter((entry) => own(entry.type_text) && entry.callee_text === primary?.method.name) ?? [];
    if (
      !parsed ||
      parsed.receiver !== "none" ||
      parsed.visibility !== "pub" ||
      parsed.params.length !== 1 ||
      !creations.length ||
      creations.some((entry) => !entry.guarded)
    )
      report(
        creations.some((entry) => entry.conversion_unproven)
          ? `${type.name}::parse has an input rejection guard, but the integer conversion cannot be verified to preserve that input; require a direct f64 parameter, finite/integral rejection, and literal bounds within the target integer range`
          : `${type.name}::parse must reject invalid input with an invariant guard before calling its primary constructor`,
        parsed?.line,
      );
    if (primary && (primary.method.params.length !== 1 || primary.method.initialization.creations.filter((entry) => own(entry.type_text)).some((entry) => !entry.input_unchanged)))
      report(`${type.name} primary constructor must store the unchanged validated input`, primary.method.line);
    for (const method of methods.filter((entry) => entry.name !== primary?.method.name)) {
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
        !primary || primary.file !== target.file || !within(site, primary.method.span)
      )
        report(
          `${type.name} initialization bypasses the invariant guard; initialize through of or parse`,
          site.start_line,
        );
    }
    if (primary) for (const [file, data] of context.program.facts.files) {
      const source = context.program.files.get(file);
      if (!source) continue;
      for (const call of data.constructions.filter((entry) => entry.kind === "associated-call" && entry.callee_text === primary.method.name)) {
        const owner = type.methods.find((entry) => entry.file === file && within(call.span, entry.method.span));
        const resolved = call.type_text === "Self" ? (owner ? type : undefined) : context.program.resolveType(file, source.module, call.type_text);
        if (resolved?.key !== type.key) continue;
        const matched = creations.find((site) => within(site.span, call.span) && within(call.span, site.span));
        if (owner?.method.name === "parse" && matched?.conversion_unproven) continue; // Reported above, with the missing conversion proof.
        if (!owner || owner.method.name !== "parse" || !matched?.guarded)
          findings.push({ rule_id: "primitive-initialization", file, line: call.span.start_line, message: `${type.name} primary constructor call bypasses the validated parse path` });
      }
    }
  }
  return findings;
}
