# Box Builder — Fase 3b-2a (mobile: builder do catálogo) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a tela do assinante montar a caixa do ciclo (telas 02/03) sobre a fundação da 3b-1, com estado otimista, PUT debounced da seleção e a barra de budget animada.

**Architecture:** Lógica pura de totais otimistas e estado dos cards em módulos testáveis; um hook controlador (`useBoxBuilder`) segura a seleção, faz PUT debounced e reconcilia os totais do servidor; a tela `montar.tsx` compõe tudo. Uma mudança pequena de API expõe `shippingAddressId` no `BoxView` (fecha a base dos achados de endereço adiados). Inclui as limpezas menores da 3b-1 e o ponto de entrada de preferências.

**Tech Stack:** Expo Router, React 19 / RN 0.81, NativeWind, Zod compartilhado, Vitest (jsdom + Probe pra hooks). Fastify + Prisma + Testcontainers pra API.

## Global Constraints

- Idioma PT-BR. Dinheiro sempre `R$ 1.234,56` via `formatBRL` (nunca `Intl` no cliente).
- A feature continua atrás de `EXPO_PUBLIC_CAIXA_ENABLED` (default OFF). Este plano NÃO liga o flag.
- Sem dependências novas. O app não tem `expo-haptics`, `netinfo` nem `reanimated`. Háptico fica fora desta fase (mesma simplificação que a 3b-1 fez pra conectividade). A barra anima com o `Animated` do core do RN, `useNativeDriver: false`.
- Dinheiro é Int em centavos. Totais otimistas do cliente só animam a barra; a verdade são os totais do servidor, reconciliados na resposta de cada PUT.
- Orders nunca viram `paid` aqui (Fase 4).
- `PUT /me/box/selection` substitui a seleção inteira (last-write-wins). Debounced; flush no blur/unmount, nunca cancela. O controlador preserva `partnerItems` mesmo sem UI de parceiro nesta fase (senão o PUT zera a seleção de parceiro).
- `chargeCents` enquanto `open` não inclui frete; o builder não mostra frete.
- Sem React Query/SWR. Hooks próprios com `useState`/`useEffect`.
- Gate obrigatório por task: `pnpm -C apps/mobile exec tsc --noEmit` (mobile) e `pnpm -C packages/shared exec tsc --noEmit` + `pnpm -C apps/api exec tsc --noEmit` (tasks de API). Rodar os testes da área tocada.
- Testes de integração da API batem no Postgres real (Testcontainers), nunca mocks.

## Escopo desta fase (3b-2a)

Dentro: mudança de API `shippingAddressId`; limpezas 3b-1; `useBoxCatalog`; lógica pura de builder; `useBoxBuilder`; tela 02/03 (builder do catálogo) substituindo o placeholder `montar.tsx`; ponto de entrada de preferências no header da home.

Fora (3b-2b): parceiros (tela 04), revisão + endereço (tela 05), persistência offline (AsyncStorage + reenvio ao reconectar), ligar o flag. O CTA "Revisar e confirmar" desta fase aponta pra um placeholder `revisar.tsx` (substituído na 3b-2b).

## Estrutura de arquivos

- Modificar `packages/shared/src/box.ts` — `shippingAddressId` no `boxViewSchema`.
- Modificar `apps/api/src/services/box/serialize.ts` — serializa o campo.
- Modificar `apps/api/test/box/box-view-enrichment.test.ts` — asserção Testcontainers.
- Modificar `apps/mobile/src/screens/caixa/box-state.ts` — remove `'post_cutoff'` da union.
- Modificar `apps/mobile/app/(app)/caixa/index.tsx` — reuso de `includedCents`, remove override no-op, gear de preferências.
- Modificar `apps/mobile/src/api/box.test.ts` — teste direto de `unskipBox`.
- Criar `apps/mobile/src/hooks/useBoxCatalog.ts` (+ teste).
- Criar `apps/mobile/src/screens/caixa/builder-selection.ts` (+ teste) — lógica pura.
- Criar `apps/mobile/src/hooks/useBoxBuilder.ts` (+ teste) — controlador.
- Modificar `apps/mobile/src/screens/caixa/BudgetMeter.tsx` — prop `animated`.
- Criar `apps/mobile/src/screens/caixa/CatalogItemCard.tsx`.
- Substituir `apps/mobile/app/(app)/caixa/montar.tsx` — builder real.
- Criar `apps/mobile/app/(app)/caixa/revisar.tsx` — placeholder.
- Modificar `apps/mobile/src/copy/caixa.ts` — namespace `builder`.

---

### Task 1: API — expor `shippingAddressId` no `BoxView`

Fecha a base dos achados de endereço adiados da 3b-1: a tela de preferências (e depois a revisão) precisa semear o endereço realmente salvo na caixa, não o default da conta.

**Files:**

- Modify: `packages/shared/src/box.ts:36-51` (`boxViewSchema`)
- Modify: `apps/api/src/services/box/serialize.ts:13-25`
- Test: `apps/api/test/box/box-view-enrichment.test.ts`

**Interfaces:**

- Produces: `BoxView.shippingAddressId: string | null` (consumido na 3b-2b pela tela de revisão e pela correção de preferências).

- [ ] **Step 1: Escrever asserção que falha (Testcontainers)**

No `box-view-enrichment.test.ts`, adicionar um teste que cria um `ShippingAddress` do usuário, seta `shippingAddressId` na `MonthlyBox` criada, e checa o retorno. Usar o mesmo setup de `createUser`/`membership`/`MonthlyBox` já presente no arquivo.

