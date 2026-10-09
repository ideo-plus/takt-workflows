{extends:development-implement-with-reports}

## DDD model first

- Apply the `## DDD Model Changes` of the plan to `.ddd.toml` and the files under `docs/ddd/` before changing code, exactly as planned.
- Implement names exactly as the aggregate mapping states them: package, module path, type, method, error type, error cases, and replay methods. Place modules according to the layout selected in `.ddd.toml`.
- Preserve the planned Module grouping and each Aggregate boundary, including when several Aggregates share a Module. Do not split by type kind or mechanically add a Module per Aggregate.
- When the code needs a declaration the plan does not contain (an operation, an error case, a package, a module level), do not invent it in code. Report the missing declaration as a plan defect.
- If implementation reveals new business knowledge or awkward model usage, report examples or counterexamples, affected model elements, and alternatives through the existing replanning path. Declaration fidelity alone does not prove the model is sound; do not silently change declarations or requirements.
- When numeric initialization inspection fails, distinguish a missing rejection guard from an unverified conversion after validation. Record the input and storage types, expression, and bounds and compare them with supported forms. Do not repeat fixes that leave the same cause; pass a concrete unsupported form to replanning when necessary.
- For a changed Domain Service, check the plan's "Domain Service Decisions". Keep each object's own decisions on that object; retain no business state or invocation history in the Service, and delegate no loading, persistence, or external communication to it. A plan record does not replace an operation declaration. Report a necessary declaration that cannot be expressed as a contract gap and pass it to replanning.
- Do not read under `.takt/` except the quality gate output log a failed gate names: the DDD rules are in the policies and knowledge given to this step. Check the code by running `bun .takt/tools/ddd-lint/ddd-lint.ts --project .`, not by reading its sources.
