# Box Builder — Fase 3b-1 (mobile: fundação + telas de leitura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a camada de dados, a navegação premium-gated e todas as telas de leitura/estado da Caixa no app mobile, atrás de um flag OFF por padrão.

**Architecture:** Novo `src/api/box.ts` (wrappers finos sobre `authedRequest`, contrato de `@ccc/shared/box`), hooks custom `useState/useEffect` no padrão do app (sem React Query), rota premium-gated `app/(app)/caixa/*`, e helpers puros de formatação/estado testados via Vitest. Nada de builder interativo nem offline aqui (Fase 3b-2). Lógica de negócio é server-side; o cliente só exibe.

**Tech Stack:** Expo Router, React 19, React Native 0.81, NativeWind, `@ccc/ui`, `@ccc/design`, `~/theme`, `@react-native-async-storage/async-storage` 2.2.0, Vitest (jsdom para hooks).

## Global Constraints

- Idioma PT-BR literal. Moeda sempre `R$ 1.234,56` (ponto de milhar, vírgula decimal).
- Sem em-dash, sem cláusulas entre parênteses na copy.
- Todo dinheiro é `Int` em centavos vindo do servidor. O cliente formata, nunca recalcula como fonte de verdade.
- Contrato do backend já existe em `packages/shared/src/box.ts`. Importar schemas/types de lá; não redefinir.
- Rotas do box são `/me/box*` e `/me/boxes` (sem prefixo `/api`), no padrão de `src/api/orders.ts`.
- Premium ativo = `usePremiumSubscription().subscription?.active === true`.
- Screen 09 (ready) decide o que exibir por `status`, nunca por `fulfillmentStatus` (não está no `BoxView`).
- A feature inteira fica atrás de `EXPO_PUBLIC_CAIXA_ENABLED` (default OFF). Merge dark até a 3b-2 fechar o builder.
- Tab bar: exatamente uma aba visível no slot premium (Caixa para membro ativo, Assinatura para free), no mesmo padrão `href: null` do `_layout.tsx`. Ingressos vira item do Perfil.
- Testes: unidade pura para lógica; teste jsdom Probe para hooks, no padrão de `src/hooks/useStoreProducts.test.tsx`. Sem react-native-testing-library.
- Não tocar em código não relacionado. Não reintroduzir React Query.

---

## File Structure

**Novos:**

- `apps/mobile/src/api/box.ts` — cliente das 8 rotas do box.
- `apps/mobile/src/copy/caixa.ts` — copy PT-BR da Caixa.
- `apps/mobile/src/screens/caixa/format.ts` — formatadores puros (moeda, countdown).
- `apps/mobile/src/screens/caixa/box-state.ts` — mapeamento status→variante + math do medidor.
- `apps/mobile/src/screens/caixa/caixa-enabled.ts` — leitura do flag `EXPO_PUBLIC_CAIXA_ENABLED`.
- `apps/mobile/src/navigation/caixa-slot.ts` — resolver puro do slot premium da tab bar.
- `apps/mobile/src/hooks/useBox.ts`, `useBoxHistory.ts`, `useBoxPreferences.ts`, `usePremiumSlot.ts`.
- `apps/mobile/app/(app)/caixa/_layout.tsx`, `index.tsx` (home), `historico.tsx`, `preferencias.tsx`, `montar.tsx` (placeholder 3b-2).
- `apps/mobile/src/screens/caixa/SkipSheet.tsx`, `EmptyState.tsx`, `OfflineBanner.tsx`, `CaixaSkeleton.tsx`, `BudgetMeter.tsx`, `CutoffBanner.tsx`.
- Testes colocados `*.test.ts(x)` ao lado de cada fonte.

**Modificados:**

- `apps/mobile/app/(app)/_layout.tsx` — slot premium-gated + Caixa registrada.
- `apps/mobile/app/(app)/profile/index.tsx` — novo item "Ingressos".
- `apps/mobile/src/copy/profile.ts` — string do item Ingressos.
- `apps/mobile/app/(app)/store/_layout.tsx` — redirect que hoje aponta pra `/tickets` (ver Task 4).

---

### Task 1: Cliente de API `src/api/box.ts`

**Files:**

- Create: `apps/mobile/src/api/box.ts`
- Test: `apps/mobile/src/api/box.test.ts`

**Interfaces:**

- Consumes: `authedRequest` de `./client`; schemas de `@ccc/shared/box`.
- Produces: `getBox`, `updateBoxSelection`, `confirmBox`, `getBoxCatalog`, `skipBox`, `unskipBox`, `getBoxHistory`, `setBoxPreferences`.

Contrato exato (de `packages/shared/src/box.ts` e `apps/api/src/routes/box.ts`):

| Função               | Método/rota               | Body                 | Retorno      |
| -------------------- | ------------------------- | -------------------- | ------------ |
| `getBox`             | GET `/me/box`             | —                    | `BoxView`    |
| `getBoxCatalog`      | GET `/me/box/catalog`     | —                    | `BoxCatalog` |
| `getBoxHistory`      | GET `/me/boxes`           | —                    | `BoxHistory` |
| `updateBoxSelection` | PUT `/me/box/selection`   | `BoxSelectionUpdate` | `BoxView`    |
| `confirmBox`         | POST `/me/box/confirm`    | `BoxConfirm`         | `BoxView`    |
| `setBoxPreferences`  | PUT `/me/box/preferences` | `BoxPreferences`     | `void` (204) |
| `skipBox`            | POST `/me/box/skip`       | —                    | `void` (204) |
| `unskipBox`          | POST `/me/box/unskip`     | —                    | `void` (204) |

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/api/box.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const authedRequest = vi.fn();
vi.mock('./client', () => ({ authedRequest: (...a: unknown[]) => authedRequest(...a) }));