```ts
it('exposes the box shippingAddressId (null when unset)', async () => {
  const { user, token } = await createUser({ verified: true });
  const garage = await prisma.garage.findUniqueOrThrow({ where: { userId: user.id } });
  const address = await prisma.shippingAddress.create({
    data: {
      garageId: garage.id,
      recipient: 'Fulano',
      line1: 'Rua A, 100',
      district: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      postalCode: '01000-000',
    },
  });
  await prisma.premiumMembership.create({
    data: {
      garageId: garage.id,
      provider: 'stripe',
      providerCustomerRef: 'cus_addr',
      providerSubRef: `sub_addr_${user.id}`,
      tier: 'gold',
      cadence: 'monthly',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-08-31T00:00:00.000Z'),
      baseAmountCents: 5000,
      devFeePercent: 10,
      devFeeAmountCents: 500,
      grossAmountCents: 5500,
      currency: 'BRL',
    },
  });
  await prisma.monthlyBox.create({
    data: {
      garageId: garage.id,
      cycleKey: '2026-08-01',
      cycleStart: new Date('2026-08-01T00:00:00.000Z'),
      cutoffAt: new Date('2026-08-25T00:00:00.000Z'),
      status: 'open',
      budgetCentsSnapshot: 45000,
      currency: 'BRL',
      shippingAddressId: address.id,
    },
  });

  const res = await app.inject({
    method: 'GET',
    url: '/me/box',
    headers: bearer(token),
  });

  expect(res.statusCode).toBe(200);
  expect(res.json().shippingAddressId).toBe(address.id);
});
```

Confirmar o shape exato de `ShippingAddress`/`MonthlyBox.create` lendo os outros testes/o schema Prisma antes de rodar; ajustar campos obrigatórios se o schema divergir.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm -C apps/api exec vitest run test/box/box-view-enrichment.test.ts`
Expected: FAIL — `shippingAddressId` é `undefined` (schema Zod ainda não expõe / serialize não emite).

- [ ] **Step 3: Adicionar ao schema compartilhado**

Em `packages/shared/src/box.ts`, dentro de `boxViewSchema`, logo após `autoSendOptIn: z.boolean(),`:

```ts
  shippingAddressId: z.string().nullable(),
```

- [ ] **Step 4: Serializar no backend**

Em `apps/api/src/services/box/serialize.ts`, no objeto retornado por `serializeBox`, após `autoSendOptIn: box.autoSendOptIn,`:

```ts
  shippingAddressId: box.shippingAddressId,
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm -C apps/api exec vitest run test/box/box-view-enrichment.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate de tsc**

Run: `pnpm -C packages/shared exec tsc --noEmit && pnpm -C apps/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/box.ts apps/api/src/services/box/serialize.ts apps/api/test/box/box-view-enrichment.test.ts
git commit -m "feat(box): expose shippingAddressId on BoxView"
```

---

### Task 2: Limpezas menores da 3b-1

Carry-forwards fechados: union morta em `homeVariant`, reuso de `includedCents`, override de estilo no-op, teste direto de `unskipBox`.

**Files:**

- Modify: `apps/mobile/src/screens/caixa/box-state.ts:5-13`
- Modify: `apps/mobile/app/(app)/caixa/index.tsx` (`OpenBody`, `lineRowDropped`)
- Test: `apps/mobile/src/api/box.test.ts`

- [ ] **Step 1: Teste direto de `unskipBox`**

Adicionar ao `box.test.ts` (seguir o padrão dos outros testes de client no arquivo, que mockam `authedRequest`):

```ts
it('unskipBox POSTs /me/box/unskip and resolves void', async () => {
  authedRequestMock.mockResolvedValueOnce(null);
  await expect(unskipBox()).resolves.toBeUndefined();
  expect(authedRequestMock).toHaveBeenCalledWith('/me/box/unskip', expect.anything(), {
    method: 'POST',
  });
});
```

Importar `unskipBox` no bloco de imports do teste se ainda não estiver. Casar o nome do mock (`authedRequestMock`) com o já usado no arquivo.

- [ ] **Step 2: Rodar e ver passar (ou ajustar ao padrão do arquivo)**

Run: `pnpm -C apps/mobile exec vitest run src/api/box.test.ts`
Expected: PASS.

- [ ] **Step 3: Remover `'post_cutoff'` da union de `homeVariant`**

`homeVariant` nunca retorna `'post_cutoff'` (não existe no enum de status). Em `box-state.ts`:

```ts
export function homeVariant(status: BoxStatus): 'open' | 'skipped' | 'awaiting_payment' | 'ready' {
  if (status === 'cancelled') {
    return 'skipped';
  }
  return status;
}
```

Verificar os consumidores em `caixa/index.tsx`: nenhum `case 'post_cutoff'` deve existir num switch sobre `homeVariant`. Se existir código morto de `post_cutoff`, deixá-lo intacto se vier de outra fonte; caso contrário remover o branch inalcançável. Rodar tsc pra confirmar exaustividade.

- [ ] **Step 4: Reusar `includedCents` no `OpenBody`**

Em `caixa/index.tsx`, importar `budgetMeter` de `~/screens/caixa/box-state` (se ainda não importado) e trocar:

```ts
const includedCents = Math.min(box.itemsTotalCents, box.budgetCents);
```

por:

```ts
const includedCents = budgetMeter(box).includedCents;
```

- [ ] **Step 5: Remover override no-op de estilo**

Em `caixa/index.tsx`, no `StyleSheet`, `lineRowDropped` seta `borderBottomColor: BORDER_GOLD_SOFT`, igual ao `lineRow`. Remover a linha redundante do `lineRowDropped` (manter as demais props do estilo, se houver). Se `lineRowDropped` ficar vazio e não for usado, manter o objeto vazio referenciado ou remover a referência de forma consistente; não alterar o comportamento visual.

