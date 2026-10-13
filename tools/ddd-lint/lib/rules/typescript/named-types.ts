/** Explicit names and simple aliases for repository contracts and owned snapshot parameters. */
import { join } from "node:path";
import type { DeclarationFact } from "../../typescript/domain-facts/index.ts";
import { packageContaining, resolveSpecifier, specifierSourcePaths } from "./edges.ts";
import { isNamedType } from "./symbols.ts";
import type { TsInspection } from "./types.ts";

export type NamedTypeResolution =
  | { kind: "found"; file: string; declaration: DeclarationFact }
  | { kind: "other" }
  | { kind: "undecided"; reason: string };

const TYPE_KINDS = new Set(["class", "interface", "type-alias", "enum"]);

/** A named event union consists only of the declared event types, never containers or error types. */
export function isEventType(
  inspection: TsInspection, found: NamedTypeResolution, names: ReadonlySet<string>, packageName: string,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (found.kind !== "found" || !names.has(found.declaration.name)) return false;
  const pkg = packageContaining(inspection.packages, join(inspection.packages.workspaceRoot, found.file));
  if (pkg?.name !== packageName || found.declaration.generic) return false;
  const key = `${found.file}#${found.declaration.name}`;
  if (seen.has(key)) return false;
  const { declaration } = found;
  if (declaration.kind !== "type-alias" || declaration.type_literal) return true;
  const members = declaration.type_text?.split("|").map((member) => member.trim());
  return members !== undefined && members.length > 0 && members.every((member) => isNamedType(member) &&
    isEventType(inspection, resolveNamedType(inspection, found.file, member), names, packageName, new Set(seen).add(key)));
}

/** Follow only aliases of one name; arrays, optional values and generic wrappers keep their shape. */
export function resolveNamedType(
  inspection: TsInspection, file: string, text: string, seen: ReadonlySet<string> = new Set(),
): NamedTypeResolution {
  const name = text.trim();
  if (!isNamedType(name)) return { kind: "other" };
  const key = `${file}#${name}`;
  if (seen.has(key)) return { kind: "undecided", reason: `${key} has a cyclic type alias` };
  const next = new Set(seen).add(key);
  const facts = inspection.facts.files.get(file);
  if (!facts) return { kind: "undecided", reason: `${file} was not read` };
  const local = facts.declarations.find((entry) => entry.name === name && TYPE_KINDS.has(entry.kind));
  if (local) {
    if (local.kind === "type-alias" && !local.generic && local.type_text && isNamedType(local.type_text)) {
      const target = resolveNamedType(inspection, file, local.type_text, next);
      return target.kind === "other" ? { kind: "undecided", reason: `${key} aliases an unresolved type ${local.type_text}` } : target;
    }
    return { kind: "found", file, declaration: local };
  }
  const [first, second] = name.split(".");
  for (const entry of facts.imports) {
    const binding = entry.bindings.find((candidate) => candidate.name === first &&
      (second === undefined ? candidate.imported !== "*" : candidate.imported === "*"));
    if (!binding) continue;
    return resolveImportedType(inspection, file, entry.specifier, second ?? binding.imported, next);
  }
  return { kind: "other" };
}

/** Resolve explicit export names without borrowing an unrelated declaration from the same file. */
function resolveExportedType(inspection: TsInspection, file: string, name: string, seen: ReadonlySet<string>): NamedTypeResolution {
  const key = `${file}#export:${name}`;
  if (seen.has(key)) return { kind: "undecided", reason: `${key} has a cyclic re-export` };
  const next = new Set(seen).add(key);
  const facts = inspection.facts.files.get(file)!;
  const declaration = facts.declarations.find((entry) => TYPE_KINDS.has(entry.kind) &&
    (name === "default" ? entry.default_export : entry.exported && entry.name === name));
  if (declaration) return resolveNamedType(inspection, file, declaration.name, next);
  for (const entry of facts.exports) {
    const binding = entry.names.find((candidate) => candidate.name === name);
    if (!binding) continue;
    return entry.specifier
      ? resolveImportedType(inspection, file, entry.specifier, binding.local, next)
      : resolveNamedType(inspection, file, binding.local, next);
  }
  return { kind: "undecided", reason: `${file} does not explicitly export type ${name}` };
}

function resolveImportedType(
  inspection: TsInspection, file: string, specifier: string, name: string, seen: ReadonlySet<string>,
): NamedTypeResolution {
  const absolute = join(inspection.packages.workspaceRoot, file);
  const owner = packageContaining(inspection.packages, absolute)!;
  const target = resolveSpecifier(inspection.packages, owner, absolute, specifier);
  if (target.kind === "unresolved") return { kind: "undecided", reason: target.reason };
  if (target.kind !== "package") return { kind: "other" };
  const paths = specifierSourcePaths(inspection.packages, owner, absolute, specifier);
  if (!paths?.length) return { kind: "undecided", reason: `${specifier} does not name an explicit source entry` };
  const sources = new Set<string>();
  for (const base of paths) {
    const paths = [base, base.replace(/\.[cm]?js$/, ".ts"), `${base}.ts`, `${base}.tsx`, join(base, "index.ts")];
    const candidates = [...inspection.facts.files.keys()].filter((candidate) => paths.includes(join(inspection.packages.workspaceRoot, candidate)));
    if (candidates.length !== 1) return { kind: "undecided", reason: `${specifier} does not name one read source` };
    sources.add(candidates[0]);
  }
  if (sources.size !== 1) return { kind: "undecided", reason: `${specifier} names more than one possible source entry` };
  return resolveExportedType(inspection, [...sources][0], name, seen);
}
