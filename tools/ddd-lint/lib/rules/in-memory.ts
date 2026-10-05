import { join } from "node:path";
import { loadLayerDeclaration } from "../layer-declaration/index.ts";
import type { ProjectContext } from "../project/context.ts";
import type { ModelAvailability } from "./types.ts";

/** Model state elements are never event stream elements, even when imported under an event alias. */
export function isAggregateStateElement(model: ModelAvailability, aggregateRef: string, typeName: string): boolean {
  return model.index?.elements().some((element) =>
    element.owner === aggregateRef && ["entity", "vo", "primitive"].includes(element.kind) && element.name === typeName,
  ) ?? false;
}

export const EVENT_SOURCING_STORAGE = "Event Sourcing keeps event streams and snapshots of the aggregate itself, not other state";

/** An in-memory Event Sourcing repository keeps the event streams and one map of aggregate snapshots, from which findById replays only later events. */
export function eventSourcingStorageGaps(streams: number, snapshots: number): readonly string[] {
  return [
    ...(streams === 0 ? ["keeps no event stream; append each stored event to a Map/HashMap of event streams"] : []),
    ...(snapshots === 0 ? ["keeps no aggregate snapshot; keep the latest snapshot so findById replays only the events after it"] : []),
    ...(snapshots > 1 ? ["keeps more than one snapshot map; keep one map of the aggregate itself"] : []),
  ];
}

/** A stored event stream explicitly states its element type. */
export function eventStreamElement(text: string, language: "rust" | "typescript"): string | undefined {
  if (language === "rust") return /^(?:::)?(?:\w+::)*Vec<(.+)>$/.exec(text)?.[1];
  return /^(?:readonly)?(.+)\[\]$/.exec(text)?.[1] ?? /^(?:[\w$]+\.)*(?:ReadonlyArray|Array)<(.+)>$/.exec(text)?.[1];
}

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
