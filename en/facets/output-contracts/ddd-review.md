```markdown
# DDD Review

## Result: APPROVE / IMPROVE / REJECT

{{include:output-contracts/base-review-summary}}

## Reviewed Aspects
- [x] Domain model declaration (invariants, operations, errors, IDs, lineage)
- [x] Aggregate mapping and layer structure
- [x] Domain layer (construction, state changes, getters, Result errors, ownership)
- [x] Use-case layer (orchestration, re-execution, recovery)
- [x] Interface adapter layer (ports, repositories, restoration, CQRS sides)
- [x] Structure (dependency directions, package names, module layout)

{{include:output-contracts/base-review-new-findings-scope}}
| 1 | DDD-NEW-src-file-L42 | ddd-violation | In-scope | `src/file.ts:42` | Issue description, rule, and model ID | `src/file.ts:42` | Fix approach |

{{include:output-contracts/base-review-scope}}

{{include:output-contracts/base-review-persists}}
{{include:output-contracts/base-review-carry-over-findings}}
| 1 | DDD-PERSIST-src-file-L77 | ddd-violation | `src/file.ts:77` | `src/file.ts:77` | Still unresolved | Apply prior fix plan |

{{include:output-contracts/base-review-resolved-findings}}
| DDD-RESOLVED-src-file-L10 | `src/file.ts:10` now satisfies the rule |

{{include:output-contracts/base-review-adjudicated-out-of-scope}}
{{include:output-contracts/base-review-reopened-findings}}
| 1 | DDD-REOPENED-src-file-L55 | ddd-violation | Immediately preceding disposition: resolved | Reintroduced by the repair | `Recurred at src/file.ts:55` | Issue description | Fix approach |

{{include:output-contracts/base-review-non-finding-concerns}}

{{include:output-contracts/base-review-reopened}}
{{include:output-contracts/base-review-verification-evidence}}

{{include:output-contracts/base-review-rescan-evidence}}

## Rejection Gate
{{include:output-contracts/base-review-rejection-gate}}
{{include:output-contracts/base-review-rejection-gate-in-scope}}
- Findings without `finding_id` are invalid
```

**Cognitive load reduction rules:**
- APPROVE → Summary + Verification Evidence + Impact-Path Evidence. Omit everything else. Never omit Non-Finding Concerns when they have content
- REJECT → Include every verified finding row and aggregate locations with the same cause
{{include:output-contracts/base-review-adjudicated-out-of-scope-reporting}}