- [ ] **Step 6: Testes + tsc**

Run: `pnpm -C apps/mobile exec vitest run src/screens/caixa/box-state.test.ts src/api/box.test.ts && pnpm -C apps/mobile exec tsc --noEmit`
Expected: PASS, sem erros de tsc. Os testes de home existentes continuam verdes.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/caixa/box-state.ts "apps/mobile/app/(app)/caixa/index.tsx" apps/mobile/src/api/box.test.ts
git commit -m "refactor(mobile): close 3b-1 caixa cleanups"
```

---

### Task 3: Hook `useBoxCatalog`

**Files:**

- Create: `apps/mobile/src/hooks/useBoxCatalog.ts`
- Test: `apps/mobile/src/hooks/useBoxCatalog.test.tsx`

**Interfaces:**

- Consumes: `getBoxCatalog` de `~/api/box`.
- Produces: `useBoxCatalog(enabled?): { catalog: BoxCatalog | null; loading: boolean; error: boolean; refresh: () => Promise<void> }`.

- [ ] **Step 1: Teste que falha (Probe + jsdom)**

Espelhar o teste de `useBox`. Mockar `~/api/box` (`getBoxCatalog`). Casos: sucesso popula `catalog`; rejeição seta `error`.

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getBoxCatalog = vi.fn();
vi.mock('~/api/box', () => ({ getBoxCatalog: () => getBoxCatalog() }));

import { useBoxCatalog } from './useBoxCatalog';

let snap: ReturnType<typeof useBoxCatalog>;
function Probe() {
  snap = useBoxCatalog();
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => getBoxCatalog.mockReset());

describe('useBoxCatalog', () => {
  it('loads the catalog', async () => {
    getBoxCatalog.mockResolvedValueOnce({ categories: [], items: [], partners: [] });
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap.loading).toBe(false);
    expect(snap.catalog).toEqual({ categories: [], items: [], partners: [] });
    expect(snap.error).toBe(false);
  });

  it('sets error on failure', async () => {
    getBoxCatalog.mockRejectedValueOnce(new Error('net'));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap.error).toBe(true);
    expect(snap.catalog).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm -C apps/mobile exec vitest run src/hooks/useBoxCatalog.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o hook**

```ts
import type { BoxCatalog } from '@ccc/shared/box';
import { useCallback, useEffect, useState } from 'react';

import { getBoxCatalog } from '~/api/box';

type UseBoxCatalogResult = {
  catalog: BoxCatalog | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
};

