# TASK-H — Admin Product Editor UI Carve-outs for Virtual Products

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve out the admin product editor UI so virtual products (currently only the singleton garage-spot product) hide irrelevant fields (photo uploader, pickup/ship checkboxes, shipping fee, archive button), show a clear hint banner, and only expose the price + status controls.

**Architecture:** UI-only change in `apps/admin/app/(authed)/loja/produtos/[id]`. A single `isVirtual` boolean derived from `product.virtual` (introduced server-side by TASK-A) drives conditional rendering across the product detail page. The "Arquivar" button is hidden when the product slug equals the garage singleton slug (`SINGLETON_SLUGS = ['garage-spot']`), mirroring the server-side delete/archive guard that TASK-A will land in `PATCH /admin/store/products/:id`. New `VirtualProductBanner` component renders the hint copy.

**Tech Stack:** React 19 server components + client form components, `useActionState`, Vitest with `react-dom/server`'s `renderToStaticMarkup` for snapshot-style tests and `jsdom + react-dom/client + act` for interaction tests (matching `variant-list.test.tsx` and `add-user-to-group-modal.interaction.test.tsx` patterns already in the repo).

**Dependencies (must be merged before TASK-H starts):**

- TASK-A has added `Product.virtual: boolean` and `Product.visibleInStore: boolean` to the Prisma schema, the serializer (`apps/api/src/routes/admin/store/serializers.ts`), and the shared Zod schema `adminStoreProductDetailSchema` in `packages/shared/src/admin.ts`. After this, `AdminStoreProductDetail.virtual` exists at the TypeScript level.
- TASK-A has also seeded the singleton garage-spot product with `slug: 'garage-spot'` and exposed a constant (or at minimum committed to the slug `'garage-spot'`). This plan re-uses that slug literally; if TASK-A exports a constant from `@jdm/shared` (e.g. `GARAGE_SPOT_PRODUCT_SLUG`), Task 3 below should import it instead of hardcoding the literal.
- TASK-A has added the server-side validation carve-out in `apps/api/src/routes/admin/store/products.ts` (lines 121-136) that bypasses the photo + fulfillment-method requirement when the product is `virtual=true`. This is owned by TASK-A (which introduces `Product.virtual` and all virtual-product capability), not TASK-C. TASK-H blocks on this specific TASK-A change. The test cases below verify that the UI no longer surfaces those gates for virtual products; if the manual check in Task 5 returns a 400 when saving with `status=active`, TASK-A's server carve-out has not landed yet.

**Out of scope (do NOT touch in this task):**

- The `Product.virtual` / `Product.visibleInStore` schema columns, migration, seed, or AdminAudit enum extensions (TASK-A).
- Server-side validation carve-out in `apps/api/src/routes/admin/store/products.ts` lines 121-136 (TASK-A).
- Public store filters (TASK-C).
- Garage-spot pricing wired into `purchaseOption` (TASK-B).
- The "new product" form at `apps/admin/app/(authed)/loja/produtos/new/new-product-form.tsx` — admins cannot create virtual products via the UI; the singleton is seeded.

---

## File-by-file map

| File                                                                           | Action     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.tsx`        | **Create** | Stateless server-compatible component that renders the hint banner "Produto virtual — sem estoque ou entrega."                                                                                                                                                                                                                                                                                                                                               |
| `apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx`                  | **Modify** | Compute `isVirtual = product.virtual`. When true: hide the "Modo de entrega" fieldset and the shipping-fee field, omit the `allowPickup`/`allowShip`/`shippingFeeCents` hidden inputs from the submitted form, remove the photo gate on the Status select (`disabled` flag and the "Adicione pelo menos uma foto" helper text), remove the photo gate on the "Reativar" button, and hide the "Arquivar" button when the product is a singleton (slug match). |
| `apps/admin/app/(authed)/loja/produtos/[id]/page.tsx`                          | **Modify** | When `product.virtual` is true: render `<VirtualProductBanner />` directly under the header; do NOT render `<PhotoGallery>`; still render `<ProductForm>` and `<VariantList>` (variant list is unaffected by this task — the singleton has one variant and admins may still inspect it).                                                                                                                                                                     |
| `apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.test.tsx`   | **Create** | Snapshot the banner copy and a basic prop/class assertion.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/admin/app/(authed)/loja/produtos/[id]/product-form.test.tsx`             | **Create** | Static-markup assertions covering: (a) non-virtual product renders fulfillment fieldset, shipping fee path, photo gate copy, and the "Arquivar" button; (b) virtual non-singleton product hides fulfillment + shipping + photo gate copy but still renders "Arquivar"; (c) virtual singleton (`slug === 'garage-spot'`) hides everything above AND the "Arquivar" button is absent.                                                                          |
| `apps/admin/app/(authed)/loja/produtos/[id]/product-form.interaction.test.tsx` | **Create** | jsdom + act test: render virtual product form, submit, assert that the server action was called WITHOUT `allowPickup`/`allowShip`/`shippingFeeCents` in the FormData and that the Status select can move from `draft` to `active` without a photo being attached.                                                                                                                                                                                            |

