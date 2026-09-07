# T11 / OPS-03 latency-budget spike (renamed from v2's T11-timeout-budget spike; retargeted per the
council's split-budget model — this spike now feeds ONLY OPS-03's CI-regression-tested alarm, never
SUR-12's enforcement `timeout`, which is a fixed 60s value chosen without measurement — see
`hooks/pretooluse-kernel-gate.mjs`'s own header comment and `docs/decisions.md`'s S5 build-time row)

**Date:** 2026-09-06
**Run by:** `story-implementer` (Ptah), S5 Phase 2 build, per plan v3 §5.B / build-order step 4.
**Instrument:** `src/qa/gate-latency-budget-check.ts` (`REAL_SHELL_FORM_TIMER` + `measureLatency`).

## Methodology

- **Real subprocess, real shell layer, real script.** `spawnSync("node \"<path>\"", { shell: true,
  input: <PreToolUse JSON stdin> })` — `shell: true` routes through the platform's actual shell
  (cmd.exe on this session's Windows dev machine), the same invocation SHAPE Claude Code's own
  `command`-type hook entries use (a bare command string, not an argv array). Never in-process
  function timing — that would silently reintroduce the exact one-number-two-jobs collapse the
  council ruled structural (Issue #86).
- **Cold process per call.** Each of the 40 (later re-confirmed at 40/50) timed calls spawns a
  fresh `node` process from scratch — no process reuse, no warm cache across calls.
- **Corpus:** 4 representative shapes drawn from S4's own shipped fixture corpus
  (`src/policy/fixtures/normalizer-calls.ts`), covering the worst-case decision paths this
  component actually builds:
  1. `shellEquivalentDeleteCall` — a clean, fully-resolved kubectl call (baseline allow/deny path).
  2. `shellDepthCapExactCall` — 5 levels of `exec` wrapper nesting (SUR-09's depth cap, the deepest
     recursive-normalization path this component supports).
  3. `shellMultiTargetTwoRedirectsCall` — a multi-redirect command (`cat payload > a > b`), the
     "assembles 2+ targets, denies wholesale" path (Issue #82's fix).
  4. `shellAtHeredocMultiCommandCall` — a long, multi-line heredoc-wrapped construction.
  10 iterations per corpus entry (40 total measured calls in the recorded run below; a second,
  50-call run across a slightly different 5-command set in this session's own scratch exploration
  produced statistically indistinguishable numbers, not separately recorded here).
- **Machine:** this session's own Windows 11 dev machine (`C:\playground\thoth`) — the ONLY target
  machine available to this session. **Disclosed, not glossed over:** `.github/workflows/ci.yml`
  runs this repo's CI on `ubuntu-latest`, a different OS/process-spawn cost profile this session has
  no way to measure directly. The declared ceiling below is set with enough margin to absorb this
  gap (see "Chosen ceiling" below) rather than pretending Linux numbers were measured.

## Raw result (this session's `node src/qa/gate-latency-budget-check.ts` run)

```
iterations=40 min=115.87ms p50=123.97ms p95=144.21ms p99=145.32ms max=145.32ms ceiling=2000ms
```

An earlier, separate 50-call exploratory run (5 slightly different representative commands, 10
iterations each, same methodology) measured: min=109.76ms, p50=117.56ms, p95=133.08ms,
p99=133.59ms, max=133.74ms — consistent with the recorded run above (both comfortably inside a
110-150ms band on this machine).

## Declared OPS-03 ceiling: 2000ms (2 seconds)

Chosen per architecture-reviewer's council-seat guidance ("on the order of 1-2 seconds") — the top
of that band, deliberately, for two stated reasons:

1. **Cross-machine margin.** ~15x the measured p99 (145.32ms) on the one machine actually
   measurable this session — generous enough to very likely still hold on `ubuntu-latest`'s
   different process-spawn cost profile, without this spike ever having measured that profile
   directly (disclosed above, not assumed away).
2. **Still meaningfully protective.** A regression that pushes real p99 latency into the
   hundreds-of-milliseconds-to-seconds range (e.g. a future normalizer change with pathological
   backtracking, or an accidental synchronous network/file-I/O call introduced into the hot path)
   still trips this alarm and fails CI (a CI-10 incident) long before it would ever approach the
   SEPARATE, unrelated 60-second enforcement `timeout` in `.claude/settings.json`.

**Never derived from, and never checked against, SUR-12's fixed 60s enforcement `timeout`** —
the council's split-budget model's whole point. See `hooks/pretooluse-kernel-gate.mjs`'s own header
comment for that value's own, entirely separate justification.

## Where this number lives going forward

- `src/qa/gate-latency-budget-check.ts`'s own `OPS03_CEILING_MS` constant (2000).
- Wired as `npm run qa:gate-latency-budget`, CI-gated in `.github/workflows/ci.yml`.
- An overrun is a CI-10 incident per REQUIREMENTS.md:468's own text ("a timeout occurrence is an
  incident under CI-10, not a routine event") — a red build, a human investigates; never a silent
  or automatic change to this ceiling or to the unrelated enforcement `timeout`.
