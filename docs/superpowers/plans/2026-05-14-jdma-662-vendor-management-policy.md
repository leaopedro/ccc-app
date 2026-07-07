# JDMA-662 Vendor Management Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight vendor-management and annual-review policy that blocks new SDKs/providers until a vendor-register row is complete and signed off.

**Architecture:** Keep scope in repo-tracked legal documentation only. Add one canonical policy under `docs/legal`, reference the vendor register as a hard prerequisite, and record the execution checkpoint in `handoff.md` without changing roadmap or phase-plan status markers.

**Tech Stack:** Markdown docs, repo legal-doc conventions, Paperclip issue comment + review handoff.

---

## File Structure

**Create:**

- `docs/legal/vendor-management-policy.md` — canonical vendor onboarding and annual review policy

**Modify:**

- `docs/superpowers/plans/2026-05-14-jdma-662-vendor-management-policy.md` — live execution log for this issue
- `handoff.md` — review-ready checkpoint for JDMA-662

**Do not modify:**

- `plans/roadmap.md`
- `plans/phase-*-plan.md`

> note: repo-rule and issue-context discovery happened before this plan file was saved because the wake payload required immediate task-specific triage. The steps below reflect the work already completed and the remaining execution order.

## ✅ Task 1: Establish the canonical doc shape and dependency path

**Files:**

- Review: `docs/legal/encarregado.md`
- Review: `CLAUDE.md`
- Review: `docs/engineering-workflow.md`

- [x] **Step 1: Confirm the worktree is clean for this issue**

Run: `git status --short`
Expected: no output

- [x] **Step 2: Confirm the branch/worktree identity**

Run: `git branch --show-current`
Expected: docs-only issue branch, not `production`

- [x] **Step 3: Read the closest legal-doc precedent**

Run: `sed -n '1,220p' docs/legal/encarregado.md`
Expected: stable legal-doc structure with status, legal basis, owner, sections, and change log

- [x] **Step 4: Decide the canonical policy path and prerequisite reference**

Output:

- Policy path: `docs/legal/vendor-management-policy.md`
- Vendor-register prerequisite path: `docs/legal/vendor-register.md`
- Enforcement point for engineering: dependency/provider additions must check the register row and policy before merge

## ✅ Task 2: Draft the vendor-management and annual-review policy

**Files:**

- Create: `docs/legal/vendor-management-policy.md`

- [x] **Step 1: Add document header and ownership metadata**

Include:

- policy title
- draft status
- legal basis citing `L13` and `L20`
- owner of document
- last updated date

- [x] **Step 2: Define onboarding gate and required vendor-register fields**

Include:

- no new SDK, SaaS provider, payment partner, analytics tool, messaging tool, infra vendor, or data processor ships before a completed vendor-register row exists
- required row fields
- required sign-off path
- explicit block if the register row is missing or incomplete

- [x] **Step 3: Define annual review cadence and ownership**

Include:

- annual review cadence
- review triggers outside the annual cycle
- review owner
- output expected from each review

- [x] **Step 4: Define engineering enforcement point**

Include:

- where engineers must check the policy and vendor register before adding vendors
- what evidence belongs in the issue or PR thread

## ✅ Task 3: Verify the artifact and leave durable handoff

**Files:**

- Modify: `docs/superpowers/plans/2026-05-14-jdma-662-vendor-management-policy.md`
- Modify: `handoff.md`

- [x] **Step 1: Review the new policy for acceptance coverage**

Check:

- required fields named
- sign-off path named
- annual cadence named
- owner named
- vendor register called out as prerequisite
- engineering check location named

- [x] **Step 2: Record the review-ready checkpoint in `handoff.md`**

Include:

- scope completed
- policy file path
- smallest verification performed
- next action and reviewer path

- [x] **Step 3: Mark completed plan steps to match reality**

Update this plan file so each completed step is `[x]` before the heartbeat ends.
