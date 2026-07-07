# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Basic:

1. Ask, do not assume. If something is unclear, ask efore writing a single line. No silent guesses about intent, architecture, or requirements.
2. Simplest solution first. Plan/Implement the simplest thing that will work. No abstractions, improvements or flexibility I did not explicitly request.
3. Do not touch unrelated code. If a file or function is not part of the current task, do not modify it even if you think it could be improved.
4. Flag uncertainty explicitly. If you are not confident about an approach or technical detail, say so before proceeding. Confidence without certainty causes damage.

## Branch safety preflight

- Before the first edit, run `git branch --show-current`.
- If the output is `production`, STOP.
- Do not edit files on `production`.
- Do not commit on `production`.
- Do not push on `production`.
- Switch to `main` first.
- Pull `main` with `git pull --ff-only origin main`.
- Create a feature branch from `main`.
- Never branch or create a worktree from `production`.

## Approach

- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required.
- Suggest running /cost when a session is running long to monitor cache ratio.
- Recommend starting a new session when switching to an unrelated task.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

# Core Rules

Short sentences only (8-10 words max).
No filler, no preamble, no pleasantries.
Tool first. Result first. No explain unless asked.
Code stays normal. English gets compressed.

---

## Formatting

Output sounds human. Never AI-generated.
Never use em-dashes or replacement hyphens.
Avoid parenthetical clauses entirely.
Hyphens map to standard grammar only.

## Git flow (load-bearing)

- Branch from fresh `main`.
- Open PRs to `main` only.
- Request review only after the PR exists.
- Do not ask for review on a branch alone.
- Never commit to `production`.
- Never push to `production`.
- `production` is updated only by manual merge from `main` by local-board.

## Canonical planning docs

- `brainstorm.md` — high-level architecture brief

When the user asks for planning or implementation, align proposals with the phasing, stack, and feature boundaries already decided in the related docs files.

## Architecture (planned, per brainstorm.md)

Single pnpm monorepo, TypeScript end-to-end:

```
apps/mobile   Expo managed React Native (attendees)
apps/admin    Next.js App Router (organizer web)
apps/api      Fastify + Node.js REST API
packages/db   Prisma schema + client
packages/shared  Zod schemas shared by api/mobile/admin
```

Runtime: API + Postgres on Railway, admin on Vercel, mobile via EAS Build. Media on Cloudflare R2 (client-direct pre-signed PUTs). Stripe for card/Apple Pay + recurring memberships; AbacatePay for one-time Pix. Expo Push for notifications (no WebSockets in MVP — REST + polling). Sentry on all three apps.

Load-bearing invariants (enforce in code, not comments):

- Orders only flip to `paid` from verified provider webhooks — never from client calls.
- Webhooks are idempotent: dedupe by provider event id, upsert by `provider_ref`, verify signature on every handler.

## Cross-cutting requirements

- Primary language PT-BR; i18n scaffold from day one (copy in a shared locale package).
- LGPD compliant
- Rate limiting multiple relevant endpoints.
- Signed ticket QR codes (HMAC); pre-signed R2 URLs with short TTL; CORS locked to known origins.
- Integration tests for the API must hit a real Postgres (Testcontainers or preview DB), not mocks.