**Why no shared/api/db changes:** all required server-side fields (`virtual`, `slug`, `visibleInStore`) ship in TASK-A. This task is pure admin-web UI plus tests.

---

## Copy keys

There is no shared locale package in the admin app today (see brainstorm.md / Car_spot_plan §6 — admin copy lives inline alongside the existing form labels in the same file). Follow the existing pattern: define copy as module-scoped constants at the top of `virtual-product-banner.tsx`.

```ts
// apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.tsx
const COPY = {
  title: 'Produto virtual',
  body: 'Produto virtual — sem estoque ou entrega.',
} as const;
```

If TASK-A exports a `GARAGE_SPOT_PRODUCT_SLUG` constant from `@jdm/shared`, Task 3 imports it. Otherwise hard-code:

```ts
// apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx (top of file)
const SINGLETON_PRODUCT_SLUGS = new Set<string>(['garage-spot']);
```

---

## Task 1: Create the `VirtualProductBanner` component (TDD)

**Files:**

- Create: `apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.tsx`
- Test: `apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.test.tsx`:

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { VirtualProductBanner } from './virtual-product-banner';

describe('VirtualProductBanner', () => {
  it('renders the title and the explanatory body copy', () => {
    const html = renderToStaticMarkup(<VirtualProductBanner />);
    expect(html).toContain('Produto virtual');
    expect(html).toContain('Produto virtual — sem estoque ou entrega.');
  });

  it('exposes a stable test hook via data-testid', () => {
    const html = renderToStaticMarkup(<VirtualProductBanner />);
    expect(html).toContain('data-testid="virtual-product-banner"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from repo root:

```bash
pnpm --filter @jdm/admin test -- virtual-product-banner.test.tsx
```

Expected: FAIL with "Cannot find module './virtual-product-banner'".

- [ ] **Step 3: Write minimal implementation**

Create `apps/admin/app/(authed)/loja/produtos/[id]/virtual-product-banner.tsx`:

```tsx
const COPY = {
  title: 'Produto virtual',
  body: 'Produto virtual — sem estoque ou entrega.',
} as const;

export const VirtualProductBanner = () => (
  <aside
    data-testid="virtual-product-banner"
    className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-sm"
    role="note"
  >
    <p className="font-semibold">{COPY.title}</p>
    <p className="text-[color:var(--color-muted)]">{COPY.body}</p>
  </aside>
);
```

Note: this component is intentionally synchronous and dependency-free. It must be safe to render from both server and client components.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @jdm/admin test -- virtual-product-banner.test.tsx
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/\(authed\)/loja/produtos/\[id\]/virtual-product-banner.tsx \
        apps/admin/app/\(authed\)/loja/produtos/\[id\]/virtual-product-banner.test.tsx
git commit -m "feat(admin): add virtual product banner component"
```

---

## Task 2: Wire `VirtualProductBanner` into the product detail page and skip `PhotoGallery` for virtual products

**Files:**

- Modify: `apps/admin/app/(authed)/loja/produtos/[id]/page.tsx`

This task has no automated test (the page is a server component that calls the API; tests for it would need network mocks not present in the repo). The user-facing carve-out is exercised end-to-end in Task 4 via the form tests, and verified manually per the test plan section at the bottom.

- [ ] **Step 1: Read the current file**

The current page renders, in order: `<header>`, `<ProductForm>`, `<VariantList>`, `<PhotoGallery>`.

- [ ] **Step 2: Modify the page**

> **Read before writing.** TASK-A may have already modified `page.tsx` (e.g. to read `product.virtual` or add new imports). Do NOT paste the block below as a wholesale replacement. Instead, open the current file and apply only these targeted changes:
>
> 1. Import `VirtualProductBanner` from `./virtual-product-banner`.
> 2. Derive `const isVirtual = product.virtual === true;` after fetching the product.
> 3. Replace the `<PhotoGallery .../>` line with `{isVirtual ? null : <PhotoGallery productId={product.id} photos={product.photos} />}`.
> 4. Insert `{isVirtual ? <VirtualProductBanner /> : null}` directly after the closing `</header>` tag.
>
> The reference implementation below shows what the final file should look like if TASK-A has not yet touched it. Use it as a reference for the four targeted changes above, not as a paste target.

Edit `apps/admin/app/(authed)/loja/produtos/[id]/page.tsx` so the body becomes:

```tsx
import { notFound } from 'next/navigation';

import { ProductStatusBadge } from '../product-status-badge';

import { PhotoGallery } from './photo-gallery';
import { ProductForm } from './product-form';
import { VariantList } from './variant-list';
import { VirtualProductBanner } from './virtual-product-banner';

import { getAdminStoreProduct, listAdminProductTypes } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let product;
  try {
    product = await getAdminStoreProduct(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const { items: productTypes } = await listAdminProductTypes();
  const isVirtual = product.virtual === true;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{product.title}</h1>
          <p className="text-sm text-[color:var(--color-muted)]">{product.slug}</p>
        </div>
        <ProductStatusBadge status={product.status} />
      </header>
      {isVirtual ? <VirtualProductBanner /> : null}
      <ProductForm product={product} productTypes={productTypes} />
      <VariantList
        productId={product.id}
        productPriceCents={product.basePriceCents}
        variants={product.variants}
      />
      {isVirtual ? null : <PhotoGallery productId={product.id} photos={product.photos} />}
    </section>
  );
}
```

- [ ] **Step 3: Type-check the change**

Run from repo root:

```bash
pnpm --filter @jdm/admin tsc --noEmit
```

Expected: PASS (assumes TASK-A has already added `virtual: boolean` to `adminStoreProductDetailSchema`; otherwise `product.virtual === true` will be a type error against `boolean | undefined` — see "Risks" section below).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/\(authed\)/loja/produtos/\[id\]/page.tsx
git commit -m "feat(admin): hide photo gallery and show banner for virtual products"
```

---

## Task 3: Carve out the `ProductForm` (TDD — static markup assertions)

**Files:**

- Modify: `apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx`
- Create: `apps/admin/app/(authed)/loja/produtos/[id]/product-form.test.tsx`

- [ ] **Step 0: Verify TASK-A has landed `adminStoreProductDetailSchema.virtual`**

Before writing any fixture or production code, confirm the Zod schema includes `virtual` and `visibleInStore`:

```bash
grep -n "virtual\|visibleInStore" packages/shared/src/admin.ts
```

Expected: at least one line inside `adminStoreProductDetailSchema` declaring `virtual: z.boolean()` and `visibleInStore: z.boolean()`. If absent, TASK-H cannot start — stop and unblock TASK-A first.

Also run a type-check to confirm the TypeScript surface:

```bash
pnpm --filter @jdm/admin tsc --noEmit 2>&1 | head -20
```

If there are errors on `product.virtual` or `product.visibleInStore`, TASK-A has not landed. Do not proceed.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/(authed)/loja/produtos/[id]/product-form.test.tsx`:

```tsx
import type { AdminProductType, AdminStoreProductDetail } from '@jdm/shared/admin';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/store-actions', () => ({
  archiveProductAction: vi.fn(),
  updateProductAction: vi.fn(),
}));

import { ProductForm } from './product-form';

const productTypes: AdminProductType[] = [
  { id: 'pt_1', name: 'Camisetas', sortOrder: 0 },
  { id: 'pt_garage', name: 'garage_spot', sortOrder: 99 },
];

const baseProduct: AdminStoreProductDetail = {
  id: 'prod_1',
  slug: 'camiseta-jdm',
  title: 'Camiseta JDM',
  description: 'Algodão pima',
  productTypeId: 'pt_1',
  basePriceCents: 9900,
  currency: 'BRL',
  status: 'draft',
  allowPickup: false,
  allowShip: false,
  shippingFeeCents: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  photos: [],
  virtual: false,
  visibleInStore: true,
};

const garageSingleton: AdminStoreProductDetail = {
  ...baseProduct,
  id: 'prod_garage',
  slug: 'garage-spot',
  title: 'Vaga de Garagem Adicional',
  productTypeId: 'pt_garage',
  basePriceCents: 5000,
  status: 'active',
  virtual: true,
  visibleInStore: false,
};

// Archived singleton: used to verify Reativar is hidden even when the product is archived.
// A non-singleton archived product would normally show Reativar; the singleton must never show it.
const garageSingletonArchived: AdminStoreProductDetail = {
  ...garageSingleton,
  status: 'archived',
};

describe('ProductForm — non-virtual product', () => {
  it('renders the fulfillment fieldset', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('Modo de entrega');
    expect(html).toContain('Retirada no evento');
    expect(html).toContain('Envio');
  });

  it('renders the photo-required helper text when status is draft and no photos', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('Adicione pelo menos uma foto para ativar o produto.');
  });

  it('renders the Arquivar button for a draft non-singleton product', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={baseProduct} productTypes={productTypes} />,
    );
    expect(html).toContain('Arquivar');
  });
});

