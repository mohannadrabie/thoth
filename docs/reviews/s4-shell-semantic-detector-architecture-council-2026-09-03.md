# S4 -- Shell-command semantic detector: architecture council seat (rule 16c)

**Trigger:** PRINCIPLES.md rule 16(c) -- 2 consecutive REWORK/no-go Stage-3 verdicts on the same
artifact (round 1: red-team no-go, app-security REWORK, cross-domain REWORK; round 2: red-team
no-go on Finding N1, cross-domain REWORK on the kernel seam), no intervening clean/conditional-clean
round. docs/.maat-state.json: "reviewRoundsSinceClean": 2.

**Seat and question.** This is not a third pass re-grading round 2's findings -- architecture-reviewer
already ran and cleared its own two owned findings (#77/#78) in
s4-shell-semantic-detector-architecture-reconfirm-2026-09-03.md. The council question is
structural: does this design's shape continue as-is into a round 3, or does the two-round pattern
mean the shape itself needs to change first?

**Inputs read:** round 1 -- s4-shell-semantic-detector-red-team/app-security/cross-domain/
architecture-2026-09-02.md; round 2 -- s4-shell-semantic-detector-red-team/
app-security-reconfirm/cross-domain/architecture-reconfirm-2026-09-03.md; docs/decisions.md's S4
rows (2026-09-02, four rulings); current code -- src/policy/normalizer/shell.ts,
shell-scanner.ts, flag-catalog.ts, wrapper-catalog.ts; src/policy/kernel/kernel.ts.

**ADR cache:** ADR cache HIT: reused 35 ADR(s) [adr/devops:12, adr/software-engineering:23] from
catalog -- approx 17300 tokens saved this pass (fp 83b2e3e) [CACHE=HIT]. Domain slice read (architecture /
design / coupling / cost / evolution / standards): SE ADR-0001 (process), ADR-0002 (layering),
ADR-0003 (SOLID), ADR-0006 (blast radius), ADR-0010 (quality gates), ADR-0016/0019/0020 (port
fidelity, not directly engaged this round), ADR-0021 (thoth-native architecture -- the operative one).

---

## Verdict table (review axes)

| Axis | Verdict | Evidence |
|---|---|---|
| 1. Fit | CONFORMS, with a scope caveat | SUR-06's acceptance text (one leading read-only call cannot disable evaluation of a later mutating one) is satisfied by either deny-wholesale or collect-all; the story chose collect-all, which does more than the text strictly requires -- not gold-plating in the classic sense (it looks like thoroughness), but see Finding 1 below for why more was the higher-risk pick here. |
| 2. Blast radius and coupling | VIOLATES, silently | kernel.ts's matchesTarget (S2-shipped, zero-diff, kernel.ts:121-127) was written and reviewed against a world where every ActionRecord.targets had length 1 or less. S4's normalizer-side change to emit length-N arrays is a real contract change on the kernel's input space that was never re-derived against; kernel.ts shares fate with every normalizer's target-collection choices from this point forward, and nothing enforces that coupling. Issue 82 (code-traced, already filed). |
| 3. Compliance | AMBIGUOUS on ADR-0021, VIOLATES on ADR-0006's spirit | ADR-0021's Action-record schema (targets: string array) permits N-element arrays -- the record shape conforms (confirmed independently by architecture-reconfirm and by my own trace of resolveKubectlShape, shell.ts:273-347 -- one return statement, no second record). But ADR-0021 nowhere specifies what a multi-element targets array means to a rule's matcher, so the kernel's OR-across-targets ALLOW semantics is an implicit decision (NOT-COVERED) that S2 made under a true assumption (single-target only) that S4 silently invalidated. ADR-0006 (must not widen a change's scope opportunistically) is not violated by the normalizer diff itself (cross-domain confirmed every new function traces to a named Issue) -- but the effect of that diff opportunistically widens the kernel's exposed behavior without a corresponding re-review of the kernel, which is the same failure mode in substance if not in the letter of the rule. |
| 4. Cost shape | CONFORMS | No unbounded variable. DEPTH_CAP = 5 is a named, bounded constant (design-challenger round 1, residual, not re-litigated here). Multi-resource collection is bounded by tokens in one invocation -- not a scaling concern. |
| 5. Operability | CONFORMS | Fail-closed is the uniform failure mode throughout (unresolved leads to POL-05 deny). The two round-2 regressions (N1, N2) both degrade visibly -- N1 to a silent wrong-allow (the concerning direction, see Finding 2) and N2 to a loud, correctly-denied-but-over-broad deny (the safe direction). The system is observable: npm test, qa:mutation-shell, and the QA gate suite all catch regressions mechanically, which is exactly how round 2 itself surfaced N1/N2 before merge rather than after. |

---

## Findings, ranked by blast radius

### 1. SUSPICION MED derived -- "Collect every resource token, report all as an array" was an unforced, higher-risk design choice for the multi-resource sub-case -- the Manager's own available precedent pointed the other way

**Answering question 1.** SUR-06's acceptance text governs compound/chained commands --
kubectl get ... followed by chain operator then kubectl delete ... -- a sequence of separate invocations joined by shell syntax. The
Manager's own 2026-09-02 ruling (docs/decisions.md) resolved that shape by detecting the chain
operator and denying wholesale via unresolved, explicitly choosing this over building new
multi-ActionRecord-per-invocation dispatch because it is a materially smaller, lower-risk build.

The shape kubectl delete pods/api secrets/db-creds --context=prod (Issue 73's shape) is a different
grammatical case -- one verb, one invocation, N resource arguments -- but it is the same underlying
risk category the Manager had just reasoned about: one ActionRecord potentially needing to speak
for actions against multiple distinct resources that may sit under different authorization postures.
Red-team's own named test for Finding 4 offered both branches as acceptable: reports every
resource in targets, OR reports unresolved. The or branch -- deny-wholesale, matching the
sibling precedent already chosen for chain operators in the same story, on the same day -- was never
taken. The collect-all branch was picked instead, and it is the branch that actually built new
multi-target evaluation surface, which is exactly the class of build the Manager had just ruled
against taking on for the sibling case.

This is not a violation of ADR-0021 (the schema allows it) and it is not gold-plating in the sense of
adding unrequested capability -- SUR-06's text is satisfied either way. It is a derived judgment
that a materially safer, cheaper, already-precedented option existed and was not the one taken, and
that the option taken is what produced both Issue 82 (a new authorization-bypass class in
previously-audited, zero-diff kernel code) and, more indirectly, enlarged the surface N1 lives on
(the redirect-exclusion logic in scanFlags exists because collectResources needed a way to keep
a real redirect target out of the resource array -- a problem that does not exist under a
deny-wholesale design, because there is no resource array to poison).

Verdict: NOT-COVERED as an explicit ruling (no ADR or decisions.md row states which of the two
SUR-06/Issue-73 branches the kernel is designed to safely receive) -- capped at MED per PRINCIPLES rule 19
since this is reasoning from documents, not a run or a code defect in isolation. It does not block by
itself. It is the structural finding underneath the two demonstrated bugs below.

---

### 2. ISSUE HIGH code-traced -- kernel.ts's OR-across-targets matchesTarget was never re-derived for a multi-target ActionRecord -- already filed, Issue 82

Answering question 2. Confirmed by my own trace, independent of cross-domain's:

    // kernel.ts:121-127
    function matchesTarget(rule, action) {
      const targets = rule.targets;
      if (!targets || targets.length === 0) return true;
      return action.targets.some((t) =>
        targets.some((pattern) => (pattern.endsWith("/") ? t.startsWith(pattern) : t === pattern)),
      );
    }

matchRules (kernel.ts:142-146) uses this identically for both deny and allow candidates, and
decide() (kernel.ts:167-195) picks the first matching deny, else the first matching allow. A
rule scoped to targets: prod/cluster/prod/pods/ matches an action whose targets array is
prod/.../pods/api and prod/.../secrets/db-creds -- the some() is satisfied by the first
element, and decide() grants allow for the whole action, with a verdict reason that names a
rule that was never written to authorize the secret. This is real, code-traced, and already the
subject of GitHub Issue 82 (filed by cross-domain-reviewer, severity high) -- I confirm it rather
than re-file it.

This finding is bigger than S4. matchesTarget is S2-shipped, zero-diff this round, and will
compose the same way with the next normalizer that ever emits more than one target -- it is not a
shell-specific defect. Treating it as S4's bug to fix quietly inside the normalizer undersells it;
treating it as fix kernel.ts right now, under a two-round-blown CRITICAL cycle oversells the
urgency of doing it well. See the recommendation below.

---

### 3. ISSUE HIGH code-traced -- N1: quoted greater-than-sign argument silently drops the next resource token -- already filed, Issue 80

Confirmed by my own trace: extractRedirectTargets (shell-scanner.ts:251-267) finds a live
redirect operator by POSITION, over quote-aware raw text (states at that index are checked to
skip anything inside a quoted span). scanFlags's exclusion (shell.ts:146-149) tests the tokenized
stream by VALUE (an exact string equality check against the token), after tokenize() has already
stripped quote delimiters -- so a quoted literal redirect-operator-shaped argument is
indistinguishable from a live operator at that point, and the following token is skipped from
positional along with it. The shipped comment at shell.ts:135-139 claims this fails
closed; it does only when the swallowed token was the only resource-shaped candidate, which is not
true the moment a second resource token exists (the exact shape kubectl delete pods/api PLUS a
quoted-literal-redirect-token PLUS secrets/db-creds --context=prod demonstrates). Root cause matches
Finding 1's diagnosis exactly: a narrower instance of "a token's value tells you its syntactic role,"
the same class red-team named as round 1's scariest assumption, now recurring at the boundary
collectResources created.

---

### 4. ISSUE MED code-traced -- N2: fd-dup ampersand idiom misread as a command separator -- already filed, Issue 81

Confirmed by trace of findLiveTrailingSensitiveSeparator (shell-scanner.ts:132-145): any live,
non-doubled, non-trailing ampersand is read as a separator, with no exclusion for the fd-dup idiom
(a numeric-then-redirect-then-ampersand shape). Fails closed (denies a benign, common construct
named as in-scope by REQUIREMENTS.md line 173) -- an adoption/precision defect, not a security one.
Same family as Finding 1's "table incompleteness" bugs from round 1 (missing entries in a
recognizer, not a new architectural gap) -- this one converges normally.

---

### 5. CLEAN code-traced -- ADR-0021's "exactly one Action record per call" holds structurally -- the bug is downstream of the record, not in its shape

Independently re-traced resolveKubectlShape (shell.ts:273-347): one return statement builds one
record; collectResources, buildResourceTargets and extractRedirectTargets are pure helpers that
return plain arrays consumed by that single return. resolveWrapperMatch's recursive delegation
(shell.ts:182-207) is untouched and orthogonal to the array-collection widening. This confirms
architecture-reconfirm's own finding independently. The record-shape question and the
kernel-consumption question (Finding 2) are genuinely separate properties -- the record is honest
about what it found; the kernel was never told the rules for consuming an honest multi-element
answer.

---

## NOT-COVERED and AMBIGUOUS items -- architect's work queue

1. What does an ALLOW rule mean against a multi-target ActionRecord? No ADR states whether
   matchesTarget's intended semantics for allow is "any one target satisfies" (current, unsafe
   for multi-resource) or "every target must be covered by some matching allow rule" (the fix
   cross-domain names). This needs a ruling before any future normalizer -- not just shell -- is
   trusted to emit a multi-target record intended to reach live rule evaluation. DENY staying
   the OR-based check is uncontroversial (fail-closed direction); ALLOW's arity is the open question.
2. Is "detect multi-target shape, deny wholesale" the standing rule for every SUR-06/07/08-class
   ambiguity going forward, or was chain-operator-deny a one-off? The Manager's chain-operator
   ruling and this council's Finding 1 both point toward "yes, standing rule" -- but nothing has
   written that down as a rule future stories can read, the way docs/decisions.md's POL-05
   fail-closed-on-unresolved precedent already is for the kernel side.

---

## Answering the four questions directly

1. Is "collect every resource, report as an array" the right invariant, or is it an unforced,
higher-risk choice? Unforced and higher-risk, for this specific sub-case. SUR-06's text does not
require full resolution -- it requires that a leading benign call cannot hide a later mutating one,
and "detect the shape, deny wholesale" satisfies that exactly as safely as chain-operator-deny
already does, at lower cost, with no new kernel-facing surface. ADR-0021's array-typed schema
permits collect-all; it does not require it, and the Manager's own same-day ruling on the sibling
case chose the cheaper path. This was the wrong branch of red-team's own named test to take.

2. Does kernel.ts need to change at all? Not for this story to ship safely. The durable, general
fix (require every target covered before allow) is real and correct, but it is a policy-engine
semantics decision with consequences for every future normalizer, not a shell-specific patch -- it
deserves its own freshly-scoped review, not a same-day amendment racing a blown CRITICAL cycle and
this story's own stated "zero diff to kernel.ts" invariant. The scoped, sufficient fix for S4 is
entirely at the normalizer boundary: collapse collectResources's multi-element targets output
back to the same "detect ambiguity, deny via unresolved" pattern already used for chain operators --
still collect every resource-shaped token (so nothing is silently dropped, keeping Issue 73's
under-reporting fix), but never place more than one resolved resource into a clean-resolving record's
targets; two or more denies the call. This closes Issue 82's exposure without touching kernel.ts,
consistent with the story's own commitment, and leaves the general kernel-arity question as a
recorded NOT-COVERED item for its own review cycle.

3. Is the two-round pattern itself evidence the shape keeps generating new attack surface, or two
independent bugs a third round closes cleanly? Both, in different halves of the same fix. N1 and N2
are normal convergence -- narrow, mechanically-testable descendants of round 1's "a shell command
is one command" completeness gaps (a value-vs-position bug, a missing fd-dup clause), each with a
one-line fix and a named test already written by the reviewers who found them. Nothing about them
argues for a different shape. The kernel seam (Issue 82) is not convergence in the same sense --
it is not a missing case in a recognizer table, it is a new architectural invariant (multi-target
records) meeting unaudited old code that was never designed for it. That is exactly the signal this
council seat exists to catch: a "collect more, don't discard" fix that was patched around instead of
re-derived from. The correct response is not "change the whole shape" (the parser-hardening axis is
healthy) -- it is "retire the one piece of the round-2 fix that reached past the normalizer boundary
without a matching audit of what it now touches," per question 2's answer above.

4. Candidate path ruling.

REWORK, narrowly scoped -- not a broad third hardening pass. Round 3's task is exactly three
items, each with an already-named failing test from an existing filed Issue:
- Fix N1 by switching scanFlags's redirect exclusion from token-value to token-position (using the
  offsets extractRedirectTargets already computes) -- closes Issue 80, and N3 (the cosmetic
  no-space-redirect pollution) as a side effect.
