Create tests per contract ID from the completion contract table and the requirement scenarios (gherkin) in the plan (`plan.md`).
Refer only to the reports in the Report Directory named in the Workflow Context and to the repository source, existing tests, and configuration needed to confirm the contracts. Do not search or read any other report directory.

**Important: do not create or modify production code. You may only create test files.**

**Mapping:**
- For each contract ID, turn the P (passing side) and N (rejecting side) requirement scenarios into tests, one test per scenario.
- For a contract row whose requirement scenario is 「対象外」 (out of scope), treat the 「成立する振る舞い」 (expected behavior) column as P and the 「拒否すべき誤実装」 (wrong implementation to reject) column as N, and map them one-to-one the same way.
- Do not write tests for concerns that are not in the contract table.
- Follow the testing-lite policy for placement and naming. If tests already exist, follow the file:line test pattern that the plan's implementation guidelines point to.
- Run the tests you created, and record failures caused by missing implementation separately from defects on the test side (configuration, fixtures, assertions).

{{include:instructions/requirement-scenario-test-mapping}}