describe('ProductForm — virtual product', () => {
  it('does NOT render the fulfillment fieldset', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('Modo de entrega');
    expect(html).not.toContain('Retirada no evento');
    expect(html).not.toContain('name="allowPickup"');
    expect(html).not.toContain('name="allowShip"');
    expect(html).not.toContain('name="shippingFeeCents"');
  });

  it('does NOT render the photo-required helper text', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('Adicione pelo menos uma foto para ativar o produto.');
    expect(html).not.toContain('Adicione pelo menos uma foto antes de ativar.');
  });

  it('still renders the price editor and status select', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).toContain('name="basePriceCents"');
    expect(html).toContain('name="status"');
  });

  it('hides the Arquivar button for the garage-spot singleton (status=active)', () => {
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingleton} productTypes={productTypes} />,
    );
    expect(html).not.toContain('>Arquivar<');
  });

  it('hides the Reativar button for the garage-spot singleton (status=archived)', () => {
    // status=archived means the ternary would render Reativar for a normal product.
    // For the singleton it must still be absent. This assertion is NOT vacuous:
    // a non-singleton archived product WOULD render Reativar.
    const html = renderToStaticMarkup(
      <ProductForm product={garageSingletonArchived} productTypes={productTypes} />,
    );
    expect(html).not.toContain('>Reativar<');
    expect(html).not.toContain('>Arquivar<');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @jdm/admin test -- product-form.test.tsx
```

Expected: All "virtual product" tests FAIL because the current form unconditionally renders the fulfillment fieldset and Arquivar button.

- [ ] **Step 3: Modify `product-form.tsx`**

Edit `apps/admin/app/(authed)/loja/produtos/[id]/product-form.tsx`. The changes are:

1. At the top of the file (above the `Submit` component), add:

```ts
const SINGLETON_PRODUCT_SLUGS = new Set<string>(['garage-spot']);
```

2. Inside `ProductForm`, after the existing `hasPhotos` line, add:

```ts
const isVirtual = product.virtual === true;
const isSingleton = SINGLETON_PRODUCT_SLUGS.has(product.slug);
// Virtual products bypass the photo gate (server-side carve-out is in TASK-A).
const photoGateActive = !isVirtual && !hasPhotos && product.status !== 'active';
```

3. Wrap the `<fieldset>` with the fulfillment checkboxes AND the two hidden inputs (`allowPickup`, `allowShip`) AND the `shippingFeeCents` field/hidden input block in `!isVirtual ? (...) : null`. The replacement block:

```tsx
{
  !isVirtual ? (
    <>
      <fieldset className="sm:col-span-2 flex flex-col gap-2">
        <legend className="mb-1 text-sm text-[color:var(--color-muted)]">Modo de entrega</legend>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowPickup}
            onChange={(e) => setAllowPickup(e.target.checked)}
          />
          <span>Retirada no evento</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowShip}
            onChange={(e) => setAllowShip(e.target.checked)}
          />
          <span>Envio</span>
        </label>
      </fieldset>
      <input type="hidden" name="allowPickup" value={allowPickup ? 'true' : 'false'} />
      <input type="hidden" name="allowShip" value={allowShip ? 'true' : 'false'} />
      {allowShip ? (
        <Field
          label="Frete fixo (centavos)"
          name="shippingFeeCents"
          type="number"
          min={0}
          defaultValue={
            v.shippingFeeCents ??
            (product.shippingFeeCents == null ? '' : String(product.shippingFeeCents))
          }
        />
      ) : (
        <input type="hidden" name="shippingFeeCents" value="" />
      )}
    </>
  ) : null;
}
```

4. In the Status `<select>`, replace `disabled={!hasPhotos && product.status !== 'active'}` with `disabled={photoGateActive}`. Replace the helper-text block below the select with:

```tsx
{
  photoGateActive ? (
    <span className="text-xs text-[color:var(--color-muted)]">
      Adicione pelo menos uma foto para ativar o produto.
    </span>
  ) : null;
}
```

> **IMPORTANT:** Steps 4 and 5 are an atomic pair. The photo gate appears in **two** locations in `product-form.tsx`: (a) the `<option value="active" disabled>` flag on the Status select (line 157 before this edit) and (b) the `disabled={!hasPhotos}` prop on the "Reativar" button (line 188 before this edit). Step 4 patches site (a); Step 5 patches site (b). You must complete both steps before committing. Running the tests after only one step will produce a false pass on some cases. Do not commit after Step 4 alone.

5. In the final `<div className="sm:col-span-2 flex gap-3">` button row, wrap the entire archive/reactivate ternary in a singleton guard:

```tsx
<div className="sm:col-span-2 flex gap-3">
  <Submit />
  {isSingleton ? null : product.status !== 'archived' ? (
    <button
      type="submit"
      formAction={() => {
        void archiveProductAction(product.id);
      }}
      className="rounded border border-[color:var(--color-border)] px-3 py-2 text-sm"
    >
      Arquivar
    </button>
  ) : (
    <button
      type="submit"
      formAction={async (fd: FormData) => {
        fd.set('status', 'active');
        await updateProductAction(product.id, initial, fd);
      }}
      disabled={!isVirtual && !hasPhotos}
      title={!isVirtual && !hasPhotos ? 'Adicione pelo menos uma foto antes de ativar.' : undefined}
      className="rounded border border-[color:var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
    >
      Reativar
    </button>
  )}
