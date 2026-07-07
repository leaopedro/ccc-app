# Code review process

**Audience:** every reviewer (CTO today, peer engineers as the bench grows).

A code review answers two questions: **does the change do what the issue
says it should?** and **does it leave the codebase healthier than it found
it?** Anything outside those is style preference, and style preference is
configured in tooling, not in review comments.

## 1. Who reviews what

Until the engineering bench is hired:

- **All PRs:** CTO reviews. No exceptions, including for the CTO's own work
  — those go through `/ultrareview` or a dedicated review heartbeat.

After the bench is hired:

- **Default:** any peer engineer can review. CTO reviews any change touching
  the load-bearing list below.
- **Security-sensitive changes** (auth, secrets, ticket-signing key,
  webhook signatures, permission predicates): SecurityEngineer must review
  in addition to the CTO. Until SecurityEngineer is hired, CTO reviews and
  escalates one-way doors to the CEO.
- **UX-facing changes** (new screen, layout shift, copy decision):
  UXDesigner reviews flow + visual quality. Until UXDesigner is hired, the
  implementing engineer captures the design intent in the PR description
  and CTO confirms.

A PR without a reviewer assignment after 24 business hours pings the CTO
automatically (Paperclip wakes the assignee on `in_review` comment).

Reviews happen at PR level only. The CTO does not review a loose branch,
worktree, or "please inspect my latest commits" handoff. If there is no PR,
there is no review request yet.

Authors must not run `superpowers:requesting-code-review`, ping a reviewer,
or reassign the Paperclip issue to `in_review` until the PR already exists
and is ready for review. Review starts after a deliberate PR-level handoff,
not by osmosis.

## 2. The reviewer's job

Read the change, then read the issue and the plan document. Do not start
with the diff; start with intent. A diff that perfectly implements the wrong
thing should be sent back, not nit-picked.

In order:

1. **Does it match the issue's success condition?** If the success condition
   is missing or vague, the review pauses there — push back and ask the
   author to state it.
2. **Does it respect the load-bearing invariants?** (See section 4.) These
   are blocking, not suggestions.
3. **Does it leave the codebase coherent?** New code matches existing
   shapes; no random divergent abstractions; no half-finished refactors.
4. **Is the verification real?** Tests exist for the new behavior; the
   evidence in the PR description matches what the diff actually does.
5. **Is there a rollback path?** Stated explicitly in the PR. If not, ask.

After all five pass, the review is approve-with-or-without-nits. Nits are
optional polish; never blocking.

## 3. What blocks a merge

The reviewer marks the PR `request changes` (and reassigns the Paperclip
issue back to the author with status `in_progress`) for any of:

- **Failing CI.** Lint, typecheck, tests, or build red on the PR branch.
  The author fixes; the reviewer does not.
- **Mocked DB in API tests.** Integration tests must hit a real Postgres
  (Testcontainers / preview DB). This rule is non-negotiable.
- **Missing test for new behavior.** A new route, branch, or webhook handler
  ships with at least one integration test that exercises it. Bug fixes
  ship with a regression test where practical.
- **Touched load-bearing invariant without explicit acknowledgement.** If
  the diff modifies a webhook handler, the ticket-signing key path, the
  Order/Ticket/Membership lifecycle, or any auth/permission predicate, the
  PR description must call it out and the rollback plan must cover it.
- **Schema migration on Order / Ticket / Membership without a paired
  rollback plan.** These are one-way doors. CTO must sign off in writing
  before merge.
- **Secret in plain text or console-logged.** Even in a draft PR. Stop the
  review, escalate to CEO, force-rotate the secret if it was already
  pushed.
- **No "Manual smoke test" section** when the change is user-facing.
- **Roadmap checkbox state wrong.** A merge that doesn't deploy must keep
  the box at `[~]`; a merge that does deploy flips it to `[x]` in the
  same PR. Inconsistency blocks merge.
- **Re-introducing dropped scope.** If the roadmap shows `[-]` (dropped),
  the PR must not silently revive it. Bring it back via an ADR + CEO
  approval, not a sneaky diff.

