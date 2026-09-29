function profileRoute(runtime, name) {
  const profile = runtime.provider?.profiles?.[name];
  return profile ? `${profile.provider}/${profile.model}` : undefined;
}

export function expectedPrimary(runtime, key) {
  const assignment = runtime.provider?.targets?.steps?.[key] ?? runtime.provider?.defaults;
  const names = assignment?.ladder ?? (assignment?.profile ? [assignment.profile] : []);
  return { names, models: names.map((name) => profileRoute(runtime, name)).filter(Boolean) };
}

export function nextFallback(config, attempted) {
  const chain = config.rate_limit_fallback?.switch_chain;
  if (!Array.isArray(chain)) return undefined;
  return chain.find((candidate) => !attempted.some((entry) => entry.provider === candidate.provider && entry.model === candidate.model));
}

export function checkStepRouting(events, runtime, config) {
  const state = new Map();
  const checks = [];
  for (const event of events) {
    const key = `${event.workflow}/${event.step}/${event.iteration ?? "?"}`;
    if (event.type === "step_start" && event.model) {
      const current = state.get(key) ?? { attempted: [], rateLimited: false };
      const actual = `${event.provider}/${event.model}`;
      const primary = expectedPrimary(runtime, `${event.workflow}/${event.step}`);
      let expected = primary.models;
      if (current.rateLimited) {
        const fallback = nextFallback(config, current.attempted);
        expected = fallback ? [`${fallback.provider}/${fallback.model}`] : [];
      }
      checks.push({ workflow: event.workflow, step: `${event.workflow}/${event.step}`, iteration: event.iteration, ok: expected.includes(actual), detail: `${actual} expected ${expected.join(" | ")}` });
      current.attempted.push({ provider: event.provider, model: event.model });
      current.rateLimited = false;
      state.set(key, current);
    } else if (event.type === "step_complete") {
      const current = state.get(key);
      if (current) current.rateLimited = event.status === "rate_limited";
    }
  }
  return checks;
}
