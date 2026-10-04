import { join } from "node:path";
import { loadLayerDeclaration } from "../layer-declaration/index.ts";
import type { ProjectContext } from "../project/context.ts";

/** The value argument of an explicitly spelled Map/HashMap, including qualified names. */
export function storedMapValue(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /^(?:::)?(?:[\w$]+(?:::|\.))*(?:Map|ReadonlyMap|HashMap|BTreeMap)<(.*)>$/.exec(text.replace(/\s+/g, ""));
  if (!match) return undefined;
  let depth = 0;
  let valueStart: number | undefined;
  for (let i = 0; i < match[1].length; i++) {
    const char = match[1][i];
    if ("<([{".includes(char)) depth++;
    else if (">)]}".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      if (valueStart !== undefined) return match[1].slice(valueStart, i);
      valueStart = i + 1;
    }
  }
  return valueStart === undefined ? undefined : match[1].slice(valueStart);
}

/** The aggregates whose repository belongs to this package's explicitly declared memory backend. */
export function inMemoryAggregates(
  run: ProjectContext,
  packageName: string,
  language: "rust" | "typescript",
): ReadonlySet<string> {
  const loaded = loadLayerDeclaration(
    join(run.modelDir, "layer-structure.yaml"),
  );
  if (!loaded.ok) return new Set();
  return new Set(
    loaded.declaration.layer_structures
      .filter(
        (entry) =>
          entry.persistence_backend === "in-memory" &&
          entry.packages.some(
            (pkg) =>
              pkg.code.language === language &&
              pkg.code.package === packageName,
          ),
      )
      .flatMap((entry) =>
        entry.repositories.map((repository) => repository.aggregate_ref),
      ),
  );
}
