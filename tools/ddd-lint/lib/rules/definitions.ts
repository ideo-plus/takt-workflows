/**
 * Language-neutral rule definitions. The Rust evaluators in
 * rust/ implement these; a second language adds evaluators, not definitions.
 */

export type RuleLayer = "domain" | "use-case" | "interface-adapter" | "rmu";

export interface RuleDefinition {
  rule_id: string;
  name: string;
  statement: string;
  target_layers: RuleLayer[];
  requires_model: boolean;
  facts: string[];
  per_file: boolean;
}

export const RULES: readonly RuleDefinition[] = [
  { rule_id: "primary-constructor", name: "unique-primary-constructor", statement: "a domain type lacks one complete primary constructor, directly initializes elsewhere, or has cyclic/unconnected auxiliary construction paths", target_layers: ["domain"], requires_model: false, facts: ["constructors", "calls", "fields"], per_file: true },
  {
    rule_id: "factory-naming",
    name: "domain-factory-contract",
    statement: "a domain factory's of, parse, from, or try_from signature contradicts its value construction or conversion contract",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["methods", "domain-model", "aggregate-mapping"],
    per_file: true,
  },
  {
    rule_id: "event-sourcing-storage",
    name: "event-stream-in-memory-storage",
    statement: "an in-memory Event Sourcing repository stores aggregate state instead of event streams",
    target_layers: ["interface-adapter"],
    requires_model: true,
    facts: ["fields", "layer-structure", "aggregate-mapping"],
    per_file: true,
  },
  {
    rule_id: "repository-result-contract",
    name: "simple-repository-result",
    statement: "a repository wraps its Result without additional meaning, returns a persistence envelope, or uses a per-operation infrastructure error",
    target_layers: ["use-case"],
    requires_model: false,
    facts: ["traits", "aliases"],
    per_file: true,
  },
  {
    rule_id: "in-memory-restoration",
    name: "direct-in-memory-aggregate-storage",
    statement: "an in-memory state-sourcing repository reconstructs an aggregate instead of retaining its object",
    target_layers: ["interface-adapter"],
    requires_model: true,
    facts: ["calls", "layer-structure", "aggregate-mapping"],
    per_file: true,
  },
  {
    rule_id: "primitive-initialization",
    name: "invariant-based-primitive-initialization",
    statement: "a Domain Primitive lacks checked parse and panicking of, or initializes outside its invariant guard",
    target_layers: ["domain"],
    requires_model: true,
    facts: ["impls", "domain-model", "factory-initialization"],
    per_file: true,
  },
  {
    rule_id: "domain-packaging",
    name: "domain-package-vocabulary",
    statement: "affected domain crates use declared business packages rather than technical classifications",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["modules", "domain_packages", "cargo-targets"],
    per_file: false,
  },
  {
    rule_id: "a",
    name: "public-field",
    statement: "domain type exposes a non-private field",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["structs"],
    per_file: true,
  },
  {
    rule_id: "b",
    name: "undeclared-mutation",
    statement: "a mutating method of an aggregate root is not declared as a Command",
    target_layers: ["domain"],
    requires_model: true,
    facts: ["impls", "domain-symbols", "command-index"],
    per_file: true,
  },
  {
    rule_id: "operation",
    name: "mapped-operation-signature",
    statement: "a mapped operation is missing, a command does not take &mut self, or its Result differs from the mapping",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["impls", "aggregate-mapping"],
    per_file: true,
  },
  {
    rule_id: "in-place",
    name: "in-place-change",
    statement: "a domain method changes an external &mut argument or returns a changed copy instead of changing the value in place through &mut self",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["impls"],
    per_file: true,
  },
  {
    rule_id: "collection",
    name: "first-class-collection",
    statement: "a domain type holds a bare collection beside other state instead of a first-class collection type",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["structs"],
    per_file: true,
  },
  {
    rule_id: "port-placement",
    name: "use-case-port",
    statement: "a repository port is declared in the domain layer instead of the use-case layer",
    target_layers: ["domain"],
    requires_model: false,
    facts: ["traits"],
    per_file: true,
  },
  {
    rule_id: "c",
    name: "incomplete-construction",
    statement: "domain type is constructed outside the full constructor",
    target_layers: ["domain"],
    requires_model: true,
    facts: ["impls", "constructions", "domain-symbols"],
    per_file: true,
  },
  {
    rule_id: "d",
    name: "getter-call",
    statement: "domain getter call outside proven use-case repository argument forwarding",
    target_layers: ["domain", "use-case"],
    requires_model: false,
    facts: ["calls", "domain-symbols"],
    per_file: true,
  },
  {
    rule_id: "g",
    name: "dip-violation",
    statement: "forbidden dependency direction or external I/O dependency",
    target_layers: ["domain", "use-case", "interface-adapter", "rmu"],
    requires_model: false,
    facts: ["uses", "cargo-dependencies", "layer-assignment"],
    per_file: false,
  },
  {
    rule_id: "h",
    name: "execute-aggregate-arg",
    statement: "execute receives an aggregate directly",
    target_layers: ["use-case"],
    requires_model: true,
    facts: ["impls", "fns", "domain-symbols"],
    per_file: true,
  },
  {
    rule_id: "use-case-name",
    name: "use-case-suffix",
    statement: "a use case type (the type whose method is execute) is not named <Verb><Object>UseCase",
    target_layers: ["use-case"],
    requires_model: false,
    facts: ["impls"],
    per_file: true,
  },
  {
    rule_id: "repository-result",
    name: "fallible-repository-port",
    statement: "a method of a repository port does not return Result, so a failed load or store cannot reach the use case",
    target_layers: ["use-case"],
    requires_model: false,
    facts: ["traits"],
    per_file: true,
  },
  {
    rule_id: "repository-mut-self",
    name: "repository-write-receiver",
    statement: "a Rust repository port method that changes what is stored (store…, delete…) does not take &mut self, and the port is not declared Sync for sharing across threads",
    target_layers: ["use-case"],
    requires_model: false,
    facts: ["traits"],
    per_file: true,
  },
  {
    rule_id: "i",
    name: "use-case-chaining",
    statement: "use case calls another use case",
    target_layers: ["use-case"],
    requires_model: false,
    facts: ["calls"],
    per_file: true,
  },
  {
    rule_id: "k",
    name: "cross-side-reference",
    statement: "command side references query side (or the reverse)",
    target_layers: ["interface-adapter", "rmu", "use-case", "domain"],
    requires_model: false,
    facts: ["uses", "cargo-dependencies", "layer-assignment"],
    per_file: false,
  },
  {
    rule_id: "l",
    name: "query-side-domain-reference",
    statement: "query side references a domain type or repository port",
    target_layers: ["interface-adapter", "rmu", "use-case"],
    requires_model: false,
    facts: ["uses", "structs", "impls", "domain-symbols"],
    per_file: true,
  },
  {
    rule_id: "m",
    name: "repository-naming",
    statement: "repository port or type is misnamed or names a storage medium",
    target_layers: ["interface-adapter", "rmu"],
    requires_model: false,
    facts: ["structs"],
    per_file: true,
  },
  {
    rule_id: "n",
    name: "restoration-bypass",
    statement: "adapter constructs a domain type outside a full constructor",
    target_layers: ["interface-adapter", "rmu"],
    requires_model: false,
    facts: ["constructions", "impls", "domain-symbols"],
    per_file: true,
  },
];

const BY_ID = new Map(RULES.map((rule) => [rule.rule_id, rule]));

export function ruleDefinition(ruleId: string): RuleDefinition | undefined {
  return BY_ID.get(ruleId);
}

export function rulesFor(ruleIds: readonly string[]): RuleDefinition[] {
  return ruleIds.map((id) => BY_ID.get(id)).filter((rule): rule is RuleDefinition => rule !== undefined);
}
