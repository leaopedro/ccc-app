# JDMA-513 Event Cover Required Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Prevent admins from publishing an event when it has no cover image, while still allowing draft creation and draft edits without a cover.

## File Map

- `apps/api/src/routes/admin/events.ts`
  Enforce the publish-time cover requirement before status flips to `published`.
- `apps/api/test/admin/events/publish.test.ts`
  Regression coverage for the missing-cover publish path and the successful publish path with a cover.
- `apps/admin/app/(authed)/events/[id]/event-form.tsx`
  Surface publish errors clearly and add a draft-state hint when the event still has no cover.

## Steps

- [x] Add a failing API regression test in `apps/api/test/admin/events/publish.test.ts` that creates a draft event without `coverObjectKey`, calls `POST /admin/events/:id/publish`, and expects a non-success response plus unchanged `draft` status.
- [x] Run the focused publish test file and confirm the new case fails before implementation.
- [x] Update `apps/api/src/routes/admin/events.ts` so publish returns a validation error when `existing.coverObjectKey` is missing, before writing `publishedAt` or the audit row.
- [x] Add a successful publish test case that includes `coverObjectKey` and proves the normal publish path still works.
- [x] Update `apps/admin/app/(authed)/events/[id]/event-form.tsx` to show a draft-only cover requirement hint near the publish controls so the constraint is visible before submit.
- [x] Re-run the focused API test file and any directly related shared/admin checks, then capture the exact commands and results in the issue comment.