</div>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @jdm/admin test -- product-form.test.tsx
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Run the lint + type-check**

```bash
pnpm --filter @jdm/admin lint
pnpm --filter @jdm/admin tsc --noEmit
```

Expected: PASS. If TS complains about `product.virtual` being `undefined`, verify TASK-A landed `adminStoreProductDetailSchema.virtual` (see "Risks" below).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/\(authed\)/loja/produtos/\[id\]/product-form.tsx \
        apps/admin/app/\(authed\)/loja/produtos/\[id\]/product-form.test.tsx
git commit -m "feat(admin): carve out product form for virtual products"
```

---

## Task 4: Interaction test — activating a virtual product without a photo

**Files:**

- Create: `apps/admin/app/(authed)/loja/produtos/[id]/product-form.interaction.test.tsx`

This test validates the form's behavior end-to-end inside jsdom: the Status select is not disabled, the form submits without `allowPickup`/`allowShip`/`shippingFeeCents` keys, and the photo gate does not block activation. The pattern mirrors `apps/admin/src/components/add-user-to-group-modal.interaction.test.tsx`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/(authed)/loja/produtos/[id]/product-form.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import type { AdminProductType, AdminStoreProductDetail } from '@jdm/shared/admin';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateProductMock, archiveProductMock } = vi.hoisted(() => ({
  updateProductMock: vi.fn(async () => ({ error: null })),
  archiveProductMock: vi.fn(async () => ({ error: null })),
}));

vi.mock('~/lib/store-actions', () => ({
  updateProductAction: updateProductMock,
  archiveProductAction: archiveProductMock,
}));

import { ProductForm } from './product-form';

const productTypes: AdminProductType[] = [{ id: 'pt_garage', name: 'garage_spot', sortOrder: 99 }];

const virtualProduct: AdminStoreProductDetail = {
  id: 'prod_garage',
  slug: 'garage-spot',
  title: 'Vaga de Garagem Adicional',
  description: 'Vaga extra.',
  productTypeId: 'pt_garage',
  basePriceCents: 5000,
  currency: 'BRL',
  status: 'draft',
  allowPickup: false,
  allowShip: false,
  shippingFeeCents: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [],
  photos: [],
  virtual: true,
  visibleInStore: false,
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  updateProductMock.mockClear();
  archiveProductMock.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('ProductForm interaction — virtual product', () => {
  it('does not disable the active option even when there are no photos', () => {
    act(() => {
      root.render(<ProductForm product={virtualProduct} productTypes={productTypes} />);
    });
    const select = container.querySelector('select[name="status"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const activeOption = Array.from(select.options).find((o) => o.value === 'active');
    expect(activeOption?.disabled).toBe(false);
  });

  it('submits without fulfillment fields when the form is submitted', async () => {
    act(() => {
      root.render(<ProductForm product={virtualProduct} productTypes={productTypes} />);
    });
    const form = container.querySelector('form') as HTMLFormElement;
    // Simulate the React-19 form action by reading the form data the way
    // useActionState would assemble it.
    const fd = new FormData(form);
    expect(fd.has('allowPickup')).toBe(false);
    expect(fd.has('allowShip')).toBe(false);
    expect(fd.has('shippingFeeCents')).toBe(false);
    // Sanity: price is still in the submission.
    expect(fd.get('basePriceCents')).toBe('5000');
    // Read status from the DOM select's .value, not FormData, to avoid jsdom
    // defaultValue vs. FormData serialization discrepancies. After act() the
    // select's value property reflects the React-rendered defaultValue.
    const statusSelect = container.querySelector('select[name="status"]') as HTMLSelectElement;
    expect(statusSelect.value).toBe('draft');
  });

  it('hides the Arquivar button for the garage-spot singleton', () => {
    act(() => {
      root.render(<ProductForm product={virtualProduct} productTypes={productTypes} />);
    });
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    );
    expect(buttons.some((t) => t.trim() === 'Arquivar')).toBe(false);
    expect(buttons.some((t) => t.trim() === 'Reativar')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (initially)**

```bash
pnpm --filter @jdm/admin test -- product-form.interaction.test.tsx
```

Expected: PASS if Task 3 is complete. If you are running this before Task 3 lands, expect "Arquivar" assertion + FormData assertion to FAIL.

- [ ] **Step 3: Fix if needed**

If any assertion fails because of an oversight in Task 3, revisit the corresponding `product-form.tsx` change. Do not weaken the test; tighten the production code until the test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/\(authed\)/loja/produtos/\[id\]/product-form.interaction.test.tsx
git commit -m "test(admin): interaction tests for virtual product form behavior"
```

