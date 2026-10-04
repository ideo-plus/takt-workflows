export interface ConstructorPath {
  readonly file: string;
  readonly key: string;
  readonly name: string;
  readonly line: number;
  readonly targets: readonly string[];
}

/** One terminal initializes state; auxiliary construction paths must reach it without cycles. */
export function constructorPathProblems(paths: readonly ConstructorPath[], primary: string): readonly { readonly path: ConstructorPath; readonly message: string }[] {
  const byKey = new Map(paths.map((path) => [path.key, path]));
  const reaches = (key: string, visiting: ReadonlySet<string>): boolean => {
    if (key === primary) return true;
    if (visiting.has(key)) return false;
    const path = byKey.get(key);
    if (!path) return false;
    const next = new Set([...visiting, key]);
    return path.targets.length > 0 && path.targets.every((target) => reaches(target, next));
  };
  const cycles = (key: string, visiting: ReadonlySet<string>): boolean => {
    if (visiting.has(key)) return true;
    const path = byKey.get(key);
    if (!path) return false;
    return path.targets.some((target) => cycles(target, new Set([...visiting, key])));
  };
  return paths.flatMap((path) => {
    if (cycles(path.key, new Set())) return [{ path, message: "constructor delegation contains a cycle" }];
    if (!reaches(path.key, new Set())) return [{ path, message: "auxiliary constructor does not reach the unique primary constructor" }];
    return [];
  });
}
