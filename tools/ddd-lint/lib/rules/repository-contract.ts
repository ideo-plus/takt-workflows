/** Why an Event Sourcing repository port's store takes the event and the aggregate after it. */
export const EVENT_SOURCING_STORE =
  "store takes the domain event, which carries its aggregate ID, and the aggregate after that event as the snapshot: store(event, snapshot), so findById replays only the events after the latest snapshot";

/** Why a repository implementation exposes nothing but its port. */
export const ADAPTER_SURFACE =
  "a repository implementation exposes only its port and its constructors; observe it through the port (findById) rather than an extra accessor";

/** Explicit Result spellings only; no inference or alias expansion. */
export function resultArguments(
  text: string | undefined,
): readonly [string, string] | undefined {
  if (!text) return undefined;
  const value = text.replace(/\s+/g, "");
  const match = /^(?:::)?(?:[\w$]+(?:::|\.))*Result<(.*)>$/.exec(value);
  if (!match) return undefined;
  let depth = 0;
  for (let i = 0; i < match[1].length; i++) {
    const char = match[1][i];
    if ("<([{".includes(char)) depth++;
    else if (">)]}".includes(char)) depth--;
    else if (char === "," && depth === 0)
      return [match[1].slice(0, i), match[1].slice(i + 1)];
  }
  return undefined;
}

/** A locally stated generic StoreResult<E> = Result<void/(), E> is an explicit reusable shape. */
export function expandGenericStoreResult(
  text: string | undefined,
  aliases: readonly {
    readonly name: string;
    readonly type_text?: string;
    readonly generic?: boolean;
  }[],
): string | undefined {
  if (!text || resultArguments(text)) return text;
  const match = /^([\w$]+)<([^<>]+)>$/.exec(text.replace(/\s+/g, ""));
  if (!match) return text;
  const alias = aliases.find(
    (entry) => entry.name === match[1] && entry.generic,
  );
  const parts = resultArguments(alias?.type_text);
  if (
    !parts ||
    !["void", "()"].includes(parts[0]) ||
    !/^[\w$]+$/.test(parts[1]) ||
    parts[1] === "RepositoryError"
  )
    return text;
  return `Result<${parts[0]},${match[2]}>`;
}

export function repositoryContractProblem(
  method: string,
  returned: string | undefined,
  aggregate: string,
  language: "rust" | "typescript",
): string | undefined {
  const parts = resultArguments(returned);
  if (!parts) return undefined; // The existing repository-result rule reports non-Result returns.
  const [success, error] = parts;
  if (method === "loadEvents" || method === "load_events")
    return "the repository returns the replayed aggregate; keep event-history loading inside the adapter and expose findById/find_by_id";
  if (!/^(?:::)?(?:[\w$]+(?:::|\.))*RepositoryError$/.test(error))
    return "use the common RepositoryError as the Result error";
  if (method === "store" && success !== (language === "rust" ? "()" : "void"))
    return "store returns no payload; use Result<void, RepositoryError> (Rust: Result<(), RepositoryError>)";
  const loadedAggregate =
    language === "rust"
      ? success === `Option<${aggregate}>`
      : success.split("|").sort().join("|") ===
        [aggregate, "undefined"].sort().join("|");
  if ((method === "findById" || method === "find_by_id") && !loadedAggregate)
    return `load the aggregate directly; use ${language === "rust" ? `Result<Option<${aggregate}>, RepositoryError>` : `Result<${aggregate} | undefined, RepositoryError>`}`;
  return undefined;
}