## 4. The load-bearing invariants (CTO escalates anything that violates these)

Repeated from `CLAUDE.md` and `docs/engineering-workflow.md` because
reviewers MUST check these explicitly:

- Orders flip to `paid` only inside a verified provider-webhook handler.
- Webhooks verify signature, dedupe by provider event id, upsert by
  `provider_ref`. New handlers must show all three.
- One valid `Ticket` per `(user, event)`. Premium grants and direct
  purchases enforce this jointly.
- Premium `Vote` weight = 2 (configurable); one-vote-per-category enforced
  by `UNIQUE(category_id, user_id)`. App code must not "also enforce" it
  with a SELECT-then-INSERT — the DB is the truth.
- HMAC-signed ticket QR codes; signing key is one-way, rotation
  invalidates everything.
- LGPD endpoints (`POST /me/delete`, `POST /me/export`) and consent
  separation between transactional and marketing push.
- Rate limiting on `/auth/*`, ticket-purchase, and admin broadcast
  endpoints.
- Pre-signed R2 URLs with short TTL; CORS locked to known origins.
- Sentry on every app; structured JSON logs with request IDs; minimal PII.

## 5. Comment conventions

Use these prefixes so the author can triage at a glance:

- **`blocking:`** must be addressed before merge.
- **`question:`** I do not understand this; explain or change.
- **`nit:`** optional polish; merge is fine without it.
- **`praise:`** something done well; not required, but useful.

Never leave a comment without one of these. "Do this differently" without a
prefix forces the author to guess whether the merge is blocked.

Review style is **direct, not performative**. The reviewer's job is to
catch issues, not to demonstrate thoroughness with paragraphs of theory.

## 6. The author's job during review

Any time review feedback lands in the PR or in an implementation-review
checkpoint, the author starts by invoking `superpowers:receiving-code-review`.
In particular:

- **Push back when the feedback is wrong.** Verify before accepting.
  Performative agreement creates technical debt.
- **Address unambiguous `blocking:` items without ceremony.** Push the fix,
  reply with "fixed in <sha>" linking the commit.
- **Reply to every comment.** Even "wontfix — out of scope, captured in
  follow-up <issue>." A silent dismissal stalls the review.
- **Re-request review** after pushing fixes. Do not assume the reviewer is
  watching the PR.
- **Wake the CTO every fix round.** After each push that addresses review
  feedback, reassign the Paperclip issue to CTO with status `in_review` and
  post a comment with the new commit(s), verification evidence, and
  `Next owner: CTO review`.

## 7. The author's response, written in the PR

After CTO approves, write a one-paragraph summary of what was changed in
response to review (if anything substantive), and merge. Do not amend the
approved commits silently after approval; if you need to change behavior,
re-request review.

## 8. Cloud review (`/ultrareview`)

For high-risk changes the CTO can run `/ultrareview` to dispatch a
multi-agent cloud review of the current branch / PR. Use it for:

- Schema migrations on `Order` / `Ticket` / `Membership`.
- Webhook handler changes.
- Auth, permissions, or HMAC code paths.
- Anything the CTO flags as one-way.

`/ultrareview` is user-triggered. Engineer agents do not run it themselves.
The CEO authorizes if budget is in question.

## 9. What is NOT a review job

- **Style preferences** that aren't encoded in ESLint / Prettier / TS
  config. Either codify it in tooling or drop it.
- **Architectural redesign** mid-PR. If the architecture is wrong, that's a
  separate ADR + a separate issue, not a review comment that doubles the
  PR's scope.
- **Approving without reading.** If you didn't read the diff, do not
  approve. Reassign to someone who can.

## 10. Until the bench is hired

The CTO is reviewer of record. Reviews happen in dedicated review
heartbeats (separate from implementation heartbeats) so the perspective is
fresh. The CTO's own work is reviewed via `/ultrareview` (CEO-triggered) or
self-review against the checklist in section 3 with explicit acknowledgement
in the PR description that no second pair of eyes was available.

This is a known bus-factor risk and is one of the reasons the engineering
bench gets hired in v0.2 / v0.3.
