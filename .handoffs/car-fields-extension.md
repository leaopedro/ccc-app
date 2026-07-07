# Handoff — Car Fields Extension

**Generated:** 2026-05-20
**PR:** #356 — https://github.com/leaopedro/jdm/pull/356 — OPEN, ready for external review

---

## State

### Branch

`feat/jdma-car-fields-extension` rebased onto current `main` (`d6b50e4`).

### Commits (8 atop main)

- `49f0494` docs(plans): add Car fields extension spec + plan
- `737105a` feat(db): add description, modifications, tighten nickname on Car
- `a27a005` feat(shared): extend carInputSchema, carSchema, publicCarProfileSchema
- `6cc38ee` feat(api): pass description/modifications through serialize, map P2002 to 409 nickname_taken
- `a761541` feat(mobile): add garage copy strings
- `12548be` feat(mobile): add description/modifications fields and tighten nickname in car forms
- `32c38f4` feat(mobile): render modifications pills on all car-identity public surfaces
- `731c9aa` test: update TASK-A garage fixtures for required+unique nickname

### Gates

- `pnpm -r typecheck` ✅ clean
- `pnpm -r test` ✅ 1892/1892 (149 shared + 93 admin + 1307 api + 343 mobile)
- `pnpm -r lint` ✅ touched workspaces clean; pre-existing admin debt unrelated

### Reviews completed (internal)

- Spec compliance ✅ (all 14 checklist items)
- Code quality ✅ (3 non-blocking nits: TextField h-12 multiline matches existing bio pattern, SUBSTR overflow theoretical at 99M cars, array index keys acceptable since pills re-parse per keystroke)

### Plan

`plans/car-fields/spec-and-plan.md` (1639 lines, written via `/writing-plans` Sonnet subagent).

---

## Next steps

1. **External PR review** — paste this handoff prompt to a reviewer agent:

```
Review PR #356 on leaopedro/jdm: "feat: Car fields — description, modifications, required+unique nickname".

Base: main (d6b50e4). Head: feat/jdma-car-fields-extension (8 commits, 35 files).

Canonical spec: plans/car-fields/spec-and-plan.md (committed on branch).

Focus areas:
1. Migration safety. Single transactional migration (20260521000000). Verify ordering: add cols → defensive truncate (>20 char rows) → backfill NULL via `<Make> <Model>` → ROW_NUMBER dedupe → SET NOT NULL → ALTER TYPE VARCHAR(20) → CREATE UNIQUE INDEX. SUBSTR length math correct.
2. Idempotency / rerun safety. Backfill is destructive forward-only; that's accepted (single deploy).
3. Regex /^[\p{L}\p{N} ]+$/u accepts PT-BR accents (é ã ç), rejects emoji, allows interior spaces. Verify against Zod test fixtures.
4. P2002 → 409 mapping. POST and PATCH /me/cars both handle. Error body shape `{ error: 'nickname_taken' }`.
5. Mobile UX. ModificationPills consistent across 5 public surfaces (garage list × 2, FeedPostCard, CarPickerPopover, CarPlatePicker). RHF form generic `useForm<z.input<...>, unknown, CarInput>` correct for exactOptionalPropertyTypes.
6. Cross-feature: TASK-A's carSchema.tier ships as `.optional()` with both TODO TASK-B / TODO TASK-E markers — preserved verbatim through rebase.

Out of scope (do not flag): admin (apps/admin/) untouched; TASK-A garage spots untouched except test fixtures (3 sites updated for nickname NOT NULL + UNIQUE constraint).

Output format: one finding per line, severity-tagged (🔴 critical / 🟠 important / 🟡 minor), file:line, suggested fix. Skip praise. Skip style nits unless they change meaning.
```

2. **Address review findings.** Fix-commits land on branch; rerun typecheck + tests; push.
3. **Merge** when reviewer + user approve. Squash-merge per repo convention.

### Risk items flagged by planner (resolved in implementation, worth verifying in review)

1. TASK-A merge order — RESOLVED. Rebase done; tier marker preserved.
2. Existing nicknames >20 chars in production — RESOLVED by defensive truncate CTE before SET NOT NULL.
3. 2-digit suffix collisions (N ≥ 10) — RESOLVED via `SUBSTR(base, 1, 20 - LENGTH(' ' || rn::TEXT))`.

---

## Local-only untracked

- `.handoffs/` (this directory) — gitignored
- `.gitignore` has the line adding `.handoffs/` — uncommitted, intentional, do not include in PR
- `AGENTS.md` untracked — unrelated, leave alone

---

## Resume prompt (paste into fresh session)

```
Resume Car fields extension PR #356 review cycle. Read /Users/pedro/Projects/jdm-experience/.handoffs/car-fields-extension.md for full state.

PR is open, all internal gates green. Next: dispatch an external reviewer (use the prompt under "External PR review" in the handoff doc), then address findings as fix-commits, then merge when approved.

Branch: feat/jdma-car-fields-extension. Working dir: /Users/pedro/Projects/jdm-experience.

Caveman mode (full). PT-BR primary. Branch safety per CLAUDE.md. Real Postgres tests via Testcontainers. Never amend; always new commits. Don't push production. Never bypass hooks.
```
