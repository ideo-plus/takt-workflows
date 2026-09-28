Focus on reviewing **domain-driven design**: the domain model declaration, the code's fidelity to it, the domain, use-case, and interface adapter layer rules, the package structure, and the language rules.
Do not assume another reviewer or step has already covered an issue. Detect any problem that belongs to this review perspective.

- Read `.ddd.toml` and the files under `docs/ddd/` as this change leaves them. Check the model elements, mapping rows, and layer structure entries the change adds or changes.
- For each changed domain, use-case, and interface adapter source, compare it with its mapping row: package, module path, type, methods of the mapped operations, error types and cases, replay methods, and restoration path.
- Check the module placement and package names of every package the change touches, including files the change did not edit but made unreachable or misplaced.
- Name the violated rule and the model ID or mapping entry involved in each finding.
- Do not read under `.takt/` other than the reports of this run: the DDD rules are in the policies and knowledge given to this step. This step is read-only and cannot run ddd-lint; take its result from the implementation report, where the coder records it, and review what ddd-lint does not check (the meaning of the model and the code).

{{include:instructions/review-path-check}}
{{include:instructions/review-investigation-discipline}}
