{extends:scenario-based-write-tests-first}

## Test Model Usage and Counterexamples

- Read the plan and the declarations under `docs/ddd/`. Relate the changed business operations and invariants to model element IDs. Preserve existing completion contracts and report formats.
- Write client examples in business language. Exercise behavior through public domain operations; type or layout fidelity alone is not success evidence. Within the change's scope, test rejected inputs and operation sequences and verify that rejection leaves state unchanged.
- Distinguish immediate Aggregate invariants from eventual consistency across Aggregates. When changing the latter, test the planned intermediate states, retries, and compensation; do not treat compensation as an immediate guarantee.
- When changing Entity identity or Value equality, exercise identity-preserving operations or behavior when equal-attribute Values are replaced. Preserve the project's language and persistence choices.
- For a changed Domain Service, check business examples and counterexamples against the planned responsibility and model references. Where the public operation can be declared, use equivalent configuration and dependency conditions and exercise the same current inputs on separate instances and after unrelated invocations. Distinguish the input objects' current state from the Service's own history; absence of fields alone is not success evidence. If independent-operation declarations are unsupported, record the gap rather than inventing implementation or unsupported keys to make a test.
- If usage examples cannot be written naturally or the model cannot handle requirement counterexamples, record the evidence and affected elements in the report. Do not weaken tests to accommodate the current model. This step changes neither production code nor declarations; pass the discovery to the existing replanning decision.
