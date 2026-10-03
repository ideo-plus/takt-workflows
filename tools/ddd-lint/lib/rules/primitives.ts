import type { DomainElement, FactoryRule } from "../schema/model.ts";
import type { ModelAvailability } from "./types.ts";

/** Bind a mapped fallible factory to the Domain Primitive it initializes. */
export function factoryPrimitive(
  model: ModelAvailability,
  operationRef: string,
): DomainElement | undefined {
  if (!operationRef.startsWith("factory.") || !model.index) return undefined;
  const factory = model.index.byId(operationRef)?.node as
    | FactoryRule
    | undefined;
  if (!factory?.target_element) return undefined;
  const element = model.index.byId(factory.target_element)?.node as
    | DomainElement
    | undefined;
  return element?.kind === "domain-primitive" ? element : undefined;
}
