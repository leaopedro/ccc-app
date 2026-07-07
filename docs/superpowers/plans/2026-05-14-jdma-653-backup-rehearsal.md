# JDMA-653 Backup Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document an explicit quarterly backup-restore rehearsal cadence, owner, evidence artifact, escalation path, and first scheduled window for `JDMA-653`.

**Architecture:** Keep the change inside the existing Railway backup runbook so backup cadence, restore steps, verification, rehearsal evidence, and escalation instructions live in one operator document. Add the operational schedule to Paperclip as a recurring routine only if the repo and issue context support it cleanly without widening scope.

**Tech Stack:** Markdown docs, Paperclip routines API, git diff verification

---

### Task 1: Lock scope and execution context

**Files:**

- Create: `docs/superpowers/plans/2026-05-14-jdma-653-backup-rehearsal.md`
- Modify: `docs/railway.md`

- [x] **Step 1: Verify the issue worktree is dedicated and clean**

Run:

```bash
git branch --show-current
git status --short
```

Expected:

```text
chore/jdma-653-backup-rehearsal
```

and no status output beyond this plan file before the runbook edit.

- [x] **Step 2: Inspect the existing restore-rehearsal section**

Run:

```bash
sed -n '280,320p' docs/railway.md
```

Expected to find the current `Rehearsal log` table and the implied quarterly schedule text:

```md
**Quarterly rehearsal schedule:** repeat this procedure every quarter
(target: Feb, May, Aug, Nov) using a non-prod Postgres.
```

- [x] **Step 3: Post the implementation plan to the issue thread**

Comment summary:

Posted in issue comment `865c7fce-05ee-4825-a671-b3ed11687f62`.

### Task 2: Make the runbook explicit

**Files:**

- Modify: `docs/railway.md`

- [x] **Step 1: Replace the implied schedule note with an explicit operating cadence**

Insert wording that makes the cadence actionable:

```md
**Quarterly rehearsal schedule:** run one restore rehearsal during the first business week of February, May, August, and November.

- **Owner:** Platform/infra duty owner for the quarter. Until a dedicated infra owner exists, Atlas owns scheduling and evidence capture.
- **First scheduled window:** 2026-08-03 through 2026-08-07 (America/Sao_Paulo).
```

- [x] **Step 2: Add required evidence artifacts and recording instructions**

Add bullets under the schedule:

```md
- **Evidence artifact:** attach the run log, row-count query output, `prisma migrate status` result, and restored-target identifier to the run issue or linked ops ticket.
- **Recording:** append one row to the rehearsal log table after each run with the date, operator, source, target, and outcome summary.
```

- [x] **Step 3: Add explicit escalation guidance**

Add the failure path:

```md
- **Escalation:** notify the CTO immediately if the rehearsal misses the quarter, exceeds the 2 h RTO target, or reveals restore drift that is not resolved before closing the run.
```

### Task 3: Calendarize and verify

**Files:**

- Modify: `docs/railway.md`

- [x] **Step 1: Create the recurring Paperclip routine if it can be expressed cleanly**

Create one quarterly routine assigned to Atlas with a São Paulo timezone schedule. If cron constraints do not support the documented "first business week" window cleanly, keep the routine description aligned to that window and note the exact trigger used in the issue comment.

> note: CTO review found that `0 9 3 2,5,8,11 *` can fall on a weekend. The final runbook language and routine metadata now describe the exact 3rd-calendar-day trigger plus the required manual shift to the next business day when that happens.

- [x] **Step 2: Verify the doc diff is minimal and complete**

Run:

```bash
git diff -- docs/railway.md docs/superpowers/plans/2026-05-14-jdma-653-backup-rehearsal.md
```

Expected to show only:

```text
- explicit quarterly cadence
- owner
- first scheduled window
- evidence artifact + recording
- escalation path
```

- [x] **Step 3: Close the heartbeat with evidence**

Comment summary:

```md
Status: implementation complete

- Updated `docs/railway.md` with explicit quarterly cadence, owner, evidence, and escalation instructions
- First rehearsal window: 2026-08-03 through 2026-08-07 (America/Sao_Paulo)
- Verification: attached runbook diff and noted whether a Paperclip routine was created
```
