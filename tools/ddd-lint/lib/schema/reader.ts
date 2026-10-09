/** Shared closed-schema readers: aggregate and service declarations use the same ID and error rules. */
import { assertFindingInput, type FindingInput } from "../shared/findings.ts";
import { isRecord } from "../shared/yaml-read.ts";
import { parseElementId, type ElementId } from "./element-id.ts";
import type { DomainError } from "./model.ts";

export const SCALAR_TYPES = new Set(["string", "integer", "decimal", "boolean", "date", "datetime"]);
const ERROR_KEYS: readonly string[] = ["element_id", "name", "operation", "condition"];

export class Report {
  readonly findings: FindingInput[] = [];

  constructor(private readonly file: string) {}

  add(ruleId: string, message: string, line?: number): void {
    const finding: FindingInput = {
      rule_id: ruleId,
      file: this.file,
      message,
      ...(line === undefined ? {} : { line }),
    };
    assertFindingInput(finding);
    this.findings.push(finding);
  }

  checkKeys(node: Record<string, unknown>, allowed: readonly string[], where: string): void {
    const allow = new Set(allowed);
    for (const key of Object.keys(node)) {
      if (!allow.has(key)) {
        this.add("schema.unknown-key", `${where}: unknown key "${key}"`);
      }
    }
  }

  requiredString(node: Record<string, unknown>, key: string, where: string): string | undefined {
    const value = node[key];
    if (typeof value !== "string" || value.length === 0) {
      this.add("schema.structure", `${where}: "${key}" must be a non-empty string`);
      return undefined;
    }
    return value;
  }

  optionalString(node: Record<string, unknown>, key: string, where: string): string | undefined {
    const value = node[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length === 0) {
      this.add("schema.structure", `${where}: "${key}" must be a non-empty string`);
      return undefined;
    }
    return value;
  }

  private idCache = new Map<string, ElementId | undefined>();

  parseId(text: string, where: string): ElementId | undefined {
    if (this.idCache.has(text)) return this.idCache.get(text);
    const parsed = parseElementId(text);
    if (!parsed.ok) {
      this.add(parsed.rule_id, `${where}: ${parsed.message}`);
      this.idCache.set(text, undefined);
      return undefined;
    }
    this.idCache.set(text, parsed.id);
    return parsed.id;
  }

  idField(node: Record<string, unknown>, key: string, where: string): string | undefined {
    const value = this.requiredString(node, key, where);
    if (value === undefined) return undefined;
    return this.parseId(value, where)?.value;
  }
}

export function readStringArray(
  report: Report,
  node: Record<string, unknown>,
  key: string,
  where: string,
  required: boolean,
): string[] {
  const value = node[key];
  if (value === undefined) {
    if (required) report.add("schema.structure", `${where}: "${key}" is required`);
    return [];
  }
  if (!Array.isArray(value)) {
    report.add("schema.structure", `${where}: "${key}" must be a list`);
    return [];
  }
  const out: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      report.add("schema.structure", `${where}: "${key}[${index}]" must be a non-empty string`);
      return;
    }
    out.push(entry);
  });
  return out;
}

export function readObjectArray(
  report: Report,
  node: Record<string, unknown>,
  key: string,
  where: string,
  required: boolean,
): Record<string, unknown>[] {
  const value = node[key];
  if (value === undefined) {
    if (required) report.add("schema.structure", `${where}: "${key}" is required`);
    return [];
  }
  if (!Array.isArray(value)) {
    report.add("schema.structure", `${where}: "${key}" must be a list`);
    return [];
  }
  const out: Record<string, unknown>[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      report.add("schema.structure", `${where}: "${key}[${index}]" must be an object`);
      return;
    }
    out.push(entry);
  });
  return out;
}

function readDomainError(
  report: Report,
  node: Record<string, unknown>,
  where: string,
): DomainError | undefined {
  report.checkKeys(node, ERROR_KEYS, where);
  const element_id = report.idField(node, "element_id", where);
  const name = report.requiredString(node, "name", where);
  // Read as a plain string, not as an element_id: an owner that is not well-formed is reported as
  // an unresolvable reference by the cross-element pass, where the expected kind is also known.
  const operation = report.requiredString(node, "operation", where);
  const condition = report.requiredString(node, "condition", where);
  if (element_id === undefined || name === undefined || operation === undefined || condition === undefined) {
    return undefined;
  }
  return { element_id, name, operation, condition };
}

export function readDomainErrors(
  report: Report,
  node: Record<string, unknown>,
  where: string,
): (DomainError | undefined)[] {
  return readObjectArray(report, node, "domain_errors", where, true).map((raw, index) =>
    readDomainError(report, raw, `${where}/domain_errors[${index}]`),
  );
}
