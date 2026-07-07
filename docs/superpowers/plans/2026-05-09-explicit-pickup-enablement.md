# [JDMA-482] Explicit Pickup Enablement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace implicit `shippingFeeCents = null → pickup` semantics with an explicit "Modo de entrega" select on both Admin product forms.

**Architecture:** Add a `useState<'pickup' | 'ship'>` toggle to each form. When "pickup" selected, submit `shippingFeeCents=""` (→ null in action). When "ship" selected, show the fee input. No API/schema changes required — null-means-pickup semantics in checkout.ts are correct.

**Tech Stack:** Next.js App Router, React `useState`, Server Actions (no changes), `'use client'` components.

---

### Task 1: Update new-product-form.tsx

**Files:**

- Modify: `apps/admin/app/(authed)/loja/produtos/new/new-product-form.tsx`

- [x] **Step 1: Add `useState` import + fulfillmentMode state**

Replace free-text shippingFeeCents field with controlled select + conditional fee input. Default to `'pickup'` since JDM events are pickup-first.

- [x] **Step 2: Verify store-action handles missing field correctly**

`createProductAction`: `fd.get('shippingFeeCents')` returns `null` if field absent → `typeof null !== 'string'` → `shippingFeeCents = null`. ✓
Also works with `value=""` hidden input: `fd.get` returns `""` → `"" === ""` → `shippingFeeCents = null`. ✓

- [x] **Step 3: Commit**

### Task 2: Update product-form.tsx (edit)

**Files:**

- Modify: `apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx`

- [x] **Step 1: Add `useState` + derive initial fulfillmentMode from product**

`product.shippingFeeCents === null ? 'pickup' : 'ship'`

When pickup selected, render `<input type="hidden" name="shippingFeeCents" value="" />` so update action receives `""` → `null` → clears any previous shipping fee.

- [x] **Step 2: Commit**

### Task 3: Typecheck

- [x] **Step 1: Run typecheck**

```bash
cd apps/admin && pnpm tsc --noEmit
```

- [x] **Step 2: Commit + PR**
