import { join } from "node:path";
import { loadLayerDeclaration } from "../layer-declaration/index.ts";
import type { ProjectContext } from "../project/context.ts";

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