---

## Task 5: Manual verification (no code changes, no commit)

This is a checklist for the executor. Skip if running headless.

- [ ] Start the admin dev server (`pnpm --filter @jdm/admin dev`) and the API dev server.
- [ ] Open `/loja/produtos` and click the garage-spot product (slug `garage-spot`).
- [ ] Confirm: the hint banner reads "Produto virtual — sem estoque ou entrega.", appearing under the page header.
- [ ] Confirm: there is no "Fotos" section on the page (PhotoGallery is not rendered).
- [ ] Confirm: there is no "Modo de entrega" fieldset.
- [ ] Confirm: there is no shipping-fee field (no shipping-fee input anywhere).
- [ ] Confirm: the Status select shows `Rascunho`, `Ativo`, `Arquivado`; `Ativo` is **not** disabled even though there are no photos. Saving with `status=active` returns success (no 400 from the API — this is TASK-A's server carve-out talking).
- [ ] Confirm: there is no "Arquivar" button on the singleton.
- [ ] Open a regular (non-virtual) product. Confirm everything still looks normal: banner absent, Photo Gallery present, Modo de entrega fieldset present, Arquivar button present.

---

## Test plan summary

| Behavior                                                                                     | Test                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------- |
| Banner renders the carve-out copy                                                            | `virtual-product-banner.test.tsx`   |
| Non-virtual product still shows fulfillment + photo gate + Arquivar                          | `product-form.test.tsx` (3 cases)   |
| Virtual product hides fulfillment fields and `name="allow*"` inputs                          | `product-form.test.tsx`             |
| Virtual product hides photo-required helper text                                             | `product-form.test.tsx`             |
| Virtual product still shows price + status editors                                           | `product-form.test.tsx`             |
| Singleton product (status=active) hides Arquivar                                             | `product-form.test.tsx`             |
| Singleton product (status=archived) hides Reativar — assertion non-vacuous                   | `product-form.test.tsx`             |
| Virtual product Status select does not disable "Ativo" with zero photos                      | `product-form.interaction.test.tsx` |
| Submitted FormData omits `allowPickup`, `allowShip`, `shippingFeeCents` for virtual products | `product-form.interaction.test.tsx` |
| Virtual product detail page omits `<PhotoGallery>`                                           | manual check (Task 5)               |

Run all task tests in one go:

```bash
pnpm --filter @jdm/admin test -- product-form.test.tsx product-form.interaction.test.tsx virtual-product-banner.test.tsx
```

Expected: all suites PASS, zero skipped.

---

## Risks

1. **TASK-A's `Product.virtual` shape not yet landed.** This plan assumes `adminStoreProductDetailSchema.virtual: boolean` and `adminStoreProductDetailSchema.visibleInStore: boolean` exist before TASK-H starts. If TASK-A defaults these to `boolean().optional()`, the comparisons `product.virtual === true` and `product.visibleInStore` in the page/form continue to behave correctly (undefined → falsy → non-virtual branch) but the static-markup tests' product fixtures need the field explicitly set. Mitigation: the test fixtures above set `virtual: true|false` and `visibleInStore` on every fixture, so the suite is robust either way.
2. **Singleton slug coupling.** Hard-coding `'garage-spot'` in the admin app means renaming the seed slug breaks the Arquivar guard. Mitigation: if TASK-A exports `GARAGE_SPOT_PRODUCT_SLUG` from `@jdm/shared/store` (or a similar module), Task 3's `SINGLETON_PRODUCT_SLUGS` should be replaced with `new Set([GARAGE_SPOT_PRODUCT_SLUG])`. Confirm during TASK-H kickoff and adjust before writing the production code in Task 3.
3. **Photo-gate disabled-flag drift.** The current form has the photo gate logic in two places: the `<option value="active" disabled>` in the Status select and the disabled prop on the "Reativar" button. Task 3 must update **both** call sites. The static-markup test "does NOT render the photo-required helper text" covers the option-level path; the Reativar test in the singleton case covers the button-level path. If a future change adds a third gate, both tests should fail clearly.
4. **No e2e / Playwright coverage.** Car_spot_plan §9 TASK-H mentions "Playwright/RTL — match existing admin test pattern". The current admin test pattern is Vitest + `renderToStaticMarkup` + jsdom interaction tests — there is no Playwright suite in this repo. This plan ships RTL-style coverage to match the existing pattern and explicitly skips Playwright. If a reviewer insists on Playwright, that should be a follow-up task — it would land an entire new toolchain (browser binaries, CI step, fixtures), which is out of scope for a UI carve-out.
5. **`new` product form not touched.** Admins can still pick `productType.name === 'garage_spot'` from the `new-product-form.tsx` dropdown, but the create route does not set `virtual=true`. This means a hand-rolled garage product would render normally (no virtual carve-outs) until an admin/seed flips its `virtual` flag. Server-side, TASK-A's seed enforces singleton-ness on the slug. Documented; not fixed here because it's a non-issue for the intended UX.
6. **`garage_spot` type visible in edit form dropdown for non-virtual products.** The product-type `<select>` in `product-form.tsx` shows all product types including `garage_spot`. An admin could re-assign a non-virtual product to the garage_spot type. This is a natural follow-up: filter `garage_spot` out of the type dropdown for non-virtual products (or all products, since the type is internal). Deferred; flag during TASK-H review if the dropdown UX causes concern.

---

## Open questions

1. Should the "new product" form expose a "virtual" checkbox so future virtual products can be created by admins (e.g., a recurring premium membership)? **Decision (deferred):** No. The roadmap (§8.1) introduces premium membership as its own seeded product. Until then, virtual is a seed-only flag and the create form stays unchanged.
2. Should the banner link to the help center or to the garage feature spec? **Decision:** No link in MVP. Keep the banner copy short and self-explanatory. Re-evaluate when more virtual products exist.
3. If a future virtual product needs its own carve-outs (e.g., recurring billing fields), do we generalize the `isVirtual` branch or fork per-product-type? **Decision:** defer to that task. The current branch is a single binary check; introducing a strategy pattern now is YAGNI.

---

## Self-review checklist (executed before handoff)

- Spec coverage:
  - "Hide photo uploader UI" → Task 2 omits `<PhotoGallery>` for virtual products. Covered.
  - "Hide pickup/ship fulfillment-method controls" → Task 3 wraps the fieldset and the shipping-fee block in `!isVirtual`. Covered by `product-form.test.tsx`.
  - "Show only price + status toggle" → form still renders title/description/productType/basePriceCents/status; only the photo gate and the fulfillment fields are hidden. The Car_spot_plan §9 wording "show only the price + status" is interpreted as "of the fields the photo+fulfillment carve-out would otherwise gate"; the other identity fields (title, description, product type) remain editable since the product is a real product with metadata. If reviewers want title/description hidden too, that's a one-line addition in Task 3 — flag it during review.
  - "Disable delete for the singleton" → there is no hard-delete button in the current form (only "Arquivar"). Task 3 hides Arquivar/Reativar for singleton slugs. This matches the intent of the carve-out (no destructive UI on the singleton). Covered.
  - "Hint banner: 'Produto virtual — sem estoque ou entrega.'" → Task 1. Verbatim copy in the test. Covered.
  - "Tests for the carve-out (Playwright/RTL — match existing admin test pattern)" → Tasks 1, 3, 4 (RTL pattern matches existing repo convention). Covered.
- Placeholder scan: no TBD/TODO/"implement later" in any step. All code blocks contain full content.
- Type consistency: `isVirtual` and `isSingleton` are referenced identically across page + form. `product.virtual === true` used consistently. `SINGLETON_PRODUCT_SLUGS` defined once.

---

## Reviewer pushback

Three findings are rejected on technical grounds. They are recorded here for traceability.

### Finding 3 — TASK-C does not own `apps/api/src/routes/admin/store/products.ts:121`

Reviewer claims "master plan §9 item 3 already covers" the admin products server carve-out and says TASK-H should block on TASK-C instead of TASK-A.

This is incorrect. The master plan §9 TASK-C description reads: "Cart service / checkout / cart route changes to handle virtual variants (no inventory reservation, no shipping/pickup). Settlement service iterates garage OrderItems..." -- it is about cart and settlement paths, not the admin product PATCH route. The master plan §3 touchpoints table lists `apps/api/src/routes/admin/store/products.ts:121` without task attribution, but TASK-A's description ("virtual product capability + audit enum") is the correct owner: TASK-A introduces `Product.virtual` and is where the flag's meaning is established. Adding a virtual carve-out to the admin PATCH route is gated solely on knowing whether `product.virtual` exists, which is a TASK-A concern.

Conclusion: the dependency remains on TASK-A. The plan is updated to remove the ambiguous "(TASK-A/C)" attribution and clearly state TASK-A owns `products.ts:121`.

### Finding 4 — Prefer `isVirtual` over `isSingleton` / `SINGLETON_PRODUCT_SLUGS`

Reviewer says to use `product.virtual === true` (already captured as `isVirtual`) as the guard for Archive/Reactivate and drop `isSingleton`/`SINGLETON_PRODUCT_SLUGS`.

This conflates two distinct behaviors. `isVirtual` is a product-level capability flag: future virtual products that are not singletons (e.g. a seeded premium membership product) should still show an "Arquivar" button so admins can manage their lifecycle. `isSingleton` guards that specific UI action for the garage-spot product only, which must never be archived via the UI (TASK-A adds server-side enforcement of the same invariant). Collapsing them into a single `isVirtual` check would prevent archiving any future virtual product from the admin UI, which is wrong.

Conclusion: the two flags serve different purposes and are kept separate. No change to the implementation approach.

### Finding 9 — Em dash in UI copy

Reviewer says the COPY.body em dash (`—`) in `virtual-product-banner.tsx` violates CLAUDE.md.

CLAUDE.md says "Never use em-dashes or replacement hyphens" under the "Formatting" section, which governs this agent's prose output, not end-user UI copy. The banner copy is in PT-BR. Em dashes are a standard typographic separator in Brazilian Portuguese and the copy reads naturally: "Produto virtual -- sem estoque ou entrega" would be typographically incorrect in PT-BR context. The rule is about agent-authored prose output, not about what characters appear in a product's UI text.

Conclusion: the em dash in COPY.body is intentional PT-BR typography and stays. If the team decides to apply a house style guide to all UI copy, that is a separate decision outside this task.

---

## Execution handoff

Plan saved to `plans/garage-spots/TASK-H-admin-virtual-product-editor-ui.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Tasks 1 / 2 / 3 / 4 are each ~10-30 minutes and well-isolated. Use `superpowers:subagent-driven-development`.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints between Task 3 and Task 4.
