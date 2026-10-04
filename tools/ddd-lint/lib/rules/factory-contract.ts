import type { DomainElementKind } from "../schema/model.ts";
import type { ModelAvailability } from "./types.ts";
import { resultArguments } from "./repository-contract.ts";

export interface FactoryContract {
  readonly name: string;
  readonly language: "rust" | "typescript";
  readonly elementKind?: DomainElementKind;
  readonly params: readonly { readonly type_text?: string }[];
  readonly returned?: string;
  readonly backingTypes: readonly string[];
  readonly sourceIsOwn: boolean;
  readonly isOwn: (text: string) => boolean;
}

/** References change ownership, not the value's domain type. No generic or compiler inference. */
export function factoryType(text: string): string {
  return text.trim().replace(/^&\s*(?:'\w+\s+)?(?:mut\s+)?/, "").replace(/\s+/g, "");
}

export function domainElementKind(
  model: ModelAvailability,
  aggregateRefs: readonly string[],
  typeName: string,
): DomainElementKind | undefined {
  const element = model.index?.elements().find((element) =>
    aggregateRefs.includes(element.owner ?? "") && element.name === typeName &&
    ["entity", "vo", "primitive"].includes(element.kind),
  );
  return element ? (element.node as { kind: DomainElementKind }).kind : undefined;
}

/** The spelling of these factories states a checkable signature, not allocation or caching. */
export function factoryContractProblem(contract: FactoryContract): string | undefined {
  const { name, params, language, returned, elementKind, isOwn } = contract;
  if (!["of", "parse", "from", "try_from"].includes(name)) return undefined;
  const result = resultArguments(returned);
  if (!elementKind && !(result ? isOwn(result[0]) : returned && isOwn(returned))) return undefined;
  if (name === "of") {
    if (elementKind === "entity") return "of constructs a value object; use create or a declared business factory for an Entity";
    if (!returned || !isOwn(returned)) return "of returns the value itself; use parse for a fallible Result";
  }
  if (name === "parse" && (!result || !isOwn(result[0])))
    return "parse returns Result<Self, Parse…Error> (TypeScript: Result<VO, Parse…Error>); typed inputs are permitted";
  if (name === "from" || name === "try_from") {
    if (params.length !== 1 || !params[0].type_text)
      return `${name} converts one explicitly typed source value`;
    if (contract.sourceIsOwn) return `${name} does not copy the same domain type; use clone or the existing value`;
    const source = factoryType(params[0].type_text);
    if (["any", "unknown", "_"].includes(source)) return `${name} must state the distinct source type`;
    if (name === "from" && elementKind === "domain-primitive" && contract.backingTypes.some((type) => factoryType(type) === source))
      return "from does not wrap a Domain Primitive's backing input; use its checked of or parse";
    if (language === "rust" && name === "from" && (result || !returned || !isOwn(returned)))
      return "Rust from is infallible and returns Self; use try_from for Result<Self, ConversionError>";
    if ((language === "rust" && name === "try_from") || (language === "typescript" && name === "from" && result)) {
      if (!result || !isOwn(result[0])) return `${name} must return Result of the constructed type`;
    } else if (!result && (!returned || !isOwn(returned))) {
      return `${name} must return the constructed type`;
    }
  }
  return undefined;
}
