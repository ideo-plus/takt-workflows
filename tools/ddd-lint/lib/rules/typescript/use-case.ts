/**
 * TypeScript rule evaluators of the use-case gate: an aggregate handed to `execute` (h) and one use
 * case calling another (i), each in the words the Rust use-case gate reports them in. Getter calls
 * (d) are in `evaluators.ts` and the dependency direction (g) in `edges.ts`; what these rules read
 * off a file's facts is in `file-facts.ts` and the binding to a model aggregate in `aggregate-binding.ts`.
 *
 * Nothing here infers a type. A parameter type or a receiver is what a declaration, an import or an
 * annotation spells, and what those do not decide is left undecided rather than passed.
 */

import { join } from "node:path";
import type { FindingInput } from "../../shared/findings.ts";
import { isAggregateStateElement } from "../in-memory.ts";
import { repositoryContractProblem, resultArguments, expandGenericStoreResult, EVENT_SOURCING_STORE } from "../repository-contract.ts";
import type { MemberFact, ParamFact, TypeScriptFileFacts } from "../../typescript/domain-facts/index.ts";
import { aggregateBinding, aggregateMappings } from "./aggregate-binding.ts";
import { resolveSpecifier } from "./edges.ts";
import { enclosingClass, factsOf, receiverType } from "./file-facts.ts";
import { isNamedType, isPortDeclaration, passedType, resolveDeclaredType, resolveTypeName, typeNamesIn } from "./symbols.ts";
import type { TsDomainType, TsInspection, TsTarget } from "./types.ts";

// --- (h) execute aggregate argument --------------------------------------------------------------

/** One `execute` a use-case source declares: a method of a class, or a function at the top of the file. */
interface ExecuteDeclaration {
  readonly params: readonly ParamFact[];
  readonly line: number;
}

function executesOf(facts: TypeScriptFileFacts): ExecuteDeclaration[] {
  return facts.declarations.flatMap((declaration): ExecuteDeclaration[] => {
    if (declaration.kind === "function")
      return declaration.name === "execute"
        ? [{ params: declaration.params ?? [], line: declaration.span.start_line }]
        : [];
    if (declaration.kind !== "class") return [];
    return declaration.members
      .filter((member) => member.kind === "method" && member.name === "execute")
      .map((member) => ({ params: member.params ?? [], line: member.span.start_line }));
  });
}

function isAggregate(inspection: TsInspection, type: TsDomainType): boolean {
  return aggregateBinding(inspection, type).aggregate !== undefined;
}

/**
 * The aggregate a parameter hands to `execute`, the type as it is written once the wrappings that
 * hand the same type over are removed; undefined when it hands none. A parameter that states no type,
 * or states one that holds an aggregate in any other way, is left undecided.
 */
function passedAggregate(
  inspection: TsInspection,
  target: TsTarget,
  facts: TypeScriptFileFacts,
  param: ParamFact,
  line: number,
): string | undefined {
  if (param.type_text === undefined) {
    inspection.undecided.add(target.file, line, `execute parameter ${param.name} states no type`);
    return undefined;
  }
  const passed = passedType(param.type_text);
  if (isNamedType(passed)) {
    const resolved = resolveTypeName(inspection.packages, inspection.symbols, target.file, facts, passed);
    if (resolved.kind === "undecided") {
      inspection.undecided.add(target.file, line, `execute parameter ${param.name}: ${resolved.reason}`);
      return undefined;
    }
    return resolved.kind === "domain" && isAggregate(inspection, resolved.type) ? passed : undefined;
  }
  for (const name of typeNamesIn(passed)) {
    const resolved = resolveTypeName(inspection.packages, inspection.symbols, target.file, facts, name);
    if (resolved.kind === "undecided") {
      inspection.undecided.add(target.file, line, `execute parameter ${param.name}: ${resolved.reason}`);
      return undefined;
    }
    if (resolved.kind === "domain" && isAggregate(inspection, resolved.type)) {
      inspection.undecided.add(
        target.file,
        line,
        `execute parameter ${param.name}: the type ${passed} names the aggregate ${name} but is not one it hands over`,
      );
      return undefined;
    }
  }
  return undefined;
}

/**
 * An `execute` — a class method, static and abstract ones included, or a function at the top of the
 * file — whose parameter hands over an aggregate. Only decided when the model is available, as the
 * aggregates are the model's.
 */
export function ruleH(inspection: TsInspection, target: TsTarget): FindingInput[] {
  if (inspection.model.status !== "available") return [];
  const facts = factsOf(inspection, target.file);
  const findings: FindingInput[] = [];
  for (const execute of executesOf(facts))
    for (const param of execute.params) {
      const aggregate = passedAggregate(inspection, target, facts, param, execute.line);
      if (aggregate !== undefined)
        findings.push({
          rule_id: "h",
          file: target.file,
          message: `execute receives aggregate ${aggregate} directly; pass ids and value objects`,
          line: execute.line,
        });
    }
  return findings;
}

// --- (use-case-name) a use case type ends with UseCase ----------------------------------------------