export function useBoxCatalog(enabled = true): UseBoxCatalogResult {
  const [catalog, setCatalog] = useState<BoxCatalog | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(false);
    try {
      setCatalog(await getBoxCatalog());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { catalog, loading, error, refresh };
}
```

- [ ] **Step 4: Rodar e ver passar + tsc**

Run: `pnpm -C apps/mobile exec vitest run src/hooks/useBoxCatalog.test.tsx && pnpm -C apps/mobile exec tsc --noEmit`
Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useBoxCatalog.ts apps/mobile/src/hooks/useBoxCatalog.test.tsx
git commit -m "feat(mobile): useBoxCatalog hook"
```

---

### Task 4: Lógica pura do builder (`builder-selection.ts`)

Toda a matemática otimista e o estado dos cards ficam aqui, puros e testados. A tela e o hook só compõem.

**Files:**

- Create: `apps/mobile/src/screens/caixa/builder-selection.ts`
- Test: `apps/mobile/src/screens/caixa/builder-selection.test.ts`

**Interfaces:**

- Consumes: `BoxView`, `BoxCatalog`, `BoxSelectionUpdate` de `@ccc/shared/box`.
- Produces:
  - `type SelectionMap = Record<string, number>`
  - `seedSelection(box): { items: SelectionMap; partners: SelectionMap }`
  - `buildPriceIndex(box, catalog): { items: Record<string, number>; partners: Record<string, number> }`
  - `computeOptimisticTotals(items, partners, prices, budgetCents): OptimisticTotals`
  - `toSelectionUpdate(items, partners): BoxSelectionUpdate`
  - `filterByCategory(items, category | null): BoxCatalog['items']`
  - `summaryState(totals): { collapsed: boolean; catalogCount: number }`

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest';

import {
  buildPriceIndex,
  computeOptimisticTotals,
  filterByCategory,
  seedSelection,
  summaryState,
  toSelectionUpdate,
} from './builder-selection';

const box = {
  budgetCents: 45000,
  items: [
    { catalogItemId: 'a', quantity: 2, unitPriceCents: 10000 },
    { catalogItemId: 'gone', quantity: 1, unitPriceCents: 5000 },
  ],
  partnerItems: [{ partnerModuleId: 'p1', quantity: 1, unitPriceCents: 8000 }],
} as never;

const catalog = {
  categories: ['acessorios'],
  items: [
    {
      id: 'a',
      title: 'A',
      category: 'acessorios',
      priceCents: 12000,
      imageUrl: null,
      maxPerCycle: null,
      soldOut: false,
    },
    {
      id: 'b',
      title: 'B',
      category: 'oleo',
      priceCents: 20000,
      imageUrl: null,
      maxPerCycle: null,
      soldOut: false,
    },
  ],
  partners: [
    {
      id: 'pa',
      name: 'PA',
      logoUrl: null,
      description: null,
      modules: [{ id: 'p1', name: 'M', description: null, imageUrl: null, priceCents: 8000 }],
    },
  ],
} as never;

describe('seedSelection', () => {
  it('seeds item and partner qty maps from the box', () => {
    expect(seedSelection(box)).toEqual({
      items: { a: 2, gone: 1 },
      partners: { p1: 1 },
    });
  });
});

describe('buildPriceIndex', () => {
  it('prefers the box line snapshot, falls back to catalog price', () => {
    const idx = buildPriceIndex(box, catalog);
    // existing line 'a' keeps the snapshot 10000, not catalog 12000
    expect(idx.items.a).toBe(10000);
    // new item 'b' uses catalog price
    expect(idx.items.b).toBe(20000);
    expect(idx.partners.p1).toBe(8000);
  });
});

describe('computeOptimisticTotals', () => {
  it('computes overflow and charge (partners excluded from budget)', () => {
    const prices = { items: { a: 10000, b: 20000 }, partners: { p1: 8000 } };
    // items: a x5 = 50000 (budget 45000) -> overflow 5000; partner p1 x1 = 8000
    const t = computeOptimisticTotals({ a: 5 }, { p1: 1 }, prices, 45000);
    expect(t.itemsTotalCents).toBe(50000);
    expect(t.includedCents).toBe(45000);
    expect(t.overflowCents).toBe(5000);
    expect(t.partnersTotalCents).toBe(8000);
    expect(t.chargeCents).toBe(13000); // overflow + partners, sem frete
  });

  it('is zero-charge within budget', () => {
    const prices = { items: { a: 10000 }, partners: {} };
    const t = computeOptimisticTotals({ a: 3 }, {}, prices, 45000);
    expect(t.overflowCents).toBe(0);
    expect(t.chargeCents).toBe(0);
  });
});

describe('toSelectionUpdate', () => {
  it('drops zero quantities and shapes the PUT payload', () => {
    expect(toSelectionUpdate({ a: 2, b: 0 }, { p1: 1, p2: 0 })).toEqual({
      items: [{ catalogItemId: 'a', quantity: 2 }],
      partnerItems: [{ partnerModuleId: 'p1', quantity: 1 }],
    });
  });
});

describe('filterByCategory', () => {
  it('returns all when category is null, filters otherwise', () => {
    expect(filterByCategory(catalog.items, null)).toHaveLength(2);
    expect(filterByCategory(catalog.items, 'oleo').map((i: { id: string }) => i.id)).toEqual(['b']);
  });
});

describe('summaryState', () => {
  it('collapses when charge is zero', () => {
    expect(summaryState({ chargeCents: 0, catalogCount: 3 } as never).collapsed).toBe(true);
    expect(summaryState({ chargeCents: 100, catalogCount: 3 } as never).collapsed).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm -C apps/mobile exec vitest run src/screens/caixa/builder-selection.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o módulo puro**

```ts
import type { BoxCatalog, BoxSelectionUpdate, BoxView } from '@ccc/shared/box';

export type SelectionMap = Record<string, number>;

export type PriceIndex = {
  items: Record<string, number>;
  partners: Record<string, number>;
};

export type OptimisticTotals = {
  itemsTotalCents: number;
  includedCents: number;
  overflowCents: number;
  partnersTotalCents: number;
  chargeCents: number;
  catalogCount: number;
};

export function seedSelection(box: Pick<BoxView, 'items' | 'partnerItems'>): {
  items: SelectionMap;
  partners: SelectionMap;
} {
  const items: SelectionMap = {};
  for (const line of box.items) items[line.catalogItemId] = line.quantity;
  const partners: SelectionMap = {};
  for (const line of box.partnerItems) partners[line.partnerModuleId] = line.quantity;
  return { items, partners };
}

// Existing lines keep the box snapshot price (R14). New items use the catalog
// price. Partner modules always use the catalog price.
export function buildPriceIndex(
  box: Pick<BoxView, 'items' | 'partnerItems'>,
  catalog: Pick<BoxCatalog, 'items' | 'partners'>,
): PriceIndex {
  const items: Record<string, number> = {};
  for (const c of catalog.items) items[c.id] = c.priceCents;
  for (const line of box.items) items[line.catalogItemId] = line.unitPriceCents;

  const partners: Record<string, number> = {};
  for (const p of catalog.partners) {
    for (const m of p.modules) partners[m.id] = m.priceCents;
  }
  for (const line of box.partnerItems) partners[line.partnerModuleId] = line.unitPriceCents;

  return { items, partners };
}

export function computeOptimisticTotals(
  items: SelectionMap,
  partners: SelectionMap,
  prices: PriceIndex,
  budgetCents: number,
): OptimisticTotals {
  let itemsTotalCents = 0;
  let catalogCount = 0;
  for (const [id, qty] of Object.entries(items)) {
    if (qty <= 0) continue;
    itemsTotalCents += (prices.items[id] ?? 0) * qty;
    catalogCount += qty;
  }
  let partnersTotalCents = 0;
  for (const [id, qty] of Object.entries(partners)) {
    if (qty <= 0) continue;
    partnersTotalCents += (prices.partners[id] ?? 0) * qty;
  }
  const includedCents = Math.min(itemsTotalCents, budgetCents);
  const overflowCents = Math.max(0, itemsTotalCents - budgetCents);
  const chargeCents = overflowCents + partnersTotalCents;
  return {
    itemsTotalCents,
    includedCents,
    overflowCents,
    partnersTotalCents,
    chargeCents,
    catalogCount,
  };
}

export function toSelectionUpdate(items: SelectionMap, partners: SelectionMap): BoxSelectionUpdate {
  return {
    items: Object.entries(items)
      .filter(([, q]) => q > 0)
      .map(([catalogItemId, quantity]) => ({ catalogItemId, quantity })),
    partnerItems: Object.entries(partners)
      .filter(([, q]) => q > 0)
      .map(([partnerModuleId, quantity]) => ({ partnerModuleId, quantity })),
  };
}

export function filterByCategory(
  items: BoxCatalog['items'],
  category: string | null,
): BoxCatalog['items'] {
  if (category === null) return items;
  return items.filter((i) => i.category === category);
}

export function summaryState(totals: Pick<OptimisticTotals, 'chargeCents' | 'catalogCount'>): {
  collapsed: boolean;
  catalogCount: number;
} {
  return { collapsed: totals.chargeCents === 0, catalogCount: totals.catalogCount };
}
```

- [ ] **Step 4: Rodar e ver passar + tsc**

Run: `pnpm -C apps/mobile exec vitest run src/screens/caixa/builder-selection.test.ts && pnpm -C apps/mobile exec tsc --noEmit`
Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/caixa/builder-selection.ts apps/mobile/src/screens/caixa/builder-selection.test.ts
git commit -m "feat(mobile): pure box builder selection logic"
```

---

### Task 5: Hook controlador `useBoxBuilder`

Segura a seleção otimista, faz PUT debounced da seleção inteira, reconcilia os totais do servidor e faz flush no blur/unmount.

**Files:**

- Create: `apps/mobile/src/hooks/useBoxBuilder.ts`
- Test: `apps/mobile/src/hooks/useBoxBuilder.test.tsx`

**Interfaces:**

- Consumes: `updateBoxSelection` de `~/api/box`; `builder-selection` (Task 4).
- Produces: `useBoxBuilder(box, catalog): { items; partners; totals; setItemQty; setPartnerQty; flush; writeError; retry }`.

**Notas de design:**

- Debounce de 600ms via `setTimeout` em `useRef`. Cada mutação reagenda.
- `flush()` cancela o timer e envia imediatamente o pendente; usado no blur/unmount. Cleanup do `useEffect` chama `flush()` (não cancela silenciosamente).
- Na resposta OK, reconcilia `totals` a partir do `BoxView` do servidor mas MANTÉM a seleção local (last-write-wins). Erro -> `writeError = true`, mantém pendente; `retry()` reenvia.
- `partners` são semeados e preservados mesmo sem UI nesta fase.

- [ ] **Step 1: Escrever os testes que falham (fake timers)**

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateBoxSelection = vi.fn();
vi.mock('~/api/box', () => ({ updateBoxSelection: (p: unknown) => updateBoxSelection(p) }));

import { useBoxBuilder } from './useBoxBuilder';

const box = {
  budgetCents: 45000,
  itemsTotalCents: 0,
  partnersTotalCents: 0,
  overflowCents: 0,
  items: [],
  partnerItems: [],
} as never;
const catalog = {
  categories: [],
  items: [
    {
      id: 'a',
      title: 'A',
      category: 'c',
      priceCents: 10000,
      imageUrl: null,
      maxPerCycle: null,
      soldOut: false,
    },
  ],
  partners: [],
} as never;

let api: ReturnType<typeof useBoxBuilder>;
function Probe() {
  api = useBoxBuilder(box, catalog);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  updateBoxSelection.mockReset().mockResolvedValue(box);
});
afterEach(() => vi.useRealTimers());

describe('useBoxBuilder', () => {
  it('debounces a single PUT after quiet period', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    await act(async () => {
      api.setItemQty('a', 2);
    });
    expect(updateBoxSelection).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);
    expect(updateBoxSelection).toHaveBeenCalledWith({
      items: [{ catalogItemId: 'a', quantity: 2 }],
      partnerItems: [],
    });
  });

  it('flush sends immediately', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    await act(async () => {
      await api.flush();
    });
    expect(updateBoxSelection).toHaveBeenCalledTimes(1);
  });

  it('sets writeError when the PUT rejects', async () => {
    updateBoxSelection.mockRejectedValueOnce(new Error('net'));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      api.setItemQty('a', 1);
    });
    await act(async () => {
      await api.flush();
    });
    expect(api.writeError).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm -C apps/mobile exec vitest run src/hooks/useBoxBuilder.test.tsx`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o hook**

```ts
import type { BoxCatalog, BoxView } from '@ccc/shared/box';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { updateBoxSelection } from '~/api/box';

import {
  buildPriceIndex,
  computeOptimisticTotals,
  seedSelection,
  toSelectionUpdate,
  type OptimisticTotals,
  type SelectionMap,
} from '~/screens/caixa/builder-selection';

const DEBOUNCE_MS = 600;

type UseBoxBuilder = {
  items: SelectionMap;
  partners: SelectionMap;
  totals: OptimisticTotals;
  setItemQty: (id: string, qty: number) => void;
  setPartnerQty: (id: string, qty: number) => void;
  flush: () => Promise<void>;
  writeError: boolean;
  retry: () => Promise<void>;
};

export function useBoxBuilder(box: BoxView, catalog: BoxCatalog): UseBoxBuilder {
  const seed = useMemo(() => seedSelection(box), [box]);
  const prices = useMemo(() => buildPriceIndex(box, catalog), [box, catalog]);

  const [items, setItems] = useState<SelectionMap>(seed.items);
  const [partners, setPartners] = useState<SelectionMap>(seed.partners);
  const [writeError, setWriteError] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest selection, read at flush time (avoids stale closures).
  const latest = useRef({ items, partners });
  latest.current = { items, partners };

  const send = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setWriteError(false);
    try {
      await updateBoxSelection(toSelectionUpdate(latest.current.items, latest.current.partners));
    } catch {
      setWriteError(true);
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void send();
    }, DEBOUNCE_MS);
  }, [send]);

  const setItemQty = useCallback(
    (id: string, qty: number) => {
      setItems((prev) => ({ ...prev, [id]: Math.max(0, qty) }));
      schedule();
    },
    [schedule],
  );

  const setPartnerQty = useCallback(
    (id: string, qty: number) => {
      setPartners((prev) => ({ ...prev, [id]: Math.max(0, qty) }));
      schedule();
    },
    [schedule],
  );

  // Flush on unmount — never cancel silently.
  useEffect(() => {
    return () => {
      if (timer.current) void send();
    };
  }, [send]);

  const totals = useMemo(
    () => computeOptimisticTotals(items, partners, prices, box.budgetCents),
    [items, partners, prices, box.budgetCents],
  );

  return {
    items,
    partners,
    totals,
    setItemQty,
    setPartnerQty,
    flush: send,
    writeError,
    retry: send,
  };
}
```

- [ ] **Step 4: Rodar e ver passar + tsc**

Run: `pnpm -C apps/mobile exec vitest run src/hooks/useBoxBuilder.test.tsx && pnpm -C apps/mobile exec tsc --noEmit`
Expected: PASS, sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useBoxBuilder.ts apps/mobile/src/hooks/useBoxBuilder.test.tsx
git commit -m "feat(mobile): useBoxBuilder debounced selection controller"
```

---

### Task 6: Tela do builder (02/03) + card + barra animada

Substitui o placeholder `montar.tsx`. Compõe `useBox` + `useBoxCatalog` + `useBoxBuilder` + a lógica pura. Sem háptico nesta fase.

**Files:**

- Modify: `apps/mobile/src/screens/caixa/BudgetMeter.tsx` (prop `animated`)
- Create: `apps/mobile/src/screens/caixa/CatalogItemCard.tsx`
- Replace: `apps/mobile/app/(app)/caixa/montar.tsx`
- Create: `apps/mobile/app/(app)/caixa/revisar.tsx` (placeholder)
- Modify: `apps/mobile/src/copy/caixa.ts` (namespace `builder`)

**Interfaces:**

- Consumes: hooks e módulos das Tasks 3-5; `QuantityStepper` de `~/screens/buy/per-ticket-wizard/QuantityStepper`; `formatCountdown`/`isUrgent`/`formatBRL` de `~/screens/caixa/format`.

- [ ] **Step 1: Copy do builder**

Em `apps/mobile/src/copy/caixa.ts`, adicionar ao objeto `caixaCopy`:

```ts
  builder: {
    title: 'Montar a caixa',
    all: 'Todos',
    usedOfPlan: (used: string, total: string) => `${used} de ${total}`,
    remaining: (value: string) => `restam ${value}`,
    add: 'Adicionar',
    soldOut: 'ESGOTADO',
    soldOutButton: 'Sem estoque',
    overflowBanner: (value: string) =>
      `Você passou do budget. O excedente de ${value} é cobrado à parte antes do fechamento.`,
    extraTag: 'EXTRA',
    withinBudget: (n: number) => `${n} ${n === 1 ? 'item' : 'itens'} · dentro do budget`,
    noExtraCharge: 'Sem cobrança extra',
    reviewCta: 'Revisar e confirmar',
    writeError: 'Não foi possível salvar. Tente de novo.',
    soon: 'Em breve',
  },
```

- [ ] **Step 2: Card do catálogo (`CatalogItemCard.tsx`)**

Estado por item derivado da seleção; usa `QuantityStepper` quando na caixa, botão "Adicionar" fora, overlay quando `soldOut`. Selo `EXTRA` quando `isOverflow`.

```tsx
import type { BoxCatalog } from '@ccc/shared/box';
import { Text } from '@ccc/ui';
import { Plus } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { QuantityStepper } from '~/screens/buy/per-ticket-wizard/QuantityStepper';
import { theme } from '~/theme';

import { formatBRL } from './format';

const SURFACE = '#0F0E0B';
const BORDER = 'rgba(212,175,55,0.14)';
const BORDER_ACTIVE = 'rgba(212,175,55,0.28)';
const BORDER_EXTRA = 'rgba(34,197,94,0.4)';
const EXTRA_BG = '#22C55E';

type CatalogItemCardProps = {
  item: BoxCatalog['items'][number];
  qty: number;
  isOverflow: boolean;
  onChange: (next: number) => void;
};

export function CatalogItemCard({ item, qty, isOverflow, onChange }: CatalogItemCardProps) {
  const inBox = qty > 0;
  const max = item.maxPerCycle ?? 1000;

  return (
    <View
      style={[
        styles.card,
        inBox && styles.cardActive,
        inBox && isOverflow && styles.cardExtra,
        item.soldOut && styles.cardSoldOut,
      ]}
    >
      <View>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]} />
        )}
        {inBox && isOverflow ? (
          <View style={styles.extraTag}>
            <Text style={styles.extraTagText}>{caixaCopy.builder.extraTag}</Text>
          </View>
        ) : null}
        {item.soldOut ? (
          <View style={styles.soldOutOverlay}>
            <Text style={styles.soldOutText}>{caixaCopy.builder.soldOut}</Text>
          </View>
        ) : null}
      </View>

      <Text variant="bodySm" weight="medium" numberOfLines={2} style={styles.title}>
        {item.title}
      </Text>
      <Text variant="bodySm" style={styles.price}>
        {formatBRL(item.priceCents)}
      </Text>

      {item.soldOut ? (
        <Pressable
          disabled
          style={[styles.addButton, styles.addDisabled]}
          accessibilityRole="button"
        >
          <Text variant="caption" tone="muted">
            {caixaCopy.builder.soldOutButton}
          </Text>
        </Pressable>
      ) : inBox ? (
        <QuantityStepper value={qty} min={0} max={max} onChange={onChange} />
      ) : (
        <Pressable
          onPress={() => onChange(1)}
          style={styles.addButton}
          accessibilityRole="button"
          accessibilityLabel={`${caixaCopy.builder.add} ${item.title}`}
        >
          <Plus color={theme.colors.fg} size={16} strokeWidth={2} />
          <Text variant="caption" weight="medium">
            {caixaCopy.builder.add}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  cardActive: { borderColor: BORDER_ACTIVE },
  cardExtra: { borderColor: BORDER_EXTRA },
  cardSoldOut: { opacity: 0.5 },
  photo: { width: '100%', height: 104, borderRadius: 10 },
  photoPlaceholder: { backgroundColor: 'rgba(242,232,216,0.05)' },
  extraTag: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: EXTRA_BG,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  extraTagText: { color: '#0A0A0A', fontSize: 10, fontWeight: '600' },
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  soldOutText: { color: theme.colors.fg, fontSize: 11, fontWeight: '600', letterSpacing: 1.5 },
  title: { minHeight: 34 },
  price: { color: '#D4AF37' },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  addDisabled: { opacity: 0.5 },
});
```

- [ ] **Step 3: Barra animada (`BudgetMeter` prop `animated`)**

Estender `BudgetMeter` com `animated?: boolean`. Quando `animated`, animar `flex` dos segmentos com `Animated.Value` (240ms, `useNativeDriver: false`). Sem `animated`, comportamento atual inalterado. Padrão de implementação:

```tsx
// imports adicionais
import { Animated, StyleSheet, View } from 'react-native';
import { useEffect, useRef } from 'react';

// dentro do componente, quando animated:
const fill = useRef(new Animated.Value(meter.fillRatio)).current;
const over = useRef(new Animated.Value(meter.overflowRatio)).current;
useEffect(() => {
  if (!animated) return;
  Animated.timing(fill, {
    toValue: meter.fillRatio,
    duration: 240,
    useNativeDriver: false,
  }).start();
  Animated.timing(over, {
    toValue: meter.overflowRatio,
    duration: 240,
    useNativeDriver: false,
  }).start();
}, [animated, meter.fillRatio, meter.overflowRatio, fill, over]);
```

Renderizar os segmentos com `Animated.View` e `style={{ flex: fill }}` / `style={{ flex: over }}` quando `animated`; senão manter os `View` com `flex` numérico já existentes. O terceiro segmento (trilho vazio) usa `Math.max(0, 1 - fill - over)` no modo estático; no animado, envolver num `Animated.View` com flex derivado ou deixar o container `flexDirection: row` com os dois segmentos e um trilho de fundo absoluto. Manter simples: fundo do trilho já é `TRACK_BG` no container, então os dois segmentos animados bastam.

Não quebrar os usos read-only atuais (home passa `box` sem `animated`).

- [ ] **Step 4: Placeholder de revisão (`revisar.tsx`)**

Mesma casca do placeholder `montar.tsx` original (header com voltar + título "Revisão" + corpo "Em breve"). A tela real é 3b-2b.

```tsx
import { Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { theme } from '~/theme';

function onBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

export default function RevisarCaixaScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={8}
        >
          <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
        </Pressable>
        <Text variant="body" weight="semibold">
          Revisão
        </Text>
        <View style={styles.spacer} />
      </View>
      <View style={styles.body}>
        <Text variant="h3">{caixaCopy.builder.soon}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  spacer: { width: 32 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 5: Tela do builder (`montar.tsx`)**

Substituir o placeholder. Composição:

- `useBox()` + `useBoxCatalog()`. `loading` -> `CaixaSkeleton`; `error` (qualquer um) -> corpo de retry (`OfflineBanner` + botão "Tentar de novo" chamando ambos `refresh`); catálogo vazio -> `EmptyState` (catálogo).
- Guardar contra `box` não-`open`: se `!box || box.status !== 'open'`, voltar pra `/caixa` (a home é a dona dos estados não-open).
- `const builder = useBoxBuilder(box, catalog)`.
- Header sticky: voltar (flush + back), título `caixaCopy.builder.title`, countdown compacto à direita (`formatCountdown(new Date(box.cutoffAt).getTime() - Date.now())`, tom urgente via `isUrgent`). Recomputar por minuto com um `setInterval` (limpar no unmount), padrão simples de `useState(Date.now())`.
- `BudgetMeter` compact `animated`, alimentado por um objeto derivado dos totais otimistas: `{ itemsTotalCents: builder.totals.itemsTotalCents, budgetCents: box.budgetCents, overflowCents: builder.totals.overflowCents }`. Linha "restam" via `caixaCopy.builder.remaining(formatBRL(Math.max(0, box.budgetCents - builder.totals.itemsTotalCents)))`.
- Chips de categoria: `['Todos', ...catalog.categories]`; estado `activeCategory: string | null`; `filterByCategory(catalog.items, activeCategory)`.
- Banner de excedente (verde) quando `builder.totals.overflowCents > 0`; mostrar uma vez por sessão via `useRef` (aparece e permanece enquanto houver overflow; não re-anima). Sem háptico.
- Grid 2 colunas de `CatalogItemCard`: `qty={builder.items[item.id] ?? 0}`, `isOverflow={builder.totals.overflowCents > 0}`, `onChange={(n) => builder.setItemQty(item.id, n)}`.
- `SummaryFooter` sticky no rodapé: usar `summaryState(builder.totals)`. Colapsado (`chargeCents === 0`): `caixaCopy.builder.withinBudget(catalogCount)` + `caixaCopy.builder.noExtraCharge` (verde). Senão: 4 linhas (Incluído no plano / Excedente / Parceiros / A pagar) com `formatBRL`. CTA "Revisar e confirmar" -> `builder.flush()` depois `router.push('/caixa/revisar')`. Desabilitar o CTA quando `catalogCount === 0` (confirm com seleção vazia bloqueado na UI).
- `builder.writeError` -> toast persistente no rodapé (`caixaCopy.builder.writeError`) com ação de retry (`builder.retry`). Reusar um `Text tone="danger"` simples se não houver componente de toast.
- `router` back / blur: usar `useFocusEffect` pra `flush` no blur não é direto; simplificar chamando `builder.flush()` no handler de voltar e confiando no cleanup de unmount do hook pra os demais caminhos.

Manter o arquivo focado; extrair sub-componentes locais (`BuilderHeader`, `CategoryChips`, `SummaryFooter`) no mesmo arquivo se ajudar a legibilidade, seguindo o estilo de `caixa/index.tsx`.

- [ ] **Step 6: Rodar testes da área + tsc**

Run: `pnpm -C apps/mobile exec vitest run src/screens/caixa src/hooks && pnpm -C apps/mobile exec tsc --noEmit`
Expected: PASS, sem erros. (A tela em si é composição sobre helpers já testados; não há RNTL no projeto.)

- [ ] **Step 7: Lint**

Run: `pnpm -C apps/mobile exec eslint "app/(app)/caixa/montar.tsx" "app/(app)/caixa/revisar.tsx" src/screens/caixa/CatalogItemCard.tsx src/screens/caixa/BudgetMeter.tsx src/copy/caixa.ts`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add "apps/mobile/app/(app)/caixa/montar.tsx" "apps/mobile/app/(app)/caixa/revisar.tsx" apps/mobile/src/screens/caixa/CatalogItemCard.tsx apps/mobile/src/screens/caixa/BudgetMeter.tsx apps/mobile/src/copy/caixa.ts
git commit -m "feat(mobile): box builder catalog screen (02/03)"
```

---

### Task 7: Ponto de entrada de preferências na home

A home (`caixa/index.tsx`) não linka pra `/caixa/preferencias`. Adicionar um ícone de ajustes no header, ao lado do histórico.

**Files:**

- Modify: `apps/mobile/app/(app)/caixa/index.tsx`

- [ ] **Step 1: Adicionar o botão de ajustes**

Importar `SlidersHorizontal` de `lucide-react-native`. No header (`CaixaHeader`, onde já vive o `History`), adicionar um `Pressable` à esquerda do de histórico, navegando pra preferências:

```tsx
<Pressable
  onPress={() => router.push('/caixa/preferencias')}
  accessibilityRole="button"
  accessibilityLabel={caixaCopy.preferences.title}
  hitSlop={8}
  style={styles.historyButton}
>
  <SlidersHorizontal color={theme.colors.fg} size={22} strokeWidth={1.75} />
</Pressable>
```

Agrupar os dois ícones num `View` com `flexDirection: 'row'` e `gap` se o layout do header exigir. Só é mostrado no header do estado `open` (onde faz sentido editar preferências); seguir a estrutura atual do header.

- [ ] **Step 2: Testes de home + tsc**

Run: `pnpm -C apps/mobile exec vitest run && pnpm -C apps/mobile exec tsc --noEmit`
Expected: PASS, sem erros. Se algum teste de home mockar `lucide-react-native` sem `SlidersHorizontal`, adicionar o ícone ao mock (mesma regressão vista na Task 4 da 3b-1 com `Ticket`).

- [ ] **Step 3: Lint**

Run: `pnpm -C apps/mobile exec eslint "app/(app)/caixa/index.tsx"`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(app)/caixa/index.tsx"
git commit -m "feat(mobile): preferences entry point on caixa home"
```

---

## Self-review (autor)

- **Cobertura do escopo 3b-2a:** API `shippingAddressId` (T1); limpezas 3b-1 (T2); `useBoxCatalog` (T3); lógica pura (T4); controlador (T5); tela 02/03 + card + barra animada (T6); ponto de entrada de preferências (T7). Parceiros/revisão/offline/flag ficam na 3b-2b, com placeholder `revisar.tsx` cobrindo o alvo do CTA.
- **Consistência de tipos:** `SelectionMap`, `OptimisticTotals`, `PriceIndex` definidos na T4 e consumidos na T5/T6. `BoxView.shippingAddressId` da T1 não é consumido nesta fase (é base pra 3b-2b) — documentado.
- **Sem placeholders de plano:** todo passo de código traz o código real; a T6 (tela) descreve a composição sobre helpers testados, coerente com o padrão sem RNTL da 3b-1.
- **Invariantes:** flag continua OFF; dinheiro Int; totais do servidor reconciliam; PUT substitui tudo e preserva parceiros; sem deps novas; sem háptico.

## Carry-forward pra 3b-2b

- Parceiros (tela 04): UI de módulos sobre o `partners` já semeado no controlador.
- Revisão + endereço (tela 05): substituir `revisar.tsx`; usar `BoxView.shippingAddressId` (T1) pra semear o endereço salvo; corrigir os dois achados de endereço adiados (semear do box, bloquear auto-envio sem endereço).
- Offline: persist local (AsyncStorage) + reenvio ao reconectar (precisa de detecção de conectividade; hoje não há lib).
- Háptico: `selection`/`warning`/`success` quando/se o app adicionar `expo-haptics`.
- Ligar `EXPO_PUBLIC_CAIXA_ENABLED` por padrão (decisão de go-live, após QA manual).