import { getBox, updateBoxSelection, skipBox, setBoxPreferences } from './box';

describe('box api client', () => {
  beforeEach(() => authedRequest.mockReset().mockResolvedValue(undefined));

  it('getBox hits GET /me/box', async () => {
    await getBox();
    expect(authedRequest.mock.calls[0][0]).toBe('/me/box');
    expect(authedRequest.mock.calls[0][2]).toBeUndefined();
  });

  it('updateBoxSelection PUTs a parsed body to /me/box/selection', async () => {
    await updateBoxSelection({ items: [{ catalogItemId: 'c1', quantity: 2 }], partnerItems: [] });
    const [path, , opts] = authedRequest.mock.calls[0];
    expect(path).toBe('/me/box/selection');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toEqual({ items: [{ catalogItemId: 'c1', quantity: 2 }], partnerItems: [] });
  });

  it('skipBox POSTs /me/box/skip with no body', async () => {
    await skipBox();
    const [path, , opts] = authedRequest.mock.calls[0];
    expect(path).toBe('/me/box/skip');
    expect(opts.method).toBe('POST');
  });

  it('setBoxPreferences PUTs /me/box/preferences', async () => {
    await setBoxPreferences({ autoSendOptIn: true, shippingAddressId: 'a1' });
    const [path, , opts] = authedRequest.mock.calls[0];
    expect(path).toBe('/me/box/preferences');
    expect(opts.method).toBe('PUT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/mobile exec vitest run src/api/box.test.ts`
Expected: FAIL, cannot resolve `./box`.

- [ ] **Step 3: Write the client** (mirror `src/api/orders.ts` and `src/api/premium-catalog.ts` exactly)

```ts
// apps/mobile/src/api/box.ts
import {
  boxViewSchema,
  boxCatalogSchema,
  boxHistorySchema,
  boxSelectionUpdateSchema,
  boxConfirmSchema,
  boxPreferencesSchema,
  type BoxView,
  type BoxCatalog,
  type BoxHistory,
  type BoxSelectionUpdate,
  type BoxConfirm,
  type BoxPreferences,
} from '@ccc/shared/box';
import { z } from 'zod';

import { authedRequest } from './client';

export const getBox = (): Promise<BoxView> =>
  authedRequest('/me/box', boxViewSchema as z.ZodType<BoxView>);

export const getBoxCatalog = (): Promise<BoxCatalog> =>
  authedRequest('/me/box/catalog', boxCatalogSchema as z.ZodType<BoxCatalog>);

export const getBoxHistory = (): Promise<BoxHistory> =>
  authedRequest('/me/boxes', boxHistorySchema as z.ZodType<BoxHistory>);

export const updateBoxSelection = (input: BoxSelectionUpdate): Promise<BoxView> =>
  authedRequest('/me/box/selection', boxViewSchema as z.ZodType<BoxView>, {
    method: 'PUT',
    body: boxSelectionUpdateSchema.parse(input),
  });

export const confirmBox = (input: BoxConfirm): Promise<BoxView> =>
  authedRequest('/me/box/confirm', boxViewSchema as z.ZodType<BoxView>, {
    method: 'POST',
    body: boxConfirmSchema.parse(input),
  });

export const setBoxPreferences = async (input: BoxPreferences): Promise<void> => {
  await authedRequest('/me/box/preferences', z.unknown(), {
    method: 'PUT',
    body: boxPreferencesSchema.parse(input),
  });
};

export const skipBox = async (): Promise<void> => {
  await authedRequest('/me/box/skip', z.unknown(), { method: 'POST' });
};

export const unskipBox = async (): Promise<void> => {
  await authedRequest('/me/box/unskip', z.unknown(), { method: 'POST' });
};
```

> Verify `z.unknown()` is accepted by `authedRequest` for 204 bodies. If `authedRequest` calls `schema.parse(JSON.parse(text))` and a 204 yields empty text, mirror how `src/api/store.ts` `deleteShippingAddress` handles empty responses (`z.null()`), and match that.

- [ ] **Step 4: Run tests** — Run: `pnpm -C apps/mobile exec vitest run src/api/box.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add apps/mobile/src/api/box.ts apps/mobile/src/api/box.test.ts && git commit -m "feat(mobile): box api client for fase 3b"`

---

### Task 2: Copy + formatadores puros

**Files:**

- Create: `apps/mobile/src/copy/caixa.ts`, `apps/mobile/src/screens/caixa/format.ts`
- Test: `apps/mobile/src/screens/caixa/format.test.ts`

**Interfaces:**

- Produces: `caixaCopy` (objeto), `formatBRL(cents: number): string`, `formatCountdown(msRemaining: number): string`, `isUrgent(msRemaining: number): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/screens/caixa/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatBRL, formatCountdown, isUrgent } from './format';

describe('formatBRL', () => {
  it('formats cents as R$ with pt-BR separators', () => {
    expect(formatBRL(45000)).toBe('R$ 450,00');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(7000)).toBe('R$ 70,00');
  });
});

describe('formatCountdown', () => {
  it('renders days/hours/minutes above 24h', () => {
    const ms = ((6 * 24 + 4) * 60 + 12) * 60 * 1000;
    expect(formatCountdown(ms)).toBe('6d 04h 12m');
  });
  it('drops days under 24h', () => {
    const ms = (4 * 60 + 12) * 60 * 1000;
    expect(formatCountdown(ms)).toBe('04h 12m');
  });
  it('clamps negatives to zero', () => {
    expect(formatCountdown(-5000)).toBe('00h 00m');
  });
});

describe('isUrgent', () => {
  it('is true within the last 24h', () => {
    expect(isUrgent(23 * 60 * 60 * 1000)).toBe(true);
    expect(isUrgent(25 * 60 * 60 * 1000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — Run: `pnpm -C apps/mobile exec vitest run src/screens/caixa/format.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `format.ts`**

```ts
// apps/mobile/src/screens/caixa/format.ts
export const formatBRL = (cents: number): string => {
  const value = (Math.round(cents) / 100).toFixed(2); // "1234.56"
  const [intPart, dec] = value.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withThousands},${dec}`;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const formatCountdown = (msRemaining: number): string => {
  const ms = Math.max(0, msRemaining);
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / (60 * 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}h ${pad(minutes)}m`;
};

export const isUrgent = (msRemaining: number): boolean => msRemaining <= DAY && msRemaining >= 0;
```

- [ ] **Step 4: Write `caixa.ts` copy** (strings PT-BR literais do design README; extrair da seção de cada tela). Estrutura no padrão de `src/copy/store.ts`:

```ts
// apps/mobile/src/copy/caixa.ts
export const caixaCopy = {
  header: { eyebrow: 'CAIXA DO MÊS' },
  cutoff: { prefix: 'Fecha em' },
  budget: {
    ofPlan: (total: string) => `de ${total}`,
    includedInPlan: (total: string) => `Incluso no plano ${total}`,
    overflow: (value: string) => `+${value} excedente`,
    toPay: 'A pagar',
  },
  summary: {
    catalogItems: (n: number) => `Itens do catálogo (${n})`,
    partners: (n: number) => `Parceiros (${n})`,
    includedInPlan: 'Incluído no plano',
    overflow: 'Excedente',
  },
  actions: {
    edit: 'Editar minha caixa',
    skip: 'Pular esse mês',
    resumePayment: 'Retomar pagamento',
    trackDelivery: 'Acompanhar entrega',
    retry: 'Tentar de novo',
    addAddress: 'Adicionar endereço',
  },
  skipped: { title: (month: string) => `Você pulou ${month}`, back: 'Voltar a montar' },
  awaiting: {
    banner: 'Aguardando pagamento',
    note: 'Sem pagamento até o corte, enviamos só os itens do budget.',
  },
  ready: { banner: 'Caixa confirmada' },
  postCutoff: {
    closedOn: (date: string) => `Caixa fechada em ${date}`,
    note: 'Os extras não foram pagos a tempo, então enviamos só o que cabe no budget. Nada foi cobrado.',
    sent: 'ENVIADO',
    removed: 'REMOVIDO NO FECHAMENTO',
  },
  skipSheet: {
    title: (month: string) => `Pular a caixa de ${month}?`,
    body: 'Você pode voltar a montar enquanto houver tempo antes do corte.',
    confirm: 'Pular esse mês',
    cancel: 'Continuar montando',
  },
  history: { title: 'Histórico de caixas', current: 'Ciclo atual' },
  preferences: {
    title: 'Preferências',
    autoSend: 'Enviar automaticamente no corte',
    autoSendHint: 'No corte, enviamos sua caixa dentro do budget sem você precisar confirmar.',
    address: 'Endereço de entrega',
    changeAddress: 'Trocar',
    save: 'Salvar',
  },
  empty: {
    catalog: { title: 'Catálogo em curadoria', body: 'Novos itens aparecem aqui em breve.' },
    noAddress: {
      title: 'Sem endereço de entrega',
      body: 'Adicione um endereço para confirmar a caixa.',
    },
  },
  offline: { banner: 'Você está offline. Alterações não são salvas.' },
  loadError: { title: 'Não foi possível carregar', body: 'Verifique sua conexão e tente de novo.' },
} as const;
```

- [ ] **Step 5: Run tests + commit** — Run format test (PASS), then `git add apps/mobile/src/copy/caixa.ts apps/mobile/src/screens/caixa/format.ts apps/mobile/src/screens/caixa/format.test.ts && git commit -m "feat(mobile): caixa copy + pure formatters"`

---

### Task 3: Flag da feature + resolver puro do slot premium

**Files:**

- Create: `apps/mobile/src/screens/caixa/caixa-enabled.ts`, `apps/mobile/src/navigation/caixa-slot.ts`
- Test: `apps/mobile/src/navigation/caixa-slot.test.ts`

**Interfaces:**

- Produces: `isCaixaBuildEnabled(): boolean`; `resolveCaixaSlot({ caixaEnabled, premiumActive }): 'caixa' | 'assinaturas'` e `caixaTabVisible(...)`. O resolver decide qual rota ocupa o slot premium e qual fica `href: null`.

Regra: quando `caixaEnabled` for false, o slot sempre mostra `assinaturas` (comportamento atual). Quando true, `premiumActive ? 'caixa' : 'assinaturas'`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/navigation/caixa-slot.test.ts
import { describe, expect, it } from 'vitest';
import { resolveCaixaSlot } from './caixa-slot';

describe('resolveCaixaSlot', () => {
  it('shows caixa for an active member when the feature is enabled', () => {
    expect(resolveCaixaSlot({ caixaEnabled: true, premiumActive: true })).toBe('caixa');
  });
  it('shows assinaturas for a free user when enabled', () => {
    expect(resolveCaixaSlot({ caixaEnabled: true, premiumActive: false })).toBe('assinaturas');
  });
  it('always shows assinaturas when the feature is disabled', () => {
    expect(resolveCaixaSlot({ caixaEnabled: false, premiumActive: true })).toBe('assinaturas');
  });
});
```

- [ ] **Step 2: Run to verify fail** — Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/screens/caixa/caixa-enabled.ts
export const CAIXA_BUILD_ENABLED = process.env.EXPO_PUBLIC_CAIXA_ENABLED === 'true';
export const isCaixaBuildEnabled = (): boolean => CAIXA_BUILD_ENABLED;
```

```ts
// apps/mobile/src/navigation/caixa-slot.ts
export type PremiumSlot = 'caixa' | 'assinaturas';

export const resolveCaixaSlot = (args: {
  caixaEnabled: boolean;
  premiumActive: boolean;
}): PremiumSlot => {
  if (!args.caixaEnabled) return 'assinaturas';
  return args.premiumActive ? 'caixa' : 'assinaturas';
};
```

- [ ] **Step 4: Run tests + commit** — `git add apps/mobile/src/screens/caixa/caixa-enabled.ts apps/mobile/src/navigation/caixa-slot.ts apps/mobile/src/navigation/caixa-slot.test.ts && git commit -m "feat(mobile): caixa feature flag + premium slot resolver"`

---

### Task 4: Navegação premium-gated + Ingressos no Perfil

**Files:**

- Create: `apps/mobile/src/hooks/usePremiumSlot.ts`, `apps/mobile/src/hooks/usePremiumSlot.test.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`, `apps/mobile/app/(app)/profile/index.tsx`, `apps/mobile/src/copy/profile.ts`, `apps/mobile/app/(app)/store/_layout.tsx`

**Interfaces:**

- Consumes: `resolveCaixaSlot`, `isCaixaBuildEnabled` (Task 3), `usePremiumSubscription` (existente), AsyncStorage.
- Produces: `usePremiumSlot(): { slot: PremiumSlot }` com anti-flicker seed.

Anti-flicker: semear de um flag last-known em AsyncStorage (`caixa.premiumActive`) para não piscar Assinatura→Caixa no cold start de membro. Neutro (assinaturas) até resolver, mas se o seed disser membro, começa em `caixa`.

- [ ] **Step 1: Write the failing hook test** (padrão jsdom Probe de `src/hooks/useStoreProducts.test.tsx`)

```tsx
// @vitest-environment jsdom
// apps/mobile/src/hooks/usePremiumSlot.test.tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const subscription = { current: { active: false } as { active: boolean } | null };
vi.mock('./usePremiumSubscription', () => ({
  usePremiumSubscription: () => ({ subscription: subscription.current, loading: false }),
}));
vi.mock('../screens/caixa/caixa-enabled', () => ({ isCaixaBuildEnabled: () => true }));
const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store[k] ?? null),
    setItem: (k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    },
  },
}));

import { usePremiumSlot } from './usePremiumSlot';

let last: string | undefined;
function Probe() {
  last = usePremiumSlot().slot;
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  last = undefined;
});

describe('usePremiumSlot', () => {
  it('returns caixa when the member is active and the feature is on', async () => {
    subscription.current = { active: true };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('caixa');
  });

  it('returns assinaturas for a free user', async () => {
    subscription.current = { active: false };
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(last).toBe('assinaturas');
  });
});
```

- [ ] **Step 2: Run to verify fail** — Expected: FAIL.

- [ ] **Step 3: Implement the hook**

```ts
// apps/mobile/src/hooks/usePremiumSlot.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { resolveCaixaSlot, type PremiumSlot } from '~/navigation/caixa-slot';
import { isCaixaBuildEnabled } from '~/screens/caixa/caixa-enabled';
import { usePremiumSubscription } from './usePremiumSubscription';

const SEED_KEY = 'caixa.premiumActive';

export function usePremiumSlot(): { slot: PremiumSlot } {
  const { subscription, loading } = usePremiumSubscription();
  const [seed, setSeed] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(SEED_KEY).then((v) => setSeed(v === 'true'));
  }, []);

  const caixaEnabled = isCaixaBuildEnabled();
  const resolvedActive = subscription?.active ?? false;

  useEffect(() => {
    if (loading) return;
    void AsyncStorage.setItem(SEED_KEY, resolvedActive ? 'true' : 'false');
  }, [loading, resolvedActive]);

  // Before the live value resolves, trust the seed to avoid a flicker.
  const premiumActive = loading ? (seed ?? false) : resolvedActive;
  return { slot: resolveCaixaSlot({ caixaEnabled, premiumActive }) };
}
```

- [ ] **Step 4: Rework `_layout.tsx`.** O slot que hoje renderiza `tickets`/`store` passa a incluir o slot premium. Regras:
  - Importar `usePremiumSlot`; `const { slot } = usePremiumSlot();`.
  - Registrar `<Tabs.Screen name="caixa" .../>` com ícone `Package` (lucide) e título "Caixa".
  - `tickets` deixa de ser aba visível: sempre `href: null`.
  - No slot premium (posição onde hoje entra `tickets`): renderizar `caixa` quando `slot === 'caixa'`, senão `assinaturas` visível. O não escolhido fica `href: null`. Manter `assinaturas` sempre registrada (hoje é `href: null`).
  - Manter o comportamento da Loja intacto: o slot da Loja continua keyed em `primaryTabName`. O slot premium substitui só o antigo slot de `tickets`.
  - Preservar todas as rotas (`tickets`, `store`, `assinaturas`, `caixa`) registradas para deep links resolverem.

Resultado esperado das abas:

- Loja ON + membro ativo: Eventos · Loja · Carrinho · **Caixa** · Perfil.
- Loja ON + free: Eventos · Loja · Carrinho · **Assinatura** · Perfil.
- Loja OFF + membro ativo: Eventos · **Caixa** · Carrinho · Perfil.
- Loja OFF + free: Eventos · **Assinatura** · Carrinho · Perfil.

- [ ] **Step 5: Adicionar item "Ingressos" no Perfil.** Em `profile/index.tsx`, adicionar um `<MenuRow>` no bloco `menuList` com ícone `Ticket` (lucide) e `onPress={() => router.push('/tickets' as never)}`. String em `src/copy/profile.ts` (`menu.tickets = { label: 'Ingressos', hint: 'Seus ingressos de eventos' }` no padrão dos vizinhos).

- [ ] **Step 6: Corrigir o redirect de `store/_layout.tsx`.** Hoje, quando a loja está indisponível e o user está autenticado, redireciona pra `/tickets`. Como `/tickets` não é mais aba, o alvo continua válido (rota registrada, acessível via Perfil), então o `Redirect href="/tickets"` continua funcional. **Não alterar** salvo se o teste de navegação apontar quebra. Confirmar com um comentário curto no arquivo só se tocar. (Registrar como "cannot verify from diff" se não houver teste; validar manualmente no Step 8.)

- [ ] **Step 7: Run tests** — `pnpm -C apps/mobile exec vitest run src/hooks/usePremiumSlot.test.tsx src/navigation` — Expected: PASS.

- [ ] **Step 8: Manual smoke (documented, not automated).** Com `EXPO_PUBLIC_CAIXA_ENABLED=false` (default), nada muda no app (slot mostra Assinatura). Com `=true`, membro ativo vê Caixa. Anotar no relatório que a verificação visual do tab bar roda na 3b-2 (feature ligada).

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(mobile): premium-gated caixa tab slot, tickets moved to profile"`

---

### Task 5: Hooks de dados `useBox`, `useBoxHistory`, `useBoxPreferences`

**Files:**

- Create: `apps/mobile/src/hooks/useBox.ts`, `useBoxHistory.ts`, `useBoxPreferences.ts`
- Test: `apps/mobile/src/hooks/useBox.test.tsx`, `useBoxHistory.test.tsx`

**Interfaces:**

- Consumes: `getBox`, `getBoxHistory`, `setBoxPreferences`, `skipBox`, `unskipBox` (Task 1).
- Produces:
  - `useBox(enabled?): { box: BoxView | null; loading; error; notOpen: boolean; refresh }` — `notOpen` true quando o servidor responde 404 `box_not_open`/`403` (sem caixa no ciclo).
  - `useBoxHistory(enabled?): { entries: BoxHistory; loading; error; refresh }`.
  - `useBoxPreferences(): { save(input): Promise<'ok'|'bad_address'|'box_locked'|'error'>; saving }` — mapeia `ApiError.status`/`body.error` para o union.

Padrão idêntico a `useShippingAddresses.ts` (query) e à chamada imperativa de mutação (store). `useBox` trata `ApiError` 404/403 como `notOpen` em vez de `error` duro, para a home renderizar o estado "sem caixa neste ciclo".

- [ ] **Step 1: Write the failing test** (jsdom Probe, mock do `~/api/box`)

```tsx
// @vitest-environment jsdom
// apps/mobile/src/hooks/useBox.test.tsx
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const getBox = vi.fn();
vi.mock('../api/box', () => ({ getBox: () => getBox() }));
class ApiError extends Error {
  constructor(
    public status: number,
    public body?: unknown,
  ) {
    super('x');
  }
}
vi.mock('../api/client', () => ({ ApiError }));

import { useBox } from './useBox';

let snap: { loading: boolean; notOpen: boolean; box: unknown } | undefined;
function Probe() {
  const s = useBox();
  snap = { loading: s.loading, notOpen: s.notOpen, box: s.box };
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useBox', () => {
  it('exposes the box on success', async () => {
    getBox.mockResolvedValue({ id: 'b1', status: 'open' });
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, notOpen: false });
    expect((snap!.box as { id: string }).id).toBe('b1');
  });

  it('maps a 404 to notOpen, not a hard error', async () => {
    getBox.mockRejectedValue(new ApiError(404, { error: 'box_not_open' }));
    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(snap).toMatchObject({ loading: false, notOpen: true, box: null });
  });
});
```

- [ ] **Step 2: Run to verify fail** — Expected: FAIL.

- [ ] **Step 3: Implement the three hooks.** `useBox`:

```ts
// apps/mobile/src/hooks/useBox.ts
import { useCallback, useEffect, useState } from 'react';
import type { BoxView } from '@ccc/shared/box';

import { getBox } from '~/api/box';
import { ApiError } from '~/api/client';

export function useBox(enabled = true) {
  const [box, setBox] = useState<BoxView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [notOpen, setNotOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(false);
    setNotOpen(false);
    try {
      setBox(await getBox());
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        setBox(null);
        setNotOpen(true);
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { box, loading, error, notOpen, refresh };
}
```

`useBoxHistory` segue `useShippingAddresses` (retorna `entries`, sem tratamento especial de 404 — `/me/boxes` devolve `[]`). `useBoxPreferences` expõe `save` imperativo mapeando erros:

```ts
// apps/mobile/src/hooks/useBoxPreferences.ts
import { useState } from 'react';
import type { BoxPreferences } from '@ccc/shared/box';

import { setBoxPreferences } from '~/api/box';
import { ApiError } from '~/api/client';

type SaveResult = 'ok' | 'bad_address' | 'box_locked' | 'error';

export function useBoxPreferences() {
  const [saving, setSaving] = useState(false);
  const save = async (input: BoxPreferences): Promise<SaveResult> => {
    setSaving(true);
    try {
      await setBoxPreferences(input);
      return 'ok';
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (e.status === 400 || code === 'bad_address') return 'bad_address';
        if (e.status === 409 || code === 'box_locked') return 'box_locked';
      }
      return 'error';
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}
```

- [ ] **Step 4: Run tests + commit** — `git add apps/mobile/src/hooks/useBox*.ts* apps/mobile/src/hooks/useBoxHistory* apps/mobile/src/hooks/useBoxPreferences* && git commit -m "feat(mobile): box data hooks"`

---

### Task 6: Mapa status→variante + math do medidor (puro)

**Files:**

- Create: `apps/mobile/src/screens/caixa/box-state.ts`
- Test: `apps/mobile/src/screens/caixa/box-state.test.ts`

**Interfaces:**

- Produces:
  - `homeVariant(status: BoxStatus): 'open' | 'skipped' | 'awaiting_payment' | 'ready' | 'post_cutoff'`. Regra: `ready` → `'ready'`; `awaiting_payment` → `'awaiting_payment'`; `skipped` → `'skipped'`; `cancelled` → `'skipped'` (exibe como skipped, gap documentado no spec); `open` → `'open'`. `post_cutoff` só quando o cliente detecta `open`/`skipped` com `cutoffAt` passado E status já resolvido; na prática a home usa `homeVariant(status)` e a tela pós-corte 10 é alcançada por `ready`/`skipped` com linhas removidas.
  - `budgetMeter(box): { usedCents, budgetCents, overflowCents, includedCents, fillRatio, overflowRatio }` — deriva de `itemsTotalCents`, `budgetCents`, `overflowCents`. `includedCents = min(itemsTotalCents, budgetCents)`; `fillRatio = clamp(includedCents/budgetCents, 0, 1)`; `overflowRatio` proporcional para o segmento verde.

> Nota de escopo: a tela 10 (pós-cutoff) renderiza linhas `included:false` com `dropReason`. O mapeamento não inventa `fulfillmentStatus`. `homeVariant` cobre os 5 status; a decisão "10 vs 09" é: `status === 'ready'` com alguma linha `included === false` → layout 10; senão → layout 09-minimal. Expor helper `hasDroppedLines(box): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/screens/caixa/box-state.test.ts
import { describe, expect, it } from 'vitest';
import { homeVariant, budgetMeter, hasDroppedLines } from './box-state';

describe('homeVariant', () => {
  it('maps each status', () => {
    expect(homeVariant('open')).toBe('open');
    expect(homeVariant('awaiting_payment')).toBe('awaiting_payment');
    expect(homeVariant('ready')).toBe('ready');
    expect(homeVariant('skipped')).toBe('skipped');
    expect(homeVariant('cancelled')).toBe('skipped');
  });
});

describe('budgetMeter', () => {
  it('splits included vs overflow', () => {
    const m = budgetMeter({
      itemsTotalCents: 52000,
      budgetCents: 45000,
      overflowCents: 7000,
    } as never);
    expect(m.includedCents).toBe(45000);
    expect(m.overflowCents).toBe(7000);
    expect(m.fillRatio).toBe(1);
    expect(m.overflowRatio).toBeCloseTo(7000 / 45000);
  });
  it('is partial under budget', () => {
    const m = budgetMeter({
      itemsTotalCents: 34000,
      budgetCents: 45000,
      overflowCents: 0,
    } as never);
    expect(m.includedCents).toBe(34000);
    expect(m.fillRatio).toBeCloseTo(34000 / 45000);
    expect(m.overflowRatio).toBe(0);
  });
});

describe('hasDroppedLines', () => {
  it('is true when any item line is excluded', () => {
    expect(hasDroppedLines({ items: [{ included: false }], partnerItems: [] } as never)).toBe(true);
    expect(hasDroppedLines({ items: [{ included: true }], partnerItems: [] } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — Expected: FAIL.

- [ ] **Step 3: Implement** (clamp helpers, sem dependências).

- [ ] **Step 4: Run tests + commit** — `git commit -m "feat(mobile): box home variant + budget meter math"`

---

### Task 7: Tela Caixa (home) + estados de leitura

**Files:**

- Create: `apps/mobile/app/(app)/caixa/_layout.tsx`, `apps/mobile/app/(app)/caixa/index.tsx`, `apps/mobile/app/(app)/caixa/montar.tsx` (placeholder), `apps/mobile/src/screens/caixa/BudgetMeter.tsx`, `CutoffBanner.tsx`, `CaixaSkeleton.tsx`, `EmptyState.tsx`, `OfflineBanner.tsx`

**Interfaces:**

- Consumes: `useBox` (T5), `homeVariant`/`budgetMeter`/`hasDroppedLines` (T6), `formatBRL`/`formatCountdown`/`isUrgent` (T2), `caixaCopy` (T2), `@ccc/ui`, `~/theme`.

A home é read-only nesta fase. `_layout.tsx` no padrão de `assinaturas/_layout.tsx` (`headerShown: false`, header in-screen). Componha por `homeVariant`:

- `loading` → `<CaixaSkeleton/>` (blocos `rgba(242,232,216,.05)`, sem spinner de tela cheia — README tela 13).
- `error` → estado de erro de carga com CTA `caixaCopy.actions.retry` → `refresh()` (tela 15).
- `notOpen` → `<EmptyState/>` "Sem caixa neste ciclo" (variante do 14).
- `open` → CutoffBanner + BudgetMeter(full) + Resumo + CTA primário `caixaCopy.actions.edit` → `router.push('/caixa/montar')` + link `caixaCopy.actions.skip` abre o `SkipSheet` (Task 8). Ícone `history` no header → `router.push('/caixa/historico')`.
- `skipped` → `caixaCopy.skipped.title(mês)` + link voltar (só habilitado se `cutoffAt` no futuro).
- `awaiting_payment` → banner `lock` dourado + seleção read-only (opacidade .72) + card "A pagar" (`formatBRL(box.chargeCents)`) + CTA `resumePayment` **desabilitado** com nota "disponível em breve" (pagamento é Fase 4) + `caixaCopy.awaiting.note`.
- `ready` → se `hasDroppedLines(box)` renderiza layout 10 (pós-cutoff: listas ENVIADO / REMOVIDO NO FECHAMENTO com `dropReason` por linha, riscado, opacidade .45); senão banner verde `caixaCopy.ready.banner` + grade de miniaturas dos itens `included`. Sem timeline (Fase 4).

Detalhes visuais (cores, raios, tipografia) vêm do README `docs/design/box-builder/` telas 01/08/09/10/13/14/15. Usar tokens de `~/theme` e `@ccc/design`; Cormorant Garamond nos valores em R$ conforme README (checar se a fonte já está carregada no app; se não, usar `theme.font` display existente e anotar como follow-up, não adicionar fonte nova nesta fase).

`montar.tsx` placeholder: header "Montar a caixa" + texto "Em breve" (implementado na Fase 3b-2). Existe só pra o CTA da home resolver sem crash enquanto a feature está atrás do flag.

- [ ] **Step 1: `CutoffBanner.tsx`** — recebe `cutoffAt: string`, calcula `msRemaining` de `new Date(cutoffAt).getTime() - Date.now()`, atualiza a cada minuto via `setInterval`, renderiza `${caixaCopy.cutoff.prefix} ${formatCountdown(ms)}`, tom urgente quando `isUrgent(ms)`. **Test:** extrair o cálculo pra `format.ts` (já testado); o componente é fino.

- [ ] **Step 2: `BudgetMeter.tsx`** — recebe `box`, usa `budgetMeter(box)`, renderiza valor usado (`formatBRL(usedCents)`), "de `formatBRL(budgetCents)`", barra com segmento dourado (`fillRatio`) e verde (`overflowRatio`). Variante `compact` para reuso na 3b-2. Sem animação nesta fase (read-only); animação de largura entra no builder (3b-2).

- [ ] **Step 3: `index.tsx`** — orquestra os estados acima. `useBox()`; branch por `loading`/`error`/`notOpen`/`homeVariant(box.status)`.

- [ ] **Step 4: Placeholder `montar.tsx` + `_layout.tsx` + `EmptyState.tsx`/`OfflineBanner.tsx`/`CaixaSkeleton.tsx`.**

- [ ] **Step 5: Run the mobile suite** — `pnpm -C apps/mobile exec vitest run` — Expected: PASS (novos testes puros verdes; sem novos testes de render).

- [ ] **Step 6: Commit** — `git add apps/mobile/app/\(app\)/caixa apps/mobile/src/screens/caixa && git commit -m "feat(mobile): caixa home read-only states"`

---

### Task 8: Bottom sheet Pular/Voltar (tela 11)

**Files:**

- Create: `apps/mobile/src/screens/caixa/SkipSheet.tsx`
- Modify: `apps/mobile/app/(app)/caixa/index.tsx` (wire do link "Pular esse mês")

**Interfaces:**

- Consumes: `skipBox`/`unskipBox` (T1), `caixaCopy.skipSheet`, RN `Modal`.
- Produces: `<SkipSheet visible onClose onDone />` que chama `skipBox()` e no sucesso chama `onDone` (a home dá `refresh()`).

RN `Modal` transparente (padrão do `VariantPickerModal` do store). Sheet: fundo `#0F0E0B`, raio superior 24, alça 40x4, título `caixaCopy.skipSheet.title(mês)`, dois botões (`@ccc/ui` `Button` secondary "Pular esse mês", primary "Continuar montando"). Estado `pending` local durante `skipBox()`. Erro → toast/estado de erro simples. `unskip` é o inverso, disparado do estado `skipped` da home (link voltar), reusando a mesma chamada.

- [ ] **Step 1:** Componente + wire. Sem novos testes de render; a lógica de chamada já está coberta por `box.test.ts`. Se houver lógica condicional não trivial (ex.: bloquear voltar quando `cutoffAt` passou), extrair `canUnskip(cutoffAt): boolean` puro para `box-state.ts` e testar.
- [ ] **Step 2:** `canUnskip` test (se criado) + run suite.
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): skip/unskip sheet"`

---

### Task 9: Histórico de caixas (tela 12)

**Files:**

- Create: `apps/mobile/app/(app)/caixa/historico.tsx`
- Consumes: `useBoxHistory` (T5), `caixaCopy.history`, `formatBRL`, `@ccc/ui` `Card`/`Badge`, `FlatList`.

Lista `FlatList` de cards: thumb 52px (`entry.thumbnails[0]`), ciclo (`entry.cycleKey` → rótulo mês/ano), subtítulo com status + `formatBRL(entry.chargeCents)`. Card do ciclo `current` ganha borda dourada `.28` + subtítulo dourado; demais borda `.14`, subtítulo muted. `RefreshControl` → `refresh()`. `ListEmptyComponent` no padrão empty. Chevron à direita. Status label: mapear `BoxStatus` → PT-BR (reusar/estender um helper de label; se criar, teste puro).

- [ ] **Step 1:** Helper de label de status (puro) + test se criado.
- [ ] **Step 2:** Tela.
- [ ] **Step 3: Run suite + commit** — `git commit -m "feat(mobile): box history screen"`

---

### Task 10: Preferências (auto-envio + endereço)

**Files:**

- Create: `apps/mobile/app/(app)/caixa/preferencias.tsx`
- Consumes: `useBoxPreferences` (T5), `useShippingAddresses` (existente), `caixaCopy.preferences`, `@ccc/ui` `Button`, RN `Switch`.

Tela: `Switch` para `autoSendOptIn`, seletor de endereço reusando `useShippingAddresses` + o fluxo de seleção existente (`src/shipping/navigation.ts`). Sem endereço → CTA `caixaCopy.actions.addAddress` (empty 14). Salvar → `save({ autoSendOptIn, shippingAddressId })`; mapear resultado: `ok` → voltar + toast sucesso; `bad_address` → erro no seletor; `box_locked` → aviso "caixa travada"; `error` → toast retry. O save só é oferecido enquanto a caixa está `open` (ler de `useBox`; se não-open, mostrar read-only).

- [ ] **Step 1:** Tela + wiring dos resultados.
- [ ] **Step 2: Run full mobile suite** — `pnpm -C apps/mobile exec vitest run` — Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): box preferences screen"`

---

## Verification

1. **Testes unitários:** `pnpm -C apps/mobile exec vitest run` verde. Cobrem: cliente de API (paths/métodos/body), formatadores (moeda/countdown/urgente), resolver do slot premium, `usePremiumSlot` (jsdom), `useBox` (jsdom, incluindo 404→notOpen), math do medidor e mapa de status.
2. **Typecheck:** `pnpm -C apps/mobile exec tsc --noEmit` limpo. Rodar também `pnpm -w typecheck` se o CI usar o script agregado (pega testes).
3. **Lint:** deixar o lint-staged rodar no commit; não usar `--no-verify`.
4. **Flag OFF (default):** sem `EXPO_PUBLIC_CAIXA_ENABLED=true`, o app se comporta como hoje. Slot premium mostra Assinatura; Ingressos aparece no Perfil; nenhuma aba Caixa. Confirmar que `store/_layout` redirect ainda resolve.
5. **Flag ON (manual, dev):** rodar o app com `EXPO_PUBLIC_CAIXA_ENABLED=true`. Membro premium ativo vê a aba Caixa; a home renderiza o estado certo por status contra a API real da Fase 3a (`GET /me/box`, `/me/boxes`); Pular/Voltar, Histórico e Preferências funcionam. CTA "Editar minha caixa" leva ao placeholder "Em breve".
6. **Sem regressão de nav:** abas Loja ON/OFF continuam corretas; deep links de `/tickets` e `/store` resolvem.

## Fora de escopo (Fase 3b-2)

Builder interativo (telas 02/03/04/05): grade de catálogo com steppers, animação da barra de budget, módulos de parceiro, revisão + endereço, confirm. Persistência offline (AsyncStorage + reenvio). Placeholder `montar.tsx` é substituído lá. Ligar `EXPO_PUBLIC_CAIXA_ENABLED` por padrão acontece ao fim da 3b-2.