/**
 * A class of a use-case source that declares `execute` is a use case, and its name ends with
 * `UseCase` (`IssueInvoiceUseCase`). A use case written as a function at the top of the file has no
 * type to name.
 */
export function ruleUseCaseName(inspection: TsInspection, target: TsTarget): FindingInput[] {
  return factsOf(inspection, target.file)
    .declarations.filter(
      (declaration) =>
        declaration.kind === "class" &&
        !declaration.name.endsWith("UseCase") &&
        declaration.members.some((member) => member.kind === "method" && member.name === "execute"),
    )
    .map((declaration) => ({
      rule_id: "use-case-name",
      file: target.file,
      message: `use case ${declaration.name} is not named <Verb><Object>UseCase; name it ${declaration.name}UseCase`,
      line: declaration.span.start_line,
    }));
}

// --- (repository-result) a repository port reports its failures --------------------------------

/** The return type a callable member of a port states: a method signature's, or an arrow-typed property's. */
function statedReturn(member: MemberFact): string | undefined | null {
  if (member.kind === "method") return member.return_type_text;
  if (member.kind !== "property" || member.type_text === undefined) return null;
  let depth = 0;
  const text = unparenthesized(member.type_text);
  for (let index = 0; index < text.length - 1; index += 1) {
    const char = text[index];
    if (char === "(" || char === "<" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]" || (char === ">" && text[index - 1] !== "=")) depth -= 1;
    else if (depth === 0 && char === "=" && text[index + 1] === ">") return text.slice(index + 2).trim();
  }
  return null;
}

/** `text` less the parentheses that enclose it as a whole: `(Result<…>)` states `Result<…>`. */
function unparenthesized(text: string): string {
  let current = text.trim();
  while (current.startsWith("(") && current.endsWith(")")) {
    let depth = 0;
    for (let index = 0; index < current.length - 1; index += 1) {
      if (current[index] === "(") depth += 1;
      else if (current[index] === ")") depth -= 1;
      if (depth === 0) return current;
    }
    current = current.slice(1, -1).trim();
  }
  return current;
}

/** The members of the union `text` states outside any bracket, or `text` alone. */
function unionMembers(text: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "<" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]" || (char === ">" && text[index - 1] !== "=")) depth -= 1;
    else if (depth === 0 && char === "|") {
      members.push(text.slice(start, index));
      start = index + 1;
    }
  }
  members.push(text.slice(start));
  return members.map((member) => member.trim()).filter((member) => member.length > 0);
}

/**
 * Whether a stated return type is `Result<…>`, or a union of nothing else. A member such as
 * `undefined` beside it is a way to return without reporting the failure.
 */
function statesResult(returned: string): boolean {
  const members = unionMembers(unparenthesized(returned));
  return members.length > 0 && members.every((member) => /^(?:[\w$]+\.)*Result\s*</.test(unparenthesized(member)));
}

/**
 * Every method of a repository port — an interface, or a type literal alias, named `…Repository` —
 * returns `Result<…>`. Loading and storing reach outside the process and can fail, and a port whose
 * `store` returns `void` leaves the use case no way to see that the state it changed was never kept.
 */
export function ruleRepositoryResult(inspection: TsInspection, target: TsTarget): FindingInput[] {
  const facts = factsOf(inspection, target.file);
  return facts.declarations.flatMap((declaration) => {
    if (!isPortDeclaration(declaration) || !declaration.name.endsWith("Repository")) return [];
    return declaration.members.flatMap((member): FindingInput[] => {
      const stated = statedReturn(member);
      const returned = stated === null ? null : expandGenericStoreResult(stated, facts.declarations);
      if (returned === null || (returned !== undefined && statesResult(returned))) return [];
      return [
        {
          rule_id: "repository-result",
          file: target.file,
          message: `repository port method ${declaration.name}.${member.name} returns ${returned ?? "nothing it states"}; return Result<…, RepositoryError> so the use case sees a failed load or store`,
          line: member.span.start_line,
        },
      ];
    });
  });
}

export function ruleRepositoryContract(inspection: TsInspection, target: TsTarget): FindingInput[] {
  const facts = factsOf(inspection, target.file);
  const ports = facts.declarations.filter((entry) => isPortDeclaration(entry) && entry.name.endsWith("Repository"));
  if (!ports.length) return [];
  const findings: FindingInput[] = [];
  for (const port of ports) {
    const aggregate = port.name.slice(0, -"Repository".length);
    for (const member of port.members) {
      const returned = statedReturn(member);
      if (returned === null) continue;
      const problem = repositoryContractProblem(member.name, expandGenericStoreResult(returned, facts.declarations), aggregate, "typescript");
      if (problem) findings.push({ rule_id: "repository-result-contract", file: target.file, line: member.span.start_line, message: `${port.name}.${member.name}: ${problem}` });
    }
  }
  for (const alias of facts.declarations.filter((entry) => entry.kind === "type-alias" && !entry.generic)) {
    const parts = resultArguments(alias.type_text);
    if (parts && parts[1] === "RepositoryError") findings.push({ rule_id: "repository-result-contract", file: target.file, line: alias.span.start_line, message: `${alias.name} only renames a repository Result; use Result directly or a reusable generic alias` });
  }
  return findings;
}

