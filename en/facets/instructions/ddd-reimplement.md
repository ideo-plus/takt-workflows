{extends:development-reimplement-with-reports}

## DDD model first

- Apply the `## DDD Model Changes` of the plan to `.ddd.toml` and the files under `docs/ddd/` before changing code, exactly as planned.
- Implement names exactly as the aggregate mapping states them: package, module path, type, method, error type, error cases, and replay methods. Place modules according to the layout selected in `.ddd.toml`.
- When the code needs a declaration the plan does not contain (an operation, an error case, a package, a module level), do not invent it in code. Report the missing declaration as a plan defect.
