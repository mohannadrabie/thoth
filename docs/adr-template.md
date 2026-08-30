---
id: ADR-XXX
title: Short descriptive title
status: proposed | accepted | deprecated | superseded
date: YYYY-MM-DD
supersedes: ADR-YYY (optional)
supersededBy: ADR-ZZZ (optional)
applicableTo:
  - security      # IAM, secrets, encryption, exposure, supply-chain, audit
  - network       # topology, segmentation, exposure, connectivity, vpc
  - code          # quality, correctness, testing, error-handling, maintainability
  - architecture  # design, coupling, blast-radius, cost, evolution
  - self-service  # consumer-facing flows, usability
  - integration   # how systems connect, ADR authoring flows
  - data          # storage, persistence, schemas
constraints:
  security:
    - "Specific enforceable rule (e.g., 'All S3 buckets must enable SSE-KMS encryption')"
  network:
    - "Specific enforceable rule (e.g., 'No 0.0.0.0/0 ingress on port 22')"
  code:
    - "Specific enforceable rule (e.g., 'All resources must include Name and Environment tags')"
  # Add domain-specific constraints as needed.
  # Keep each constraint specific and testable: "enable SSE-KMS encryption" (checkable),
  # not "use encryption where appropriate" (vague). Reviewers filter these by the
  # applicableTo domains above and enforce them from the shared catalog.
---

# Context
What is the issue that we're seeing that is motivating this decision or change?

# Decision
What is the change that we're proposing and/or doing?

# Rules for agents
Testable **MUST / MUST NOT / SHOULD** statements (RFC 2119) that any agent writing, reviewing, or changing code/infra in this ADR's `applicableTo` domains has to honor. This is the enforceable form of the decision; the `constraints:` frontmatter above is its machine-readable catalog (reviewers filter it by domain and check changes against these rules).

- **MUST** <specific, checkable rule> — e.g., "All S3 buckets MUST enable SSE-KMS encryption."
- **MUST NOT** <forbidden thing> — e.g., "IAM policies MUST NOT use `Action: \"*\"`."
- **SHOULD** <strong recommendation + when deviation is allowed> — e.g., "New data stores SHOULD use a customer-managed KMS key; AES256 is acceptable where compliance does not require a CMK."

Write each rule so a reviewer can verify it against the diff with evidence. A rule that cannot be satisfied is never silently violated — say so and propose an ADR change (`/…:adr-amend`).

# Consequences
What becomes easier or more difficult to do because of this change?

## Positive
- What benefits does this decision provide?

## Negative
- What trade-offs or limitations does this introduce?

# Alternatives Considered
What other approaches did we consider?

1. **Alternative 1**
   - Description
   - Why rejected

2. **Alternative 2**
   - Description
   - Why rejected

# Compliance Verification
How can reviewers/auditors check if this decision is being followed?

- Automated checks: (e.g., policy tests, linters)
- Manual checks: (e.g., code review patterns to look for)
- Evidence location: (e.g., which resources to inspect)

# References
- Links to relevant documentation, RFCs, incidents, or discussions