/**
 * An Event Sourcing repository port stores the domain event with the aggregate after it,
 * `store(event, snapshot)`: the event already carries its aggregate ID, and the snapshot lets
 * findById replay only the events after it. The event is a single named type imported from the
 * aggregate's domain package that is neither the aggregate nor one of its state elements.
 */
export function ruleEventSourcingStore(inspection: TsInspection, target: TsTarget): FindingInput[] {
  const facts = factsOf(inspection, target.file);
  const findings: FindingInput[] = [];
  for (const port of facts.declarations.filter((entry) => isPortDeclaration(entry) && entry.name.endsWith("Repository"))) {
    const aggregate = aggregateMappings(inspection).find((entry) => entry.persistence_method === "event-sourcing" && `${entry.type}Repository` === port.name);
    if (!aggregate) continue;
    const domainType = (text: string | undefined) => {
      if (text === undefined) return undefined;
      const resolved = resolveTypeName(inspection.packages, inspection.symbols, target.file, facts, text);
      return resolved.kind === "domain" ? resolved.type : undefined;
    };
    const isSnapshot = (text: string | undefined) => {
      const type = domainType(text);
      return type !== undefined && type.name === aggregate.type && type.pkg.name === aggregate.package;
    };
    const isEvent = (text: string | undefined) => {
      if (text === undefined || !/^[\w$]+(?:\.[\w$]+)*$/.test(text)) return false;
      const type = domainType(text);
      if (type && (type.name === aggregate.type || isAggregateStateElement(inspection.model, aggregate.aggregate_ref, type.name))) return false;
      const imported = facts.imports.find((entry) => entry.bindings.some((binding) => binding.name === text.split(".")[0]));
      const from = imported ? resolveSpecifier(inspection.packages, target.pkg, join(inspection.packages.workspaceRoot, target.file), imported.specifier) : undefined;
      return from?.kind === "package" && from.pkg.name === aggregate.package;
    };
    for (const member of port.members.filter((entry) => entry.name === "store")) {
      const params = member.params ?? [];
      if (params.length === 2 && isEvent(params[0]!.type_text) && isSnapshot(params[1]!.type_text)) continue;
      const spelled = params.map((param) => `${param.name}: ${param.type_text ?? "?"}`).join(", ");
      findings.push({ rule_id: "event-sourcing-store", file: target.file, line: member.span.start_line, message: `${port.name}.store(${spelled}): ${EVENT_SOURCING_STORE}` });
    }
  }
  return findings;
}

// --- (i) use case chaining -----------------------------------------------------------------------

/**
 * A call of `execute` on a use case of the use-case layer: a class that declares `execute`, reached
 * through a receiver stated to be it. A call on `this`, on a value of the calling class itself, or
 * on an interface — a port — is not one. A function `execute` called by name is none when the file
 * declares it as a function; otherwise — an import, or a class or variable of that name — which
 * function it calls is not decided here, so it is left undecided, as is a receiver whose type is not
 * stated.
 */
export function ruleI(inspection: TsInspection, target: TsTarget): FindingInput[] {
  const facts = factsOf(inspection, target.file);
  const findings: FindingInput[] = [];
  for (const call of facts.calls) {
    if (call.callee_text !== "execute") continue;
    const line = call.span.start_line;
    if (call.kind === "function-call") {
      // Only a function declaration of the file is known to be the one called; a class or a variable
      // of the same name (an arrow function among them) is not decided to be a function here.
      if (!facts.declarations.some((declaration) => declaration.name === "execute" && declaration.kind === "function"))
        inspection.undecided.add(target.file, line, "execute called by name, not declared as a function in this file");
      continue;
    }
    if (call.kind !== "method-call" || (call.receiver_text ?? "").trim() === "this") continue;
    const stated = receiverType(facts, call);
    if (stated === undefined) {
      inspection.undecided.add(target.file, line, `execute called on ${call.receiver_text}, whose type is not stated`);
      continue;
    }
    const resolved = resolveDeclaredType(inspection.packages, inspection.declarations, target.file, facts, stated);
    if (resolved.kind === "undecided") {
      inspection.undecided.add(target.file, line, `execute receiver: ${resolved.reason}`);
      continue;
    }
    if (resolved.kind !== "found") continue;
    const called = resolved.entry;
    const caller = enclosingClass(facts, call);
    if (called.file === target.file && caller?.name === called.declaration.name) continue;
    if (
      called.pkg.assignment.layer === "use-case" &&
      called.declaration.kind === "class" &&
      called.declaration.members.some((member) => member.kind === "method" && member.name === "execute")
    )
      findings.push({
        rule_id: "i",
        file: target.file,
        message: `use case calls ${called.file}#${called.declaration.name}.execute`,
        line,
      });
  }
  return findings;
}
