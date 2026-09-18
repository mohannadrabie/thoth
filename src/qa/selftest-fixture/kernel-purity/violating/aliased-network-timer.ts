// Self-test fixture (AST layer, VIOLATING — Issue #63 Q1 Manager ruling, 2026-09-17): the
// alias-tracking set was extended to fetch/setTimeout/setInterval/require alongside
// globalThis/global/Reflect/eval/Function, closing the same-shaped gap for ADR-0021 POL-11's own
// named forbidden categories (network, timer, process-spawning). Each is aliased to a local
// variable, then reached via a property access on the alias — proving the AST layer's alias
// tracking now covers these four roots too. A direct BARE CALL through an alias with no property
// access on it (e.g. `const f = fetch; f(url)`) is a disclosed residual of this layer (see the
// header comment in kernel-purity-check.ts) and is intentionally NOT exercised here. See
// kernel-purity-check.test.ts.
export function aliasedFetchViaBind(): unknown {
  const f = fetch;
  return f.bind(null);
}

export function aliasedSetTimeoutViaName(): unknown {
  const t = setTimeout;
  return t.name;
}

export function aliasedSetIntervalViaName(): unknown {
  const i = setInterval;
  return i.name;
}

export function aliasedRequireResolve(): unknown {
  const req = require;
  return req.resolve;
}
