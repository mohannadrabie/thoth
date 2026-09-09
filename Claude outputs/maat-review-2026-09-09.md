# How maat is performing, and how to fix the milestone/issue visibility problem

**Date:** 2026-09-09
**Scope:** thoth repo, `maat` plugin, sessions from 2026-08-29 (audit) through today's S6 wrap-up

## Context

You asked for two things: how maat is actually performing, and how to make its use of Milestones and Issues good enough that you can tell what it's doing without reading every report. I pulled this from `docs/STATE.md`, `docs/decisions.md`, `docs/issue-template.md`, `docs/manager-summary-format.md`, the 85 files in `docs/reviews/`, and your own prior audit and gate-flip notes. I could not reach the GitHub API or `gh` from this session (no credentials on the linked machine, no GitHub connector here), so everything about Issues/Milestones below is reconstructed from what the repo's own docs say about them, not a live pull. Flagged where that matters.

## Goal

Give you an honest read on whether maat's ceremony is producing real value, and a specific, prioritized set of changes to how it uses Milestones and Issues so you get a one-glance status instead of a pile of reports.

## The performance question, first

**The work itself is real.** Your own 2026-08-29 audit confirmed this directly, not by trusting agent claims: 20 cited artifacts existed and were git-tracked, tests actually ran and mostly passed, lint was clean, and roughly 9,000 lines of real code and tests existed. The adversarial rounds aren't theater either. Across S2 through S6, `red-team` and the security reviewers found and closed genuine HIGH-severity bugs (a `reg.exe` PATH-hijack in S6, a fd-dup misdetection in S4, a hash that only covered one of three policy layers in S6). Several rounds show a reviewer disclosing its own prior miss unprompted. That's a functioning adversarial loop, not rubber-stamping.

**But there are two real problems, and only one of them is about Issues and Milestones.**

### Problem 1: the ceremony volume has outgrown any human's ability to track it

Six stories (S1 through S6) plus one same-day CI investigation produced 85 review files in 12 days, several running 30,000 to 50,000 characters each. Some numbers that show the shape of it:

- S4 alone took 6 red-team rounds, 3 cross-domain rounds, 2 design councils, and a hard stop to you, before shipping with one named residual.
- S6 took 6 red-team rounds and 3 cross-domain rounds across 2 days.
- Today's CI investigation ("cifix") produced 12 review files in a single day: 3 rounds each of red-team, infra-security, and cross-domain, plus a full council (design-challenger stop-brief + impact-analyst). The eventual answer was "this needs a human security-posture decision" (a PAT, a public repo, or a code redesign) — a call that didn't need 12 adversarial reports to reach, only to get to.

This matches what your own audit already flagged as a root cause: no circuit breaker on review rounds against a single target, and no liveness check before ceremony starts. That's a design gap in the loop, not a Milestone/Issue problem, and it's the reason reading "everything" feels impossible: there's a lot more being generated than there is decision-relevant content in it.

### Problem 2: the review apparatus can look green while the thing it's supposed to protect is silently broken

