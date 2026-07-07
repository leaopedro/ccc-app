# JDMA-726 Store Header Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile store hero title and subtitle with approved PT-BR copy that fits the existing storefront layout.

**Architecture:** Keep the change scoped to the mobile storefront copy source in `apps/mobile/src/copy/store.ts`. Use the existing store hero rendering in `apps/mobile/app/(app)/store/index.tsx` as the visual contract, get copy approval first, then apply only the selected text and verify the render still fits the current hero card.

**Tech Stack:** Expo React Native, TypeScript, Paperclip issue workflow

---

> note: Scope changed after board comment `4ccae348-a9ca-4cfa-8a59-16ed6abe89d8`. Instead of hardcoding one chosen copy, implement `storeHeaderTitle` and `storeHeaderSubtitle` as admin-configurable `StoreSettings` fields consumed by mobile store hero.

### Task 1: Gather current hero context and propose options

**Files:**

- Modify: `docs/superpowers/plans/2026-05-15-jdma-726-store-header-copy.md`
- Read: `apps/mobile/src/copy/store.ts`
- Read: `apps/mobile/app/(app)/store/index.tsx`

- [x] **Step 1: Inspect the current mobile store hero copy**

Current source:

```ts
header: {
  eyebrow: 'Loja JDM',
  title: 'Drops, peças e itens do paddock.',
  subtitle:
    'Busque por coleção, tipo ou peça favorita e adicione ao carrinho sem sair da vitrine.',
}
```

- [x] **Step 2: Confirm where the copy renders**

Render contract:

```tsx
<Text variant="eyebrow" tone="brand">
  {storeCopy.header.eyebrow}
</Text>
<Text variant="h1" className="mt-2">
  {storeCopy.header.title}
</Text>
<Text variant="body" tone="secondary" className="mt-3">
  {storeCopy.header.subtitle}
</Text>
```

- [x] **Step 3: Post five title + subtitle options in the Paperclip thread**

Run: issue comment update with five PT-BR options tailored to the current hero layout
Expected: board/user chooses one option before code changes begin

- [x] **Step 4: Move the issue to a waiting review path**

Run: create a Paperclip issue-thread interaction for the copy choice and set status to `in_review`
Expected: next wake happens from the board/user response

> note: Created ask-user-questions interaction `5284187e-fc55-40f6-9db4-6d59fe2cee92` so the board can pick one option directly from the issue thread.

### Task 2: Apply the approved option

**Files:**

- Modify: `apps/mobile/src/copy/store.ts`
- Verify: `apps/mobile/app/(app)/store/index.tsx`

- [ ] **Step 1: Replace `storeCopy.header.title` and `storeCopy.header.subtitle` with the selected option**

Target shape:

```ts
header: {
  eyebrow: 'Loja JDM',
  title: '<approved title>',
  subtitle: '<approved subtitle>',
}
```

- [ ] **Step 2: Verify only storefront copy changed**

Run: `git diff -- apps/mobile/src/copy/store.ts`
Expected: only the approved title and subtitle lines differ

### Task 3: Verify and hand off

**Files:**

- Modify: `docs/superpowers/plans/2026-05-15-jdma-726-store-header-copy.md`
- Update: issue thread comment/status

- [ ] **Step 1: Run the smallest proof after the copy lands**

Run: visual verification against the store hero render
Expected: title wraps cleanly and subtitle stays readable in the existing card

- [ ] **Step 2: Mark the executed steps complete and leave issue handoff**

Run: update this plan and the issue thread with what changed, what was verified, and what remains
Expected: next agent or reviewer can resume without reconstructing context

### Task 4: Make store hero text admin-configurable

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260516015000_store_header_copy_settings/migration.sql`
- Modify: `packages/shared/src/store.ts`
- Modify: `apps/api/src/routes/admin/serializers.ts`
- Modify: `apps/api/src/routes/admin/store-settings.ts`
- Modify: `apps/api/src/routes/store.ts`
- Modify: `apps/admin/app/(authed)/configuracoes/store-settings-form.tsx`
- Modify: `apps/mobile/app/(app)/store/index.tsx`
- Test: `apps/api/test/admin/store-settings.test.ts`
- Test: `apps/mobile/src/api/__tests__/store.test.ts`

- [x] **Step 1: Add new store settings fields in DB and shared contract**
- [x] **Step 2: Wire fields through admin/public API routes**
- [x] **Step 3: Add fields to admin store settings form**
- [x] **Step 4: Consume settings in mobile store hero with fallback to `storeCopy`**
- [x] **Step 5: Run focused tests for API/admin and mobile store API client**
