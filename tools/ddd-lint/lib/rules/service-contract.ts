/** Model-side decisions shared by the two language inspectors. */
import type { ElementIndex } from "../schema/index-builder.ts";
import type { ServiceOperation } from "../schema/model.ts";
import type { OperationView } from "../aggregate-mapping/view.ts";

export function serviceOperation(index: ElementIndex | undefined, operation: OperationView): ServiceOperation | undefined {
  const resolved = index?.resolve(operation.operation_ref, "service-operation");
  return resolved?.ok ? resolved.element.node as ServiceOperation : undefined;
}

export function sameCases(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && actual.every(x => expected.includes(x));
}

export function scalarResult(type: string, language: "typescript" | "rust", code: string): boolean | undefined {
  const types: Record<string, readonly string[]> = language === "typescript"
    ? { boolean: ["boolean"], string: ["string"], integer: ["number"], decimal: ["number"], date: ["Date"], datetime: ["Date"] }
    : { boolean: ["bool"], string: ["String"], integer: ["i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128"], decimal: ["f32", "f64"], date: [], datetime: [] };
  return types[type]?.includes(code);
}
