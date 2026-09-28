/**
 * checkCompleteness — the rules that never fail the load.
 *
 * The model checks call this after a
 * successful `loadDomainModel`, then decide whether a finding blocks the gate
 * based on their own manifest severity.
 */

import type { FindingInput } from "../shared/findings.ts";
import type { DomainModel } from "./model.ts";

export function checkCompleteness(model: DomainModel, file = "docs/ddd/domain-model.yaml"): FindingInput[] {
  const findings: FindingInput[] = [];
  for (const bc of model.bounded_contexts) {
    for (const aggregate of bc.aggregates) {
      // (i) every Aggregate has at least one Invariant
      if (aggregate.invariants.length === 0) {
        findings.push({
          rule_id: "completeness.i",
          file,
          message: `aggregate ${aggregate.element_id} has no invariant`,
        });
      }
      for (const command of aggregate.commands) {
        // (ii) state_effect agrees with transitions
        if (command.state_effect === "transitions" && command.transitions.length === 0) {
          findings.push({
            rule_id: "completeness.ii",
            file,
            message: `command ${command.element_id} declares state_effect transitions but lists none`,
          });
        }
        if (command.state_effect === "none" && command.transitions.length > 0) {
          findings.push({
            rule_id: "completeness.ii",
            file,
            message: `command ${command.element_id} declares state_effect none but lists transitions`,
          });
        }
        // (j) accumulation requires command-id-memory
        if (command.effect === "accumulation" && command.idempotency.strategy === "none") {
          findings.push({
            rule_id: "idempotency.j",
            file,
            message: `accumulation command ${command.element_id} must use idempotency.strategy command-id-memory`,
          });
        }
      }
    }
  }
  return findings;
}