This is the sharper finding, and it happened again this session. CI has been dead since 2026-09-01. All 10 push/PR runs since then failed at the checkout step (a private submodule the CI token can't read), which means lint, typecheck, tests, and the secret-scan gate have run **zero times in real CI** across S2 through S6. Every "green" and "clean" claim in that entire span was an honestly-disclosed local simulation, never a verified CI run. Nobody caught it for 9 days, through two full stories and dozens of review rounds, because none of those reviews were checking whether CI itself was alive.

Your earlier audit found the same shape of problem in a different repo: gates wired into CI that reported "0 findings" because the thing they check didn't exist yet, or fired against a toy fixture instead of production code. (Worth noting: the write-gate/`report-subject-gate.mjs` saga from that audit was in a *different, unmerged* repo, `claude-plugin-governance` — I checked, and that file has never existed on this repo's branch. So that specific finding is moot here. The pattern it revealed, ceremony that produces artifacts but doesn't verify the thing that matters, is exactly what just recurred with CI.)

**The honest summary:** maat's adversarial reviewers are good at finding bugs in the code they're pointed at. They are not yet good at noticing when the safety net underneath all of them (CI) has silently failed. That's the bigger risk to trust in this system than the report volume is.

## How Milestones and Issues are actually being used today

The schema itself (`docs/issue-template.md`) is well designed: severity labels, a real state machine (`completed` vs `not_planned`, native reopen instead of duplicate issues), immutable bodies with comment-only updates, and a tiered query pattern so agents don't burn tokens loading full issue bodies just to triage. One Milestone per story (S1 = #19 ... S6 = #24), one tracking Issue per story closed out with a rollup ("Milestone #24, `Status=Shipped`, `Risk tier=CRITICAL`"), and named severity/finding Issues filed the moment a reviewer flags something.

Here's the gap: **that structure was built for agents resuming work, not for you glancing at GitHub.** Three specific reasons:

1. **A Milestone represents an entire multi-day story, not a checkpoint you'd want to check daily.** S6's Milestone covers roughly 15 review rounds over 2 days. Opening the Milestone page tells you an issue count, not whether today's news is "shipped" or "still finding new HIGHs on round 5." The actual story, at any moment, lives in `docs/STATE.md` prose, which is thousands of words and assumes a resuming agent as its reader, not you on your phone.

2. **The one signal you'd actually want ("is anything waiting on me right now") already exists in the schema and isn't being surfaced as a place you'd look.** `docs/issue-template.md` defines a `blocked-on-owner` label specifically for this. But the thing that's blocked on you *right now* (the CI security-posture decision) lives as a paragraph in STATE.md's "Blocked on a human" section, not as a labeled, filterable GitHub Issue you could find with one saved search.

3. **The Manager Summary and Session Handoff formats already solve the compression problem, on paper.** `docs/manager-summary-format.md` mandates a TL;DR in plain English before any of the verdict/severity jargon, explicitly written for "a reader who stops there." If you're seeing full reports instead of these summaries, that's the format not being surfaced to you consistently, not a missing feature.

## Recommendation

Don't add more process. Point the existing process at you. Four changes, in priority order:

**1. Fix the CI blind spot now, separately from the Milestone/Issue work.** This is already your top blocked item (`docs/STATE.md`, "Blocked on a human," item 1). Three named options are already on the table: give CI a credential that can read the private `adr` submodule, make `adr` public, or make the QA-14 check degrade loudly instead of silently when `adr/` isn't checked out. I'd pick the credential fix (a fine-grained deploy key scoped to `adr`, added as a repo secret) since it's the smallest change and keeps `adr` private. Making the check degrade loudly is worth doing either way, as a second layer, since it's what would have caught this on day one instead of day nine.

**2. Make each Milestone's tracking Issue the single thing you check, and have the Manager keep it current by comment, not just STATE.md.** Concretely: at every stage transition (plan ratified, review round closes, ship), post the Manager Summary's TL;DR (one or two plain sentences) as a comment on that story's tracking Issue. You already have the tracking-issue pattern (#121, #67, #64); it's just closed out at the end instead of updated along the way. This turns the Issue into a running, skimmable log you can read from GitHub's notifications without opening a session.

**3. Adopt `blocked-on-owner` as your actual filter, and ask the Manager to file a real Issue under it the moment something needs your decision.** Right now that moment (the CI discovery) got a STATE.md paragraph and a chat message, not a labeled Issue. A saved GitHub search like `is:issue is:open label:blocked-on-owner` becomes your entire "what does Mo need to look at" view, and it's cheap to build since the label already exists in the schema.

**4. Put a rough ceiling on review rounds before they reach you, not just on the paper trail.** PRINCIPLES rule 16 already forces a council after 2 consecutive non-clean rounds, which is good. What's missing is a signal to you specifically when a *single* story crosses some round count (I'd suggest 4 to 5) even if each round is individually resolving cleanly, since that's exactly the shape of today's 12-report CI investigation that ended in "ask the human anyway." A short Manager note ("this has taken 5 rounds; here's why") the first time a story crosses that line would let you decide whether to keep going or short-circuit to a decision, instead of finding out after the fact.

## What I'm not recommending

I'm not recommending you read more reports, add another review role, or restructure the Milestone-per-story shape. The story-per-milestone granularity is fine for the agents; it's the reporting layer on top of it that needs to change, and the pieces to do that (tracking issues, `blocked-on-owner`, the Manager Summary format) already exist in your docs. This is a "use what you built" fix, not a "build more" fix.

## Next steps

1. Decide the CI credential question (recommendation above) so real CI runs resume; this is already sitting on your desk per STATE.md.
2. Tell the Manager (via a CLAUDE.md edit, since `Issue Discipline` already lives there) to post Session-Handoff-style comments on the active story's tracking Issue at every stage, not only at close.
3. Save the `label:blocked-on-owner` GitHub filter and ask that anything needing your decision gets filed there the moment it's found, not summarized after the fact in STATE.md.
4. If you want, I can draft the exact CLAUDE.md wording for points 2 and 3 so it's a ratified rule the Manager actually follows, rather than a one-off ask.

## What I couldn't verify

I don't have live access to your GitHub Issues, Milestones, or Project board from this session (no `gh` CLI or credentials on the linked machine, no GitHub connector available here). Everything above about how Milestones/Issues are used is reconstructed from what `docs/STATE.md` and `docs/issue-template.md` say happened, not a live audit of the board itself. If you want a real check of label hygiene, stale `blocked-on-owner` items, or whether the "thoth delivery board" Project view is actually current, that needs a session with `gh` access or a GitHub connector.
