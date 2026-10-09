/** Independent operations use the same IDs, references and operation-owned errors as the model. */
import { parseElementId } from "./element-id.ts";
import type { ElementIndex } from "./index-builder.ts";
import { readDomainErrors, readObjectArray, readStringArray, SCALAR_TYPES, type Report } from "./reader.ts";
import type { BoundedContext, DomainService, ServiceOperation } from "./model.ts";
import { isRecord } from "../shared/yaml-read.ts";

function readOperation(report: Report, raw: Record<string, unknown>, where: string): ServiceOperation | undefined {
  report.checkKeys(raw, ["element_id", "name", "service", "inputs", "result", "statement", "domain_errors", "failure_order"], where);
  const element_id = report.idField(raw, "element_id", where);
  const name = report.requiredString(raw, "name", where);
  const service = report.requiredString(raw, "service", where);
  const statement = report.requiredString(raw, "statement", where);
  const inputs = readObjectArray(report, raw, "inputs", where, true).map((input, i) => {
    const at = `${where}.inputs[${i}]`;
    report.checkKeys(input, ["name", "type"], at);
    const name = report.requiredString(input, "name", at);
    const type = report.requiredString(input, "type", at);
    return name === undefined || type === undefined ? undefined : { name, type };
  });
  const result = raw.result;
  let type: string | undefined;
  if (isRecord(result)) {
    report.checkKeys(result, ["type"], `${where}.result`);
    type = report.requiredString(result, "type", `${where}.result`);
  }
  if (type === undefined) report.add("schema.structure", `${where}.result must name its type`);
  const errors = readDomainErrors(report, raw, where);
  const failure_order = readStringArray(report, raw, "failure_order", where, true);
  if (!inputs.length || !errors.length) report.add("schema.service-operation", `${where}: inputs and domain_errors each need at least one entry`);
  if (!statement?.trim() || errors.some(x => x && !x.condition.trim())) report.add("schema.service-operation", `${where}: statement and error conditions must state business rules`);
  if (!element_id || !name || !service || !statement || !type || inputs.some(x => !x) || errors.some(x => !x)) return undefined;
  return { element_id, name, service, statement, inputs: inputs as ServiceOperation["inputs"], result: { type }, domain_errors: errors as ServiceOperation["domain_errors"], failure_order };
}

export function readServices(report: Report, raw: Record<string, unknown>, where: string): (DomainService | undefined)[] {
  return readObjectArray(report, raw, "domain_services", where, false).map((node, i) => {
    const at = `${where}.domain_services[${i}]`;
    report.checkKeys(node, ["element_id", "name", "bounded_context", "responsibility", "operations"], at);
    const element_id = report.idField(node, "element_id", at);
    const name = report.requiredString(node, "name", at);
    const bounded_context = report.requiredString(node, "bounded_context", at);
    const responsibility = report.requiredString(node, "responsibility", at);
    if (!responsibility?.trim()) report.add("schema.service-operation", `${at}: responsibility must state the business responsibility`);
    const operations = readObjectArray(report, node, "operations", at, true).map((op, j) => readOperation(report, op, `${at}.operations[${j}]`));
    if (!operations.length) report.add("schema.service-operation", `${at}: operations needs at least one entry`);
    if (!element_id || !name || !bounded_context || !responsibility || operations.some(x => !x)) return undefined;
    return { element_id, name, bounded_context, responsibility, operations: operations as ServiceOperation[] };
  });
}

export function validateServices(report: Report, bc: BoundedContext, index: ElementIndex): void {
  for (const service of bc.domain_services ?? []) {
    const serviceId = parseElementId(service.element_id);
    if (!serviceId.ok || serviceId.id.kind !== "service" || service.bounded_context !== bc.element_id)
      report.add("schema.id-owner-mismatch", `${service.element_id}: service must belong to its containing context ${bc.element_id}`);
    const serviceSegment = serviceId.ok ? serviceId.id.segments[0] : undefined;
    for (const operation of service.operations) {
      const opId = parseElementId(operation.element_id);
      if (!opId.ok || opId.id.kind !== "service-operation" || opId.id.segments[0] !== serviceSegment || operation.service !== service.element_id)
        report.add("schema.id-owner-mismatch", `${operation.element_id}: operation must belong to ${service.element_id}`);
      const names = operation.inputs.map(x => x.name);
      if (new Set(names).size !== names.length) report.add("schema.service-operation", `${operation.element_id}: input names must be unique`);
      for (const [ref, result] of [...operation.inputs.map(x => [x.type, false] as const), [operation.result.type, true] as const]) {
        if (result && SCALAR_TYPES.has(ref)) continue;
        const resolved = index.resolve(ref);
        const allowed = result ? ["vo", "primitive"] : ["entity", "vo", "primitive"];
        const owner = resolved.ok && resolved.element.owner ? index.byId(resolved.element.owner) : undefined;
        const ownerContext = (owner?.node as { bounded_context?: string } | undefined)?.bounded_context;
        if (!resolved.ok || !allowed.includes(resolved.element.kind) || ownerContext !== bc.element_id)
          report.add("schema.service-reference", `${operation.element_id}: ${ref} must name a ${result ? "value result" : "domain input"} in ${bc.element_id}`);
      }
      const failures = operation.domain_errors.map(x => x.element_id);
      if (new Set(operation.failure_order).size !== failures.length || operation.failure_order.length !== failures.length || failures.some(x => !operation.failure_order.includes(x)))
        report.add("schema.service-failure-order", `${operation.element_id}: failure_order must list every owned error exactly once`);
      for (const error of operation.domain_errors) {
        const id = parseElementId(error.element_id);
        if (error.operation !== operation.element_id || !id.ok || id.id.kind !== "error" || id.id.segments[0] !== serviceSegment || (opId.ok && id.id.segments[1] !== opId.id.segments[1]))
          report.add("schema.id-owner-mismatch", `${error.element_id}: error must belong to ${operation.element_id}`);
      }
    }
  }
}