- Fix N2 with an fd-dup exclusion clause (an ampersand immediately preceded by a live redirect
  operator or a digit-plus-redirect is not a separator) -- closes Issue 81.
- Collapse collectResources's multi-element targets output to "two or more resolved resources
  leads to deny via unresolved," per Finding 1 and question 2 above -- closes Issue 82 without
  touching kernel.ts.

Plus one non-code action: record the NOT-COVERED items above (kernel ALLOW-arity semantics;
deny-wholesale as the standing pattern for SUR-06/07/08 ambiguity) as a docs/decisions.md ruling or
a proposed ADR, so the next story that ever emits a multi-target record inherits a real answer instead
of rediscovering this seam.

---

## Editorial

- shell.ts:15-16's "zero diff to either, or to kernel.ts/registry.ts" comment is accurate to what
  the diff-stat shows, but reads, unqualified, as if kernel.ts was checked for correctness against
  this round's new record shape -- it was not, until this council pass and cross-domain's. Worth a
  one-clause addition once round 3 lands, naming the reports that did audit it.

---

## Findings-to-tests reconciliation

Open findings: 3 ISSUE (all already filed as GitHub Issues 80, 81 and 82) plus 1
SUSPICION (Finding 1, a design-shape judgment with no executable test of its own -- it resolves to
the docs/decisions.md ruling named above, not a failing test). Named failing tests: 3, one per
ISSUE, already stated in the round-2 reports that found them (the red-team 2026-09-03 report for
Issue 80 and its own N2 entry for Issue 81; the cross-domain 2026-09-03 report for Issue 82). This
council report adds no new test obligation -- it rules on scope and shape, and narrows round 3's fix
for Issue 82 to the normalizer-side option.

