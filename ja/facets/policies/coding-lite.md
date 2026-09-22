# Coding policy (lite)

Prefer care over speed, and correct code over easy implementation.

## Keep the change minimal

- Boy scout rule: improve only the problems that this change depends on, spreads, or newly exposes.
- Minimal does not mean few lines. It means the direct diff that satisfies the requirement and the safety conditions that actually exist. Do not add structure only for future flexibility or quality metrics, but never skip validation at a changed trust boundary, authorization, cleanup, or error handling.
- Changing only a contract definition without updating its callers, producers, and readers is REJECT. Change the contract, its callers and producers, and the tests in the same change.
- **Unused code** - do not write code "just in case".
- **Unfinished code** - do not defer required logic with TODO/FIXME, and do not leave empty implementations or commented-out old code.
- **Leftovers after refactoring** - delete the code and exports you replaced.
- **Missing wiring** - a new parameter or field whose producer, propagation, and consumer do not share the same contract is not allowed.

## Naming

A name describes the actual role and effect, not the implementation mechanism. Code whose names make the reader misjudge behavior, responsibility, or side effects is bad code.

| Pattern | Example | Verdict |
|---------|---------|---------|
| Name contradicts the actual effect | Reads as if it has a side effect every call, but actually returns a cached value | REJECT |
| Side effects or frequency cannot be read | Cannot tell from the name whether it initializes, fetches, or updates | REJECT |
| Indistinguishable from a nearby API | Same name as what it wraps or delegates to, so the responsibility is unclear | REJECT |
| Named by role and effect | The value provided, the state change, and the responsibility are clear from the name | OK |
| Contradicts the existing naming convention | One item in a family of similar operations follows a different naming rule | REJECT. Align it |

## Error handling

Do not write code that obscures the flow of values. Propagate errors upward.

| Pattern | Example | Problem |
|---------|---------|---------|
| Fallback for required data | `user?.id ?? 'unknown'` | Processing continues in a state that should be an error |
| try-catch returning an empty value | `catch { return ''; }` | Swallows the error |
| Silently skipping an inconsistent value | `if (a !== expected) return undefined` | A configuration mistake is ignored at runtime without a trace |

Concentrate error translation for one external contract at the boundary that owns that contract.

| Layer | Responsibility |
|-------|----------------|
| Domain / service layer | Throw on business rule violations |
| Application layer | Do not swallow exceptions; handle only the compensation or retry that is explicitly needed |
| Adapter boundary | Translate exceptions into protocol-specific responses or presentation |
