# JDMA-784 Admin Feed Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure admin users can delete any feed post from the mobile feed UI.

**Architecture:** Keep API contract unchanged because delete authorization already allows organizer/admin. Fix UI action gating so delete is shown for admin even on non-owned posts. Add regression test coverage for role-based delete affordance logic.

**Tech Stack:** Expo React Native, TypeScript, Vitest.

---

### Task 1: Add admin delete affordance for non-owned posts

**Files:**

- Modify: `apps/mobile/src/screens/events/feed/EventFeedSection.tsx`
- Modify: `apps/mobile/src/screens/events/feed/FeedPostCard.tsx`
- Modify: `apps/mobile/src/screens/events/feed/__tests__/EventFeedSection.proof.test.ts`

- [x] **Step 1: Add failing proof test for admin delete permission logic**
- [x] **Step 2: Thread role-based moderation flag from EventFeedSection to FeedPostCard**
- [x] **Step 3: Render delete action when post is own OR user is organizer/admin**
- [x] **Step 4: Run targeted mobile vitest proof suite and confirm green**
