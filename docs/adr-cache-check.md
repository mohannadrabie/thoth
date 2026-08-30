# ADR Cache — freshness model (reference)

The one canonical implementation is the reporter script `scripts/adr-cache.mjs` (copied into a project as `docs/adr-cache.mjs`). Every ADR-consuming agent and command runs it; **no agent parses ADRs or computes the fingerprint by hand** — the script does discovery, parsing, fingerprinting, and the build — so the hit/miss decision, the catalog, and the displayed saving can never drift apart.

## Modes

| Command | What it does |
|---------|--------------|
| `node docs/adr-cache.mjs` | Read-only status line + a machine tag `CACHE=HIT\|MISS\|NONE`. |
| `node docs/adr-cache.mjs --ensure` | **Build the catalog if it's stale/absent, then report.** Idempotent and safe from **any** command or agent — checks first, only writes when a rebuild is needed. This is what agents/commands run. |
| `node docs/adr-cache.mjs --build` | Force a rebuild now. |
| `node docs/adr-cache.mjs --fingerprint` | Print only the current ADR fingerprint. |

## The catalog

`docs/.maat-state.json → adrCatalog` is a **compressed, lossless index** of the ADRs:
- `version` — the ADR fingerprint (below).
- `adrs[]` — per ADR `{ id, title, status, path, applicableTo, rules }`: the domain tags and the **exact MUST/SHOULD rules kept verbatim**, NOT the prose. The full text stays in the file; `path` points back to it.
- Parses **both** the plugin's YAML frontmatter (`applicableTo`/`constraints`) **and** MADR markdown (`- **Tags:**` → `applicableTo`, `## Rules for agents` bullets → `rules`). Rules are never summarised, so nothing the model must obey is lossily compressed.

## The fingerprint

- A node-only content hash (sha1) over every ADR `.md` (path + bytes) under the configured `adr.dir` (defaults `./adr` + `docs/adr`), sorted by path. No `git`/`jq` needed.
- Any add / edit / remove of an ADR changes the hash → the cache invalidates automatically.
- No ADR files anywhere → `no-adr` (a valid, stable value, not an error).
- Self-consistent by construction (the same script writes and checks it), so it deliberately does **not** depend on `git hash-object` matching.

## The rule

| Tag | Meaning | Action |
|-----|---------|--------|
| `[CACHE=HIT]` | catalog current + populated | Reviewers **reuse** `adrCatalog.adrs` (filter by `applicableTo`, read the `rules`); no ADR bodies re-read. **One exception:** `cross-domain-reviewer` reads `adrCatalog.adrs` whole and unfiltered — no `applicableTo` slice — because its job is exactly the cross-domain seams a filtered read would hide. |
| `[CACHE=MISS]` | only from the read-only status mode | Run `--ensure` (or `--build`) to build it. Agents/commands already call `--ensure`, so they resolve this to HIT on the spot. |
| `[CACHE=NONE]` | no ADRs configured | Nothing to cache; reviewers state "no applicable ADRs". |

## Non-negotiable

- **Never hard-stop (`exit 1`) on a stale cache.** Stale means build, not halt.
- **`--ensure` writes only `adrCatalog`, atomically** (temp file + rename), preserving every other field of the state (tier, scope, …). Any agent or command may run it — building a derived index is not modifying the code under review, and the atomic write is safe even if parallel reviewers race. To avoid redundant parallel builds, the orchestrating command runs `--ensure` once before fanning out.
- If `docs/adr-cache.mjs` is absent (un-scaffolded project), agents fall back to reading ADR files directly. Deleting `docs/.maat-state.json` is a valid manual reset, never a *required* fix.

## Freshness is a hook, not agent discipline

A `SessionStart` hook (`hooks/hooks.json`) runs `node docs/session-brief.mjs`, which calls `node docs/adr-cache.mjs --ensure` first, at the start of **every** session in a scaffolded project — fails soft (no-op) if `docs/adr-cache.mjs` doesn't exist yet, and is bounded (10s inner timeout on the process, 15s on the hook itself) so a slow/unreachable submodule remote degrades the session start by a few seconds, not a stall. The hook fires regardless of which agent (or no agent) runs, so the catalog is always current for that session.

**Submodule freshness is opt-in and non-destructive.** `adr.autoSync` is **OFF by default**. With it off, `--ensure` (from the hook or any agent) does a purely local catalog/fingerprint build — no git, no network, so parallel reviewers can't race on the submodule and nothing dirties the working tree. With it **on**, `--ensure` first does `git fetch` + `git merge --ff-only` on the ADR submodule: it only *fast-forwards*, so unpushed local ADR commits are never orphaned (a diverged branch fails the FF and falls back to on-disk ADRs), and it's **skipped entirely when `$CI` is set** so headless/CI runs review against the pinned submodule SHA rather than drifting to origin tip. Even opted-in, advancing the submodule dirties the superproject tree — committing that pointer stays a deliberate human step. Leave autoSync off unless you specifically want every session to chase upstream ADRs; bumping the submodule pointer by hand is the reproducible default.

Every agent's own `--ensure` call (the per-agent "pre-flight ADR check" step) is additive on top of the hook, not a substitute — `--ensure` is idempotent, so the repeat call is a cheap no-op when the hook already ran. Note: the hook's `accessSync` check is relative to the session's working directory — an unscaffolded project and a scaffolded one opened from the wrong cwd both no-op identically; if `--ensure` never seems to run, check you're in the project root before assuming it isn't configured.