---

RECEIPT: verdict=REWORK
findings (ALL of them, one terse line each, ranked by blast radius -- status [ISSUE]=VIOLATES / [SUSPICION]=NOT-COVERED or AMBIGUOUS / [CLEAN]=CONFORMS):
1. [ISSUE][HIGH][code-traced] kernel.ts:121-127 matchesTarget's OR-across-targets ALLOW semantics was never re-derived for S4's new multi-target ActionRecord - a narrowly-scoped allow rule authorizes an unrelated bundled resource; already filed as Issue 82 (cross-domain-reviewer), independently re-confirmed by my own code trace, not re-filed. Recommended scoped fix: normalizer-side collapse (see finding 3 in this receipt / Finding 1 in the body), not a kernel.ts change, for this story specifically.
2. [ISSUE][HIGH][code-traced] shell.ts:146-149 excludes a redirect operator by token VALUE after quoting is already stripped (extractRedirectTargets at shell-scanner.ts:251-267 is position-based) - a quoted literal redirect-operator argument silently drops the following resource token; already filed as Issue 80, independently re-confirmed.
3. [ISSUE][MED][code-traced] shell-scanner.ts:132-145 findLiveTrailingSensitiveSeparator has no fd-dup exclusion - the fd-dup ampersand idiom is misread as a command separator, fails closed but denies a common, named-in-scope idiom; already filed as Issue 81, independently re-confirmed.
4. [SUSPICION][MED][derived] "Collect every resource token, report all as an array" (collectResources, shell.ts:220-240) was an unforced, higher-risk design choice for SUR-06/Issue-73's multi-resource sub-case - the Manager's own same-day ruling chose the cheaper "detect shape, deny wholesale" pattern for the sibling chain-operator case, and red-team's own named test for Finding 4 offered that branch; it was not taken. NOT-COVERED: no ADR/decisions.md row states which branch the kernel is designed to safely receive. Caps MED per rule 19 (derived), does not block alone - it is the structural root under findings 1-2.
5. [CLEAN][code-traced] ADR-0021's "exactly one Action record per call" holds structurally - resolveKubectlShape (shell.ts:273-347) builds one record via one return statement; the array-collection widening lives entirely in pure helper functions feeding that one return; resolveWrapperMatch's recursive delegation is untouched and orthogonal. Independently re-traced, confirms architecture-reconfirm's own finding.
counts (a CHECKSUM): issues=3 suspicions=1 clean=1
evidence (a CHECKSUM): demonstrated=0 code-traced=4 derived=1
checks=n/a (council seat: no new code run this pass, relied on round-2 reviewers' own raw command output cited above, plus my own static trace of kernel.ts/shell.ts/shell-scanner.ts against those reports' claims, confirmed against shipped code at the cited line numbers)
adr=HIT(35)
report=docs/reviews/s4-shell-semantic-detector-architecture-council-2026-09-03.md
