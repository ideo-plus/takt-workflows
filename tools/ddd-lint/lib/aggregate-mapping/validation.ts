/**
 * Checks a draft mapping against the canonical model it names.
 *
 * Findings are defects of what the mapping says: a broken or foreign reference, a duplicate, a
 * package the ownership chain lacks, a technical classification used as a business name. What the
 * mapping has not said yet — a type name, an operation, an error case the model requires — is
 * returned separately as `missing`, in document order and, within an aggregate, in model order.
 * This module alone decides which operations and error cases a mapping must cover.
 */

import type { ElementKind } from "../schema/element-id.ts";
import type { ElementIndex, ResolveReason } from "../schema/index-builder.ts";
import type { Aggregate, Command, DomainModel, FactoryRule, IndexedElement } from "../schema/model.ts";
import type { FindingInput } from "../shared/findings.ts";
import {
  type AggregateMapping,
  type AggregateMappingDraft,
  type CodeLocation,
  type DomainPackageMapping,
  type ImplementationMapping,
  MAPPING_RULES,
  type MappingDraft,
  MappingReport,
  type OperationMapping,
} from "./contract.ts";
import { type OperationKind, SPELLINGS } from "./language.ts";
import { describeLocation, intermediateLocations, locationKey, rootLocation } from "./location.ts";

interface ValidationFiles {
  /** The mapping document: locations, business ids and vocabulary are reported against it. */
  readonly document: string;
  /** Where the type, operation and error-case names were read from. */
  readonly names: string;
}

type MappingValidation =
  | {
      readonly complete: true;
      readonly findings: readonly FindingInput[];
      readonly mapping: ImplementationMapping;
    }
  | {
      readonly complete: false;
      readonly findings: readonly FindingInput[];
      readonly missing: readonly string[];
    };

interface ExpectedElement {
  readonly kind: ElementKind | undefined;
  readonly label: string;
}

const ANY_ELEMENT: ExpectedElement = { kind: undefined, label: "a model element" };
const AGGREGATE: ExpectedElement = { kind: "aggregate", label: "an aggregate" };
const EVENT: ExpectedElement = { kind: "event", label: "a domain event" };
const BUSINESS_ERROR: ExpectedElement = { kind: "error", label: "a business error" };

function unresolved(reason: ResolveReason, expected: ExpectedElement): string {
  switch (reason) {
    case "undefined":
      return "is not defined by the canonical model";
    case "deprecated":
      return "is retired by the model lineage";
    case "kind-mismatch":
      return `does not name ${expected.label}`;
    case "malformed":
      return "is not a model element id";
  }
}

function resolveReference(
  report: MappingReport,
  index: ElementIndex,
  id: string,
  where: string,
  expected: ExpectedElement,
): IndexedElement | undefined {
  const result = index.resolve(id, expected.kind);
  if (result.ok) return result.element;
  report.add(MAPPING_RULES.reference, `${where}: ${JSON.stringify(id)} ${unresolved(result.reason, expected)}`);
  return undefined;
}

interface ResolvedOperation {
  readonly element_id: string;
  readonly kind: OperationKind;
  readonly owner: string | undefined;
}

function resolveOperation(
  report: MappingReport,
  index: ElementIndex,
  id: string,
  where: string,
): ResolvedOperation | undefined {
  const element = resolveReference(report, index, id, where, ANY_ELEMENT);
  if (element === undefined) return undefined;
  if (element.kind === "command" || element.kind === "factory" || element.kind === "service-operation")
    return { element_id: id, kind: element.kind, owner: element.owner };
  report.add(
    MAPPING_RULES.reference,
    `${where}: ${JSON.stringify(id)} names a ${element.kind}, not a command or a factory rule`,
  );
  return undefined;
}

/** The operations a mapping of `aggregate` must cover: its commands, then its factory rules, in model order. */
function operationsOf(aggregate: Aggregate): readonly (Command | FactoryRule)[] {
  return [...aggregate.commands, ...aggregate.factory_rules];
}

function aggregateWhere(entry: AggregateMappingDraft): string {
  return `aggregate_mappings[${entry.aggregate_ref}]`;
}

