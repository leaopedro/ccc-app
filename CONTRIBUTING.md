# Contributing

The repository is hosted at https://github.com/leaopedro/jdm. The default
branch is `main` (we follow the modern Git convention; older docs that say
"master" mean `main`).

## Workflow (required for every change)

Every change — code, docs, config — lands on `main` through a Pull Request.
Direct pushes to `main` are not allowed.

```
issue assigned
  → write the issue plan with `superpowers:writing-plans`
  → comment with the plan link and scope summary
  → branch off main (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`)
  → implement the accepted plan with `superpowers:subagent-driven-development`
  → commit logically and push the branch to origin
  → open a review-ready PR to `main` and link the Paperclip issue
  → run `superpowers:requesting-code-review` and request review on that PR
  → reviewer (CTO today; peer engineer once the bench is hired) reviews
  → if feedback lands, use `superpowers:receiving-code-review` before changing code
  → fix, re-request review, and reassign issue to CTO (`in_review`) until approved
  → merge to `main` (squash if commits are noisy)
  → deploy (Railway / Vercel / EAS) as part of the merge, not a follow-up
  → flip the matching `plans/roadmap.md` checkbox `[~]` → `[x]` in the same PR
  → close the Paperclip issue with the PR link and verification evidence
```

The full lifecycle (planning, code review responsibilities, manual smoke
test handoff, rollback plans) lives in [`docs/engineering-workflow.md`](docs/engineering-workflow.md)
and [`docs/code-review.md`](docs/code-review.md). Read both before opening
your first PR. The short version above is not optional; those skill gates are
the required path for non-trivial work.

No PR means no review request yet. Do not ask the CTO to review a branch,
worktree, or commit range outside the PR handoff.

## Branching

- Branch off `main`. Use Conventional Commit prefixes for branch names too:
  `feat/ticketing-stripe`, `fix/auth-refresh-rotation`, etc.
- Keep PRs small. One task from `roadmap.md` ≈ one PR.
- `production` is sacred: edits, commits, and writes are blocked there. It is
  updated only by a manual merge from `main`.
- `main` accepts local edits and commits, but `git push` from `main` is blocked
  by the `.claude/settings.json` hook — push from a feature branch and open a PR.

## Commits

Conventional Commits only:

- `feat:` user-visible feature
- `fix:` bug fix
- `chore:` tooling, deps, config
- `docs:` docs only
- `test:` tests only
- `ci:` CI configuration
- `refactor:` no behavior change
- Scope optional but preferred: `feat(api): ...`.

## Tests

- API changes require integration tests against a real Postgres (Testcontainers).
  No mocking the database.
- Shared helpers get unit tests.
- Mobile flows covered by Maestro in later phases — for Phase 0 a typecheck plus a manual Expo run is enough.

## PR checklist

Before requesting review:

- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean
- [ ] Any new env var documented in `docs/secrets.md` + `.env.example`
- [ ] Any new secret registered in Railway / Vercel / EAS as appropriate
- [ ] Roadmap checkbox **not** ticked (only the merger ticks it post-deploy)
- [ ] Paperclip issue reassigned to CTO with status `in_review` + comment with PR link and test evidence

## Code style

- Strict TypeScript, no `any` unless justified with a comment.
- Zod at every system boundary (HTTP, webhooks, env parsing).
- Prefer pure functions; keep side effects at the edge (route handlers,
  service entrypoints).
- Never flip `Order.status` to `paid` outside a verified provider webhook.
- One Prisma migration per PR that touches the schema.

## Security

- Never commit secrets. `docs/secrets.md` is the source of truth for where
  each one lives.
- Webhook handlers must verify signatures and dedupe by provider event id.
- All mutations that touch other users' data require an authorization check
  — keep the "can X do Y to Z" predicate in a service, not the route.