function packageWhere(entry: DomainPackageMapping): string {
  return `domain_packages[${describeLocation(entry.code)}]`;
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

function checkTechnicalNames(report: MappingReport, location: CodeLocation, where: string): void {
  const spelling = SPELLINGS[location.language];
  const packageClassification = spelling.technicalPackage(location.package);
  if (packageClassification !== undefined)
    report.add(
      MAPPING_RULES.technicalName,
      `${where}: package ${location.package} is named after the technical classification "${packageClassification}" instead of a business term`,
    );
  for (const segment of location.module) {
    const classification = spelling.technicalSegment(segment);
    if (classification !== undefined)
      report.add(
        MAPPING_RULES.technicalName,
        `${where}: module ${segment} is named after the technical classification "${classification}" instead of a business term`,
      );
  }
}

/** Checks each declared package and returns the keys of the locations they own. */
function checkPackages(
  report: MappingReport,
  index: ElementIndex,
  packages: readonly DomainPackageMapping[],
): ReadonlySet<string> {
  const declared = new Set<string>();
  for (const entry of packages) {
    const where = packageWhere(entry);
    const key = locationKey(entry.code);
    if (declared.has(key))
      report.add(MAPPING_RULES.duplicate, `${where}: another package is already declared at this location`);
    declared.add(key);
    checkTechnicalNames(report, entry.code, where);
    for (const ref of entry.model_refs) resolveReference(report, index, ref, `${where}.model_refs`, ANY_ELEMENT);
  }
  return declared;
}

/** Every package in use has a declared root, and every declared package a declared parent chain. */
function checkPackageChains(report: MappingReport, draft: MappingDraft, declared: ReadonlySet<string>): void {
  const roots = new Map<string, CodeLocation>();
  for (const location of [
    ...draft.domain_packages.map((entry) => entry.code),
    ...draft.aggregate_mappings.map((entry) => entry.code),
    ...(draft.service_mappings ?? []).map((entry) => entry.code),
  ]) {
    const root = rootLocation(location);
    roots.set(locationKey(root), root);
  }
  for (const [key, root] of roots) {
    if (!declared.has(key))
      report.add(MAPPING_RULES.coverage, `${describeLocation(root)} has no root package declaration (module: [])`);
  }
  for (const entry of draft.domain_packages) {
    for (const parent of intermediateLocations(entry.code)) {
      if (!declared.has(locationKey(parent)))
        report.add(
          MAPPING_RULES.coverage,
          `${packageWhere(entry)}: the parent package ${describeLocation(parent)} is not declared`,
        );
    }
  }
}

// ---------------------------------------------------------------------------
// Operations and error cases
// ---------------------------------------------------------------------------

function checkErrorCases(
  report: MappingReport,
  index: ElementIndex,
  errorOwners: ReadonlyMap<string, string>,
  operation: OperationMapping,
  owner: ResolvedOperation | undefined,
  where: string,
): void {
  const errorRefs = new Set<string>();
  const cases = new Set<string>();
  for (const errorCase of operation.errors) {
    const errorWhere = `${where}.errors[${errorCase.error_ref}]`;
    if (errorRefs.has(errorCase.error_ref))
      report.add(MAPPING_RULES.duplicate, `${errorWhere}: the error is mapped more than once`);
    errorRefs.add(errorCase.error_ref);
    if (cases.has(errorCase.code.case))
      report.add(
        MAPPING_RULES.duplicate,
        `${errorWhere}.code.case: ${errorCase.code.case} already stands for another error of this operation`,
      );
    cases.add(errorCase.code.case);
    const element = resolveReference(report, index, errorCase.error_ref, `${errorWhere}.error_ref`, BUSINESS_ERROR);
    // A resolving id is not enough: the error must be one the listed operation itself declares.
    const declaredBy = element === undefined ? undefined : errorOwners.get(errorCase.error_ref);
    if (owner !== undefined && declaredBy !== undefined && declaredBy !== owner.element_id)
      report.add(
        MAPPING_RULES.ownerMismatch,
        `${errorWhere}: the error belongs to ${declaredBy}, not to ${owner.element_id}`,
      );
  }
}

function checkOperations(
  report: MappingReport,
  index: ElementIndex,
  errorOwners: ReadonlyMap<string, string>,
  entry: AggregateMappingDraft,
  aggregate: Aggregate | undefined,
): void {
  const spelling = SPELLINGS[entry.code.language];
  const operationRefs = new Set<string>();
  const methods = new Set<string>();
  for (const operation of entry.operations) {
    const where = `${aggregateWhere(entry)}.operations[${operation.operation_ref}]`;
    if (operationRefs.has(operation.operation_ref))
      report.add(MAPPING_RULES.duplicate, `${where}: the operation is mapped more than once`);
    operationRefs.add(operation.operation_ref);
    const resolved = resolveOperation(report, index, operation.operation_ref, `${where}.operation_ref`);
    if (resolved !== undefined) {
      // Ownership is only comparable once the aggregate reference itself resolved.
      if (aggregate !== undefined && resolved.owner !== aggregate.element_id)
        report.add(
          MAPPING_RULES.ownerMismatch,
          `${where}: the operation belongs to ${resolved.owner}, not to ${aggregate.element_id}`,
        );
      const targetElement = resolved.kind === "factory"
        ? (index.byId(resolved.element_id)?.node as FactoryRule | undefined)?.target_element
        : aggregate?.root_element;
      // Distinct Domain Primitives each own parse; methods collide only on the same target type.
      const method = JSON.stringify([targetElement ?? entry.aggregate_ref, spelling.methodNamespace(resolved.kind), operation.code.method]);
      if (methods.has(method))
        report.add(
          MAPPING_RULES.duplicate,
          `${where}.code.method: ${operation.code.method} already performs another operation of this aggregate`,
        );
      methods.add(method);
    }
    checkErrorCases(report, index, errorOwners, operation, resolved, where);
  }
}

function missingOperations(entry: AggregateMappingDraft, aggregate: Aggregate): string[] {
  const missing: string[] = [];
  for (const operation of operationsOf(aggregate)) {
    const where = `${aggregateWhere(entry)}.operations[${operation.element_id}]`;
    const mapped = entry.operations.find((candidate) => candidate.operation_ref === operation.element_id);
    if (mapped === undefined) {
      missing.push(where);
      continue;
    }
    for (const domainError of operation.domain_errors) {
      if (!mapped.errors.some((candidate) => candidate.error_ref === domainError.element_id))
        missing.push(`${where}.errors[${domainError.element_id}]`);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function validateMapping(
  draft: MappingDraft,
  model: DomainModel,
  index: ElementIndex,
  files: ValidationFiles,
): MappingValidation {
  const document = new MappingReport(files.document);
  const names = new MappingReport(files.names);
  const declared = checkPackages(document, index, draft.domain_packages);
  checkPackageChains(document, draft, declared);

  const modelAggregates = new Map(
    model.bounded_contexts
      .flatMap((context) => context.aggregates)
      .map((aggregate) => [aggregate.element_id, aggregate]),
  );
  const errorOwners = new Map(
    [...[...modelAggregates.values()].flatMap(operationsOf), ...model.bounded_contexts.flatMap(bc => (bc.domain_services ?? []).flatMap(service => service.operations))]
      .flatMap((operation) =>
        operation.domain_errors.map((domainError) => [domainError.element_id, operation.element_id] as const),
      ),
  );

  const mapped = new Set<string>();
  const types = new Set<string>();
  const complete: AggregateMapping[] = [];
  const missing: string[] = [];
  for (const entry of draft.aggregate_mappings) {
    const where = aggregateWhere(entry);
    if (mapped.has(entry.aggregate_ref))
      document.add(MAPPING_RULES.duplicate, `${where}: the aggregate is mapped more than once`);
    mapped.add(entry.aggregate_ref);
    const resolved = resolveReference(document, index, entry.aggregate_ref, `${where}.aggregate_ref`, AGGREGATE);
    const aggregate = resolved === undefined ? undefined : modelAggregates.get(resolved.id.value);
    for (const ref of entry.reference_ids)
      resolveReference(document, index, ref, `${where}.reference_ids`, ANY_ELEMENT);
    for (const replay of entry.replay_methods)
      resolveReference(document, index, replay.event_ref, `${where}.replay_methods`, EVENT);
    if (!declared.has(locationKey(entry.code)))
      document.add(
        MAPPING_RULES.coverage,
        `${where}.code: no domain package is declared at ${describeLocation(entry.code)}`,
      );

    const { type } = entry.code;
    if (type === undefined) missing.push(`${where}.code.type`);
    else {
      const typeKey = JSON.stringify([locationKey(entry.code), type]);
      if (types.has(typeKey))
        names.add(
          MAPPING_RULES.duplicate,
          `${where}.code.type: ${type} at ${describeLocation(entry.code)} already implements another aggregate`,
        );
      types.add(typeKey);
      complete.push({ ...entry, code: { ...entry.code, type } });
    }
    checkOperations(names, index, errorOwners, entry, aggregate);
    if (aggregate !== undefined) missing.push(...missingOperations(entry, aggregate));
  }
  for (const id of modelAggregates.keys()) {
    if (!mapped.has(id)) document.add(MAPPING_RULES.coverage, `the model aggregate ${id} has no mapping`);
  }

  const services = new Map(model.bounded_contexts.flatMap(bc => (bc.domain_services ?? []).map(service => [service.element_id, service] as const)));
  const mappedServices = new Set<string>();
  const errorTypes = new Set<string>();
  for (const aggregate of draft.aggregate_mappings) for (const operation of aggregate.operations)
    errorTypes.add(JSON.stringify([aggregate.code.language, aggregate.code.package, aggregate.code.module, operation.code.error_type]));
  for (const entry of draft.service_mappings ?? []) {
    const where = `service_mappings[${entry.service_ref}]`;
    resolveReference(document, index, entry.service_ref, where, { kind: "service", label: "a domain service" });
    const service = services.get(entry.service_ref);
    if (mappedServices.has(entry.service_ref)) document.add(MAPPING_RULES.duplicate, `${where}: service is mapped more than once`);
    mappedServices.add(entry.service_ref);
    if (!declared.has(locationKey(entry.code))) document.add(MAPPING_RULES.coverage, `${where}: domain package is not declared`);
    const typeKey = JSON.stringify([locationKey(entry.code), entry.code.type]);
    if (types.has(typeKey)) document.add(MAPPING_RULES.duplicate, `${where}: type already implements another model owner`);
    types.add(typeKey);
    const methods = new Set<string>();
    const operations = new Set<string>();
    for (const operation of entry.operations) {
      const at = `${where}.operations[${operation.operation_ref}]`;
      const resolved = resolveOperation(document, index, operation.operation_ref, at);
      if (resolved && (resolved.kind !== "service-operation" || resolved.owner !== entry.service_ref)) document.add(MAPPING_RULES.ownerMismatch, `${at}: operation does not belong to this service`);
      if (operations.has(operation.operation_ref) || methods.has(operation.code.method)) document.add(MAPPING_RULES.duplicate, `${at}: operation or method is mapped more than once`);
      operations.add(operation.operation_ref);
      methods.add(operation.code.method);
      checkErrorCases(document, index, errorOwners, operation, resolved, at);
      const declaredOperation = service?.operations.find(x => x.element_id === operation.operation_ref);
      if (declaredOperation) {
        for (const error of declaredOperation.domain_errors) if (!operation.errors.some(x => x.error_ref === error.element_id)) missing.push(`${at}.errors[${error.element_id}]`);
        const actual = operation.inputs.map(x => x.input);
        const expected = declaredOperation.inputs.map(x => x.name);
        if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i]) || new Set(operation.inputs.map(x => x.parameter)).size !== expected.length)
          document.add(MAPPING_RULES.coverage, `${at}: inputs must bind every declared input exactly once in model order`);
      }
      const errorKey = JSON.stringify([entry.code.language, entry.code.package, entry.code.module, operation.code.error_type]);
      if (errorTypes.has(errorKey)) document.add(MAPPING_RULES.duplicate, `${at}: error type is shared with another operation`);
      errorTypes.add(errorKey);
    }
    if (service) for (const operation of service.operations) if (!operations.has(operation.element_id)) missing.push(`${where}.operations[${operation.element_id}]`);
  }
  for (const id of services.keys()) if (!mappedServices.has(id)) document.add(MAPPING_RULES.coverage, `the model service ${id} has no mapping`);

  const findings = [...document.findings, ...names.findings];
  if (missing.length > 0) return { complete: false, findings, missing };
  return { complete: true, findings, mapping: { ...draft, aggregate_mappings: complete } };
}
