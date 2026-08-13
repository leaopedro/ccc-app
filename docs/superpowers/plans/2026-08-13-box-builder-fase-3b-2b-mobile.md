# Box Builder — Fase 3b-2b (mobile: parceiros, revisão, offline) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o builder da caixa sobre a 3b-2a: seções de parceiros (tela 04), revisão + endereço + confirm (tela 05), os dois achados de endereço adiados da 3b-1, e persist offline mínimo.

**Architecture:** Fluxo linear `Caixa → Montar → Parceiros → Revisão → confirm → Caixa`. Cada tela monta seu próprio `useBoxBuilder`/`useBox` a partir do box fresco e faz flush no unmount/navegação, então a seleção persiste server-side entre telas. Confirm é server-authoritative e cai de volta na home read-only. Offline é um draft AsyncStorage por box, reenviado no mount se ficou sujo.

**Tech Stack:** Expo Router, React 19, RN 0.81, NativeWind, `@ccc/ui`, `@react-native-async-storage/async-storage`, `lucide-react-native`, Vitest (jsdom p/ hooks).

**Spec:** `docs/superpowers/specs/2026-08-11-box-builder-fase-3-design.md`
**Referência de UI:** `docs/design/box-builder/README.md` (telas 04, 05).
**Base:** `main` com a 3b-2a mergeada (PR #17).

## Global Constraints

- Copy voltada ao usuário em PT-BR. Dinheiro via `formatBRL` de `~/screens/caixa/format` (`R$ 1.234,56`). Novo código e comentários em inglês, como o resto do app.
- Flag `EXPO_PUBLIC_CAIXA_ENABLED` fica OFF no código. O flip é passo de go-live (env/config no build EAS), após QA manual. Última seção, sem código. Nada a mudar em `caixa-enabled.ts`.
- Sem dependência nova. Só RN core + libs já no app. Sem haptics, reanimated, netinfo.
- Dinheiro em Int cents. Totais do servidor são a verdade; cliente otimista só anima. `chargeCents = overflow + parceiros + frete` (servidor, `charge.ts`).
- Frete só é computado no confirm (servidor, a partir do CEP). O cliente NÃO computa nem mostra frete antes do confirm (spec, resolução da Q1). A revisão mostra uma linha muted "Frete calculado na confirmação".
- Seleção PUT é diff-based: enviar a seleção inteira incluindo zeros (`toSelectionUpdate` já faz). Módulos de parceiro são toggle 0/1. Parceiros nunca movem a barra de budget.
- Confirm é server-authoritative. Sucesso → `router.replace('/caixa')`; a home (`index.tsx`) já renderiza `awaiting_payment`/`ready`.
- Sem React Query. Hooks custom espelham os existentes (`useBoxPreferences`, `useBoxCatalog`). Testes de hook: jsdom + `react-dom/client` `createRoot` + `act` + `Probe`. Lógica pura em `.ts` com unit test. Componentes RN não têm render test (não há react-native-testing-library); a lógica testável vai pra helpers puros.
- Gate obrigatório por tarefa, ambos verdes antes de commitar:
  - `pnpm --filter @ccc/mobile typecheck`
  - `pnpm --filter @ccc/mobile test`
  - Teste único: `pnpm --filter @ccc/mobile exec vitest run <arquivo>`
- Nunca `--no-verify`. Deixar lint-staged rodar.
- Reusa API de endereço existente: `useShippingAddresses`, `listShippingAddresses`, `formatShippingAddress` (`~/shipping/format-address`), tipo `ShippingAddressRecord` (`@ccc/shared/store`), e `ApiError` (`~/api/client`). O plumbing de confirm já existe: `confirmBox` (`~/api/box`), `boxConfirmSchema`/`BoxConfirm` (`@ccc/shared/box`).

### Ruling registrado (copy do CTA do builder)

O design da tela 02 rotula o CTA do rodapé "Revisar e confirmar", mas a navegação (README linha 240) insere Parceiros entre Montar e Revisão. Resolução: o CTA do builder vira **"Continuar"** (leva a Parceiros) e "Revisar e confirmar" passa pro rodapé da tela de Parceiros. Custo se errado: uma troca de string de uma linha.

---

## Task 1: Helpers puros de seleção de parceiros

Fundação da tela 04. Isola a lógica testável (selecionado? contagem) antes da UI.

**Files:**

- Modify: `apps/mobile/src/screens/caixa/builder-selection.ts` (append)
- Test: `apps/mobile/src/screens/caixa/builder-selection.test.ts` (append)

**Interfaces:**

- Consumes: `SelectionMap` (já exportado neste arquivo).
- Produces: `isPartnerSelected(partners: SelectionMap, moduleId: string): boolean`, `countSelectedPartners(partners: SelectionMap): number`. Consumidos pela tela de Parceiros (Task 2) e por `montar.tsx`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/mobile/src/screens/caixa/builder-selection.test.ts`, adicionar (importe os novos nomes no import existente de `./builder-selection`):

```ts
describe('isPartnerSelected', () => {
  it('is true only for a positive quantity', () => {
    expect(isPartnerSelected({ m1: 1 }, 'm1')).toBe(true);
    expect(isPartnerSelected({ m1: 0 }, 'm1')).toBe(false);
    expect(isPartnerSelected({}, 'm1')).toBe(false);
  });
});

describe('countSelectedPartners', () => {
  it('counts only positive quantities', () => {
    expect(countSelectedPartners({ a: 1, b: 0, c: 2 })).toBe(2);
    expect(countSelectedPartners({})).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/builder-selection.test.ts`
Expected: FAIL (`isPartnerSelected is not a function`).

- [ ] **Step 3: Implementar**

Append em `builder-selection.ts`:

```ts
export function isPartnerSelected(partners: SelectionMap, moduleId: string): boolean {
  return (partners[moduleId] ?? 0) > 0;
}

export function countSelectedPartners(partners: SelectionMap): number {
  return Object.values(partners).filter((qty) => qty > 0).length;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/builder-selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @ccc/mobile typecheck`

```bash
git add apps/mobile/src/screens/caixa/builder-selection.ts apps/mobile/src/screens/caixa/builder-selection.test.ts
git commit -m "feat(mobile): partner selection helpers for box builder"
```

---

## Task 2: Tela de Parceiros (04) + PartnerModuleCard + rewire do CTA do builder

Tela 04. Toggle de módulos sobre o `partners` já semeado no `useBoxBuilder`. Módulos não movem a barra de budget.

**Files:**

- Create: `apps/mobile/src/screens/caixa/PartnerModuleCard.tsx`
- Create: `apps/mobile/app/(app)/caixa/parceiros.tsx`
- Modify: `apps/mobile/src/copy/caixa.ts` (namespace `partners`; `builder.continueCta`)
- Modify: `apps/mobile/app/(app)/caixa/montar.tsx` (CTA → Parceiros; usar `countSelectedPartners`)

**Interfaces:**

- Consumes: `useBox`, `useBoxCatalog`, `useBoxBuilder`, `isPartnerSelected`, `countSelectedPartners`, `BoxCatalog['partners']`.
- Produces: rota `/caixa/parceiros`. `montar.tsx` passa a apontar seu CTA pra cá.

- [ ] **Step 1: Copy**

Em `apps/mobile/src/copy/caixa.ts`, adicionar dentro de `builder` a chave `continueCta: 'Continuar'`, e adicionar um novo namespace top-level:

```ts
  partners: {
    title: 'Parceiros',
    banner: 'Módulos de parceiro são sempre cobrados à parte, fora do budget do plano.',
    inBox: 'Na caixa · cobrado à parte',
    add: 'Adicionar à caixa',
    reviewCta: 'Revisar e confirmar',
    empty: {
      title: 'Sem parceiros neste ciclo',
      body: 'Nenhum módulo de parceiro disponível agora. Você já pode revisar.',
    },
  },
```

- [ ] **Step 2: PartnerModuleCard**

Create `apps/mobile/src/screens/caixa/PartnerModuleCard.tsx`:

```tsx
// Caixa — partner module card (design screen 04). Toggle add/in-box; never
// moves the budget bar (partner modules are always charged separately).

import { Text } from '@ccc/ui';
import { Check, Plus } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { formatBRL } from '~/screens/caixa/format';
import { theme } from '~/theme';

const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';
const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const SELECTED_BG = 'rgba(34,197,94,0.12)';
const SELECTED_BORDER = 'rgba(34,197,94,0.4)';

type PartnerModule = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
};

export function PartnerModuleCard({
  module,
  selected,
  onToggle,
}: {
  module: PartnerModule;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.card, selected && styles.cardSelected]}
    >
      {module.imageUrl ? (
        <Image source={{ uri: module.imageUrl }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={[styles.photo, styles.photoFallback]} />
      )}
      <View style={styles.body}>
        <Text variant="bodySm" weight="medium" numberOfLines={1}>
          {module.name}
        </Text>
        {module.description ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {module.description}
          </Text>
        ) : null}
        <View style={styles.footer}>
          <Text variant="bodySm" weight="semibold" style={styles.price}>
            {formatBRL(module.priceCents)}
          </Text>
          <View style={styles.action}>
            {selected ? (
              <>
                <Check color={theme.colors.success} size={14} strokeWidth={2} />
                <Text variant="caption" weight="semibold" style={styles.inBoxText}>
                  {caixaCopy.partners.inBox}
                </Text>
              </>
            ) : (
              <>
                <Plus color={GOLD_LABEL} size={14} strokeWidth={2} />
                <Text variant="caption" weight="semibold" style={styles.addText}>
                  {caixaCopy.partners.add}
                </Text>
              </>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.sm,
  },
  cardSelected: {
    borderColor: SELECTED_BORDER,
    backgroundColor: SELECTED_BG,
  },
  photo: {
    width: 82,
    height: 82,
    borderRadius: 10,
  },
  photoFallback: {
    backgroundColor: 'rgba(242,232,216,0.05)',
  },
  body: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  price: {
    color: GOLD_LABEL,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  inBoxText: {
    color: theme.colors.success,
  },
  addText: {
    color: GOLD_LABEL,
  },
});
```

- [ ] **Step 3: Tela de Parceiros**

Create `apps/mobile/app/(app)/caixa/parceiros.tsx`:

```tsx
// Caixa — "Parceiros" (design screen 04, Fase 3b-2b).
//
// Linear step between the builder and the review screen. Composes the same
// useBox + useBoxCatalog + useBoxBuilder trio as montar.tsx and only edits the
// partner slice; the whole selection is flushed on navigate, so items chosen
// on the builder survive. Partner modules are toggles and never touch the
// budget bar (charged separately). Not open -> bounce to /caixa, same as the
// builder.

import type { BoxCatalog, BoxView } from '@ccc/shared/box';
import { Button, Text } from '@ccc/ui';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { useBoxBuilder } from '~/hooks/useBoxBuilder';
import { useBoxCatalog } from '~/hooks/useBoxCatalog';
import { isPartnerSelected } from '~/screens/caixa/builder-selection';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { EmptyState } from '~/screens/caixa/EmptyState';
import { OfflineBanner } from '~/screens/caixa/OfflineBanner';
import { PartnerModuleCard } from '~/screens/caixa/PartnerModuleCard';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const BANNER_BG = 'rgba(212,175,55,0.10)';
const GOLD_LABEL = '#C9A227';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function Header({ onBack }: { onBack: () => void }) {
  return (
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
        {caixaCopy.partners.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function PartnersBody({ box, catalog }: { box: BoxView; catalog: BoxCatalog }) {
  const builder = useBoxBuilder(box, catalog);

  const handleBack = () => {
    void builder.flush();
    goBack();
  };

  const handleReview = () => {
    void builder.flush().then(() => {
      router.push('/caixa/revisar' as never);
    });
  };

  const hasPartners = catalog.partners.length > 0;

  return (
    <View style={styles.screen}>
      <Header onBack={handleBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.banner}>
          <Text variant="bodySm" style={styles.bannerText}>
            {caixaCopy.partners.banner}
          </Text>
        </View>

        {hasPartners ? (
          catalog.partners.map((partner) => (
            <View key={partner.id} style={styles.partnerBlock}>
              <View style={styles.partnerHeader}>
                {partner.logoUrl ? (
                  <Image
                    source={{ uri: partner.logoUrl }}
                    style={styles.logo}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={[styles.logo, styles.logoFallback]} />
                )}
                <View style={styles.partnerHeaderText}>
                  <Text variant="body" weight="semibold" numberOfLines={1}>
                    {partner.name}
                  </Text>
                  {partner.description ? (
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {partner.description}
                    </Text>
                  ) : null}
                </View>
              </View>
              {partner.modules.map((module) => {
                const selected = isPartnerSelected(builder.partners, module.id);
                return (
                  <PartnerModuleCard
                    key={module.id}
                    module={module}
                    selected={selected}
                    onToggle={() => builder.setPartnerQty(module.id, selected ? 0 : 1)}
                  />
                );
              })}
            </View>
          ))
        ) : (
          <View style={styles.emptyBlock}>
            <EmptyState
              title={caixaCopy.partners.empty.title}
              body={caixaCopy.partners.empty.body}
            />
          </View>
        )}

        {builder.writeError ? (
          <Pressable onPress={() => void builder.retry()} accessibilityRole="button">
            <Text variant="caption" tone="brand" weight="semibold" style={styles.retry}>
              {caixaCopy.actions.retry}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={caixaCopy.partners.reviewCta} onPress={handleReview} />
      </View>
    </View>
  );
}

export default function ParceirosScreen() {
  const { box, loading: boxLoading, error: boxError } = useBox();
  const { catalog, loading: catalogLoading, error: catalogError } = useBoxCatalog();

  const isOpen = !!box && box.status === 'open';

  useEffect(() => {
    if (boxLoading || boxError) return;
    if (!isOpen) router.replace('/caixa' as never);
  }, [boxLoading, boxError, isOpen]);

  if (boxLoading || catalogLoading) return <CaixaSkeleton />;

  if (boxError || catalogError) {
    return (
      <View style={styles.screen}>
        <OfflineBanner />
        <Header onBack={goBack} />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Text variant="bodySm" tone="muted" style={styles.centerBody}>
            {caixaCopy.loadError.body}
          </Text>
        </View>
      </View>
    );
  }

  if (!isOpen || !box || !catalog) return <CaixaSkeleton />;

  return <PartnersBody box={box} catalog={catalog} />;
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
  headerSpacer: { width: 32 },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  banner: {
    backgroundColor: BANNER_BG,
    borderWidth: 1,
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
  },
  bannerText: { color: GOLD_LABEL },
  partnerBlock: { gap: theme.spacing.sm },
  partnerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  logo: { width: 44, height: 44, borderRadius: 10 },
  logoFallback: { backgroundColor: 'rgba(242,232,216,0.05)' },
  partnerHeaderText: { flex: 1, gap: 2 },
  emptyBlock: { paddingVertical: theme.spacing.xl },
  retry: { textAlign: 'center' },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  centerTitle: { textAlign: 'center' },
  centerBody: { textAlign: 'center', maxWidth: 280 },
  footer: {
    backgroundColor: '#0F0E0B',
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
});
```

- [ ] **Step 4: Rewire do CTA do builder**

Em `apps/mobile/app/(app)/caixa/montar.tsx`:

1. Trocar o destino de `handleReview` de `/caixa/revisar` para `/caixa/parceiros`:

```tsx
const handleReview = () => {
  void builder.flush().then(() => {
    router.push('/caixa/parceiros' as never);
  });
};
```

2. No `<Button>` do `SummaryFooter`, trocar `label={caixaCopy.builder.reviewCta}` por `label={caixaCopy.builder.continueCta}`.

3. Substituir o cálculo inline de `partnerCount` (bloco `useMemo` que faz `Object.values(builder.partners).filter((qty) => qty > 0).length`) por `countSelectedPartners`:

```tsx
import {
  countSelectedPartners,
  filterByCategory,
  summaryState,
  type OptimisticTotals,
} from '~/screens/caixa/builder-selection';
// ...
const partnerCount = useMemo(() => countSelectedPartners(builder.partners), [builder.partners]);
```

- [ ] **Step 5: Gate + commit**

Run: `pnpm --filter @ccc/mobile typecheck` e `pnpm --filter @ccc/mobile test`
Expected: PASS (sem novos testes; a lógica testável veio na Task 1).

```bash
git add apps/mobile/src/screens/caixa/PartnerModuleCard.tsx apps/mobile/app/\(app\)/caixa/parceiros.tsx apps/mobile/src/copy/caixa.ts apps/mobile/app/\(app\)/caixa/montar.tsx
git commit -m "feat(mobile): partners screen (04) and linear builder->partners flow"
```

---

## Task 3: Plumbing de confirm (mapper + hook)

Espelha `preferences-result.ts` + `useBoxPreferences.ts`. Isola o mapeamento de erro do confirm antes da tela.

**Files:**

- Create: `apps/mobile/src/screens/caixa/confirm-result.ts`
- Create: `apps/mobile/src/screens/caixa/confirm-result.test.ts`
- Create: `apps/mobile/src/hooks/useBoxConfirm.ts`
- Create: `apps/mobile/src/hooks/useBoxConfirm.test.tsx`
- Modify: `apps/mobile/src/copy/caixa.ts` (namespace `review`, chaves de erro)

**Interfaces:**

- Consumes: `confirmBox` (`~/api/box`), `BoxConfirm` (`@ccc/shared/box`), `ApiError` (`~/api/client`).
- Produces: `BoxConfirmResult = 'ok' | 'bad_address' | 'box_locked' | 'not_found' | 'error'`; `useBoxConfirm(): { confirm: (input: BoxConfirm) => Promise<BoxConfirmResult>; confirming: boolean }`; `mapConfirmError(result): ConfirmFeedback`. Consumidos pela tela de Revisão (Task 4).

- [ ] **Step 1: Copy (usada pelo mapper)**

Em `apps/mobile/src/copy/caixa.ts`, adicionar o namespace `review` (as demais chaves são usadas na Task 4; adicione o namespace inteiro agora):

```ts
  review: {
    title: 'Revisão',
    planItems: 'ITENS DO PLANO',
    partners: 'PARCEIROS · COBRADO À PARTE',
    delivery: 'ENTREGA',
    shippingAtConfirm: 'Frete calculado na confirmação',
    lockWarning: 'Confirmar trava a caixa. Não dá pra editar depois.',
    confirmCta: 'Confirmar caixa',
    addressRequired: 'Escolha um endereço para confirmar.',
    confirmError: 'Não foi possível confirmar. Tente de novo.',
    addressInvalid: 'Endereço inválido. Escolha outro endereço.',
    locked: 'A caixa não está mais em montagem.',
    lineQty: (qty: number, unit: string) => `${qty} × ${unit}`,
  },
```

- [ ] **Step 2: Teste do mapper (falha)**

Create `apps/mobile/src/screens/caixa/confirm-result.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { caixaCopy } from '~/copy/caixa';

import { mapConfirmError } from './confirm-result';

describe('mapConfirmError', () => {
  it('maps bad_address to an address error', () => {
    expect(mapConfirmError('bad_address')).toEqual({
      kind: 'address_error',
      message: caixaCopy.review.addressInvalid,
    });
  });

  it('maps box_locked to a locked error', () => {
    expect(mapConfirmError('box_locked')).toEqual({
      kind: 'error',
      message: caixaCopy.review.locked,
    });
  });

  it('maps not_found and error to a generic error', () => {
    expect(mapConfirmError('not_found').kind).toBe('error');
    expect(mapConfirmError('error')).toEqual({
      kind: 'error',
      message: caixaCopy.review.confirmError,
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/confirm-result.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar o mapper**

Create `apps/mobile/src/screens/caixa/confirm-result.ts`:

```ts
// Caixa — Revisão screen: maps useBoxConfirm().confirm() results to the copy +
// UI region that should surface them. Pure so the branching is unit-testable
// without rendering the screen.

import { caixaCopy } from '~/copy/caixa';

export type BoxConfirmResult = 'ok' | 'bad_address' | 'box_locked' | 'not_found' | 'error';

export type ConfirmFeedback =
  | { kind: 'address_error'; message: string }
  | { kind: 'error'; message: string };

export function mapConfirmError(result: Exclude<BoxConfirmResult, 'ok'>): ConfirmFeedback {
  switch (result) {
    case 'bad_address':
      return { kind: 'address_error', message: caixaCopy.review.addressInvalid };
    case 'box_locked':
      return { kind: 'error', message: caixaCopy.review.locked };
    case 'not_found':
      return { kind: 'error', message: caixaCopy.review.confirmError };
    case 'error':
      return { kind: 'error', message: caixaCopy.review.confirmError };
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/confirm-result.test.ts`
Expected: PASS.

- [ ] **Step 6: Teste do hook (falha)**

Create `apps/mobile/src/hooks/useBoxConfirm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmBox } = vi.hoisted(() => ({ confirmBox: vi.fn() }));
vi.mock('~/api/box', () => ({ confirmBox: (input: unknown) => confirmBox(input) }));

import { ApiError } from '~/api/client';

import { useBoxConfirm } from './useBoxConfirm';

let snap: ReturnType<typeof useBoxConfirm>;
function Probe() {
  snap = useBoxConfirm();
  return null;
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => confirmBox.mockReset());

async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe />);
    await flush();
  });
}

describe('useBoxConfirm', () => {
  it('returns ok on success', async () => {
    confirmBox.mockResolvedValueOnce({});
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('ok');
  });

  it('maps a 400 ApiError to bad_address', async () => {
    confirmBox.mockRejectedValueOnce(new ApiError(400, { error: 'bad_address' }));
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('bad_address');
  });

  it('maps a 409 ApiError to box_locked', async () => {
    confirmBox.mockRejectedValueOnce(new ApiError(409, { error: 'box_locked' }));
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('box_locked');
  });

  it('maps other failures to error', async () => {
    confirmBox.mockRejectedValueOnce(new Error('net'));
    await mount();
    let result: string | undefined;
    await act(async () => {
      result = await snap.confirm({ shippingAddressId: 'a1' });
    });
    expect(result).toBe('error');
  });
});
```

> Nota p/ o implementador: confira a assinatura real do construtor de `ApiError` em `~/api/client` antes de rodar (a ordem esperada é `(status, body)`; ajuste as chamadas do teste se o construtor diferir). Não invente campos.

- [ ] **Step 7: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxConfirm.test.tsx`
Expected: FAIL.

- [ ] **Step 8: Implementar o hook**

Create `apps/mobile/src/hooks/useBoxConfirm.ts`:

```ts
import type { BoxConfirm } from '@ccc/shared/box';
import { useState } from 'react';

import { confirmBox } from '~/api/box';
import { ApiError } from '~/api/client';
import type { BoxConfirmResult } from '~/screens/caixa/confirm-result';

type UseBoxConfirmResult = {
  confirm: (input: BoxConfirm) => Promise<BoxConfirmResult>;
  confirming: boolean;
};

export function useBoxConfirm(): UseBoxConfirmResult {
  const [confirming, setConfirming] = useState(false);

  const confirm = async (input: BoxConfirm): Promise<BoxConfirmResult> => {
    setConfirming(true);
    try {
      await confirmBox(input);
      return 'ok';
    } catch (e) {
      if (e instanceof ApiError) {
        const code = (e.body as { error?: string } | undefined)?.error;
        if (e.status === 400 || code === 'bad_address') return 'bad_address';
        if (e.status === 409 || code === 'box_locked') return 'box_locked';
        if (e.status === 404 || code === 'box_not_open') return 'not_found';
      }
      return 'error';
    } finally {
      setConfirming(false);
    }
  };

  return { confirm, confirming };
}
```

- [ ] **Step 9: Rodar tudo + typecheck + commit**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxConfirm.test.tsx` (PASS)
Run: `pnpm --filter @ccc/mobile typecheck`

```bash
git add apps/mobile/src/screens/caixa/confirm-result.ts apps/mobile/src/screens/caixa/confirm-result.test.ts apps/mobile/src/hooks/useBoxConfirm.ts apps/mobile/src/hooks/useBoxConfirm.test.tsx apps/mobile/src/copy/caixa.ts
git commit -m "feat(mobile): box confirm hook and error mapper"
```

---

## Task 4: Tela de Revisão + endereço + confirm (05)

Substitui o placeholder `revisar.tsx`. Read-only sobre o box persistido + seleção de endereço + confirm. Semeia o endereço de `BoxView.shippingAddressId`. Frete não é mostrado antes do confirm (spec Q1).

**Files:**

- Create: `apps/mobile/src/screens/caixa/address-select.ts`
- Create: `apps/mobile/src/screens/caixa/address-select.test.ts`
- Create: `apps/mobile/src/screens/caixa/review-sections.ts`
- Create: `apps/mobile/src/screens/caixa/review-sections.test.ts`
- Replace: `apps/mobile/app/(app)/caixa/revisar.tsx`

**Interfaces:**

- Consumes: `useBox`, `useShippingAddresses`, `useBoxConfirm`, `mapConfirmError`, `formatShippingAddress`, `formatBRL`, `BoxView`.
- Produces: `pickInitialAddressId(boxShippingAddressId: string | null, addresses: { id: string; isDefault: boolean }[]): string | null` (reusado na Task 5); `reviewItemLines`/`reviewPartnerLines`/`canConfirm` (`review-sections.ts`).

- [ ] **Step 1: Testes puros (falham)**

Create `apps/mobile/src/screens/caixa/address-select.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { pickInitialAddressId } from './address-select';

const addrs = [
  { id: 'a1', isDefault: false },
  { id: 'a2', isDefault: true },
];

describe('pickInitialAddressId', () => {
  it('prefers the box address when it is still in the list', () => {
    expect(pickInitialAddressId('a1', addrs)).toBe('a1');
  });

  it('falls back to the default when the box address is missing', () => {
    expect(pickInitialAddressId('gone', addrs)).toBe('a2');
    expect(pickInitialAddressId(null, addrs)).toBe('a2');
  });

  it('falls back to the first when there is no default', () => {
    expect(pickInitialAddressId(null, [{ id: 'a1', isDefault: false }])).toBe('a1');
  });

  it('returns null when there are no addresses', () => {
    expect(pickInitialAddressId('a1', [])).toBeNull();
  });
});
```

Create `apps/mobile/src/screens/caixa/review-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { canConfirm } from './review-sections';

const withItem = {
  items: [{ quantity: 1 }],
  partnerItems: [] as { quantity: number }[],
};
const empty = { items: [] as { quantity: number }[], partnerItems: [] as { quantity: number }[] };

describe('canConfirm', () => {
  it('needs both a non-empty selection and an address', () => {
    expect(canConfirm(withItem, 'a1')).toBe(true);
    expect(canConfirm(withItem, null)).toBe(false);
    expect(canConfirm(empty, 'a1')).toBe(false);
  });

  it('counts partner-only selections', () => {
    expect(canConfirm({ items: [], partnerItems: [{ quantity: 1 }] }, 'a1')).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/address-select.test.ts src/screens/caixa/review-sections.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar helpers puros**

Create `apps/mobile/src/screens/caixa/address-select.ts`:

```ts
// Caixa — shared address seeding for the review + preferences screens. Prefers
// the box's saved address (BoxView.shippingAddressId), then the account
// default, then the first address, then none.

export function pickInitialAddressId(
  boxShippingAddressId: string | null,
  addresses: { id: string; isDefault: boolean }[],
): string | null {
  if (boxShippingAddressId && addresses.some((a) => a.id === boxShippingAddressId)) {
    return boxShippingAddressId;
  }
  if (addresses.length === 0) return null;
  return addresses.find((a) => a.isDefault)?.id ?? addresses[0]!.id;
}
```

Create `apps/mobile/src/screens/caixa/review-sections.ts`:

```ts
// Caixa — Revisão screen: pure derivations of the display rows + confirm gate.
// Kept out of the screen so the row mapping and the confirm-enabled rule are
// unit-testable.

import type { BoxView } from '@ccc/shared/box';

export type ReviewLine = {
  id: string;
  title: string;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  included: boolean;
  dropReason: string | null;
};

export function reviewItemLines(box: Pick<BoxView, 'items'>): ReviewLine[] {
  return box.items
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      id: i.catalogItemId,
      title: i.titleSnapshot,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      subtotalCents: i.subtotalCents,
      included: i.included,
      dropReason: i.dropReason,
    }));
}

export function reviewPartnerLines(box: Pick<BoxView, 'partnerItems'>): ReviewLine[] {
  return box.partnerItems
    .filter((i) => i.quantity > 0)
    .map((i) => ({
      id: i.partnerModuleId,
      title: i.nameSnapshot,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      subtotalCents: i.subtotalCents,
      included: i.included,
      dropReason: i.dropReason,
    }));
}

export function canConfirm(
  box: Pick<BoxView, 'items' | 'partnerItems'>,
  selectedAddressId: string | null,
): boolean {
  const hasSelection =
    box.items.some((i) => i.quantity > 0) || box.partnerItems.some((i) => i.quantity > 0);
  return hasSelection && selectedAddressId !== null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/address-select.test.ts src/screens/caixa/review-sections.test.ts`
Expected: PASS.

- [ ] **Step 5: Substituir a tela de Revisão**

Replace `apps/mobile/app/(app)/caixa/revisar.tsx` inteiro:

```tsx
// Caixa — "Revisão + endereço" (design screen 05, Fase 3b-2b).
//
// Read-only view of the persisted box (built on the previous screens) plus
// shipping-address selection and the confirm CTA. Shipping is computed
// server-side at confirm from the chosen address CEP, so it is NOT shown here
// (spec Q1); a muted line says so. On confirm success we route to /caixa,
// where the home screen renders the awaiting_payment / ready read-only body.

import { Button, Text } from '@ccc/ui';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Home, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { caixaCopy } from '~/copy/caixa';
import { useBox } from '~/hooks/useBox';
import { useBoxConfirm } from '~/hooks/useBoxConfirm';
import { useShippingAddresses } from '~/hooks/useShippingAddresses';
import { pickInitialAddressId } from '~/screens/caixa/address-select';
import { CaixaSkeleton } from '~/screens/caixa/CaixaSkeleton';
import { mapConfirmError, type ConfirmFeedback } from '~/screens/caixa/confirm-result';
import { formatBRL } from '~/screens/caixa/format';
import {
  canConfirm,
  reviewItemLines,
  reviewPartnerLines,
  type ReviewLine,
} from '~/screens/caixa/review-sections';
import { formatShippingAddress } from '~/shipping/format-address';
import { theme } from '~/theme';

const BORDER_GOLD_SOFT = 'rgba(212,175,55,0.14)';
const GOLD_LABEL = '#C9A227';
const SURFACE = '#0F0E0B';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/caixa' as never);
}

function openAddAddress() {
  router.push({
    pathname: '/profile/shipping/new',
    params: { returnTo: '/caixa/revisar' },
  } as never);
}

function Header() {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        hitSlop={8}
      >
        <ArrowLeft color={theme.colors.fg} size={24} strokeWidth={1.75} />
      </Pressable>
      <Text variant="body" weight="semibold">
        {caixaCopy.review.title}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function LineRow({ line }: { line: ReviewLine }) {
  return (
    <View style={styles.lineRow}>
      {line.imageUrl ? (
        <Image source={{ uri: line.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]} />
      )}
      <View style={styles.lineBody}>
        <Text
          variant="bodySm"
          numberOfLines={1}
          style={!line.included ? styles.dropped : undefined}
        >
          {line.title}
        </Text>
        <Text variant="caption" tone="muted">
          {caixaCopy.review.lineQty(line.quantity, formatBRL(line.unitPriceCents))}
        </Text>
      </View>
      <Text variant="bodySm" weight="semibold">
        {formatBRL(line.subtotalCents)}
      </Text>
    </View>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text variant="bodySm" tone={muted ? 'muted' : 'secondary'}>
        {label}
      </Text>
      <Text
        variant="bodySm"
        weight={muted ? 'regular' : 'semibold'}
        tone={muted ? 'muted' : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

export default function RevisarCaixaScreen() {
  const { box, loading, error, refresh } = useBox();
  const {
    items: addresses,
    loading: loadingAddresses,
    refresh: refreshAddresses,
  } = useShippingAddresses();
  const { confirm, confirming } = useBoxConfirm();

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ConfirmFeedback | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      void refreshAddresses();
    }, [refresh, refreshAddresses]),
  );

  // Seed the address from the box first (spec: BoxView.shippingAddressId),
  // then the account default, without clobbering a manual pick.
  useEffect(() => {
    setSelectedAddressId((current) => {
      if (current && addresses.some((a) => a.id === current)) return current;
      return pickInitialAddressId(box?.shippingAddressId ?? null, addresses);
    });
  }, [box, addresses]);

  if (loading && !box) return <CaixaSkeleton />;

  if (error || !box) {
    return (
      <View style={styles.screen}>
        <Header />
        <View style={styles.centerBlock}>
          <Text variant="h3" style={styles.centerTitle}>
            {caixaCopy.loadError.title}
          </Text>
          <Button label={caixaCopy.actions.retry} onPress={() => void refresh()} className="mt-5" />
        </View>
      </View>
    );
  }

  const itemLines = reviewItemLines(box);
  const partnerLines = reviewPartnerLines(box);
  const includedCents = Math.min(box.itemsTotalCents, box.budgetCents);
  const confirmEnabled = canConfirm(box, selectedAddressId) && !confirming;

  const onConfirm = async () => {
    if (!selectedAddressId) {
      setFeedback({ kind: 'address_error', message: caixaCopy.review.addressRequired });
      return;
    }
    setFeedback(null);
    const result = await confirm({ shippingAddressId: selectedAddressId });
    if (result === 'ok') {
      router.replace('/caixa' as never);
      return;
    }
    setFeedback(mapConfirmError(result));
  };

  return (
    <View style={styles.screen}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            {caixaCopy.review.planItems}
          </Text>
          {itemLines.map((line) => (
            <LineRow key={line.id} line={line} />
          ))}
        </View>

        {partnerLines.length > 0 ? (
          <View style={styles.section}>
            <Text variant="caption" tone="muted" style={styles.sectionLabel}>
              {caixaCopy.review.partners}
            </Text>
            {partnerLines.map((line) => (
              <LineRow key={line.id} line={line} />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            {caixaCopy.review.delivery}
          </Text>
          {loadingAddresses ? (
            <ActivityIndicator color={theme.colors.accent} style={styles.addressLoading} />
          ) : addresses.length === 0 ? (
            <View style={styles.noAddress}>
              <Text variant="bodySm" weight="semibold">
                {caixaCopy.empty.noAddress.title}
              </Text>
              <Text variant="bodySm" tone="muted" style={styles.noAddressBody}>
                {caixaCopy.empty.noAddress.body}
              </Text>
              <Pressable
                onPress={openAddAddress}
                accessibilityRole="button"
                accessibilityLabel={caixaCopy.actions.addAddress}
                style={styles.addAddressBtn}
                hitSlop={8}
              >
                <Plus color={theme.colors.accent} size={14} strokeWidth={2} />
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {caixaCopy.actions.addAddress}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {addresses.map((address) => {
                const isSelected = selectedAddressId === address.id;
                return (
                  <Pressable
                    key={address.id}
                    onPress={() => setSelectedAddressId(address.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.addressCard, isSelected && styles.addressCardSelected]}
                  >
                    <View style={styles.addressCardHeader}>
                      <Home color={GOLD_LABEL} size={16} strokeWidth={1.75} />
                      <Text variant="bodySm" weight="semibold" numberOfLines={1}>
                        {address.recipientName}
                      </Text>
                    </View>
                    <Text variant="bodySm" tone="muted" numberOfLines={2}>
                      {formatShippingAddress(address)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={openAddAddress}
                accessibilityRole="button"
                accessibilityLabel={caixaCopy.actions.addAddress}
                style={styles.addAddressBtn}
                hitSlop={8}
              >
                <Plus color={theme.colors.accent} size={14} strokeWidth={2} />
                <Text variant="bodySm" tone="brand" weight="semibold">
                  {caixaCopy.actions.addAddress}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.totals}>
          <TotalRow
            label={caixaCopy.summary.catalogItems(itemLines.length)}
            value={formatBRL(box.itemsTotalCents)}
          />
          <TotalRow label={caixaCopy.summary.includedInPlan} value={formatBRL(includedCents)} />
          <TotalRow label={caixaCopy.summary.overflow} value={formatBRL(box.overflowCents)} />
          <TotalRow
            label={caixaCopy.summary.partners(partnerLines.length)}
            value={formatBRL(box.partnersTotalCents)}
          />
          <TotalRow label={caixaCopy.review.shippingAtConfirm} value="—" muted />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {box.chargeCents > 0 ? (
          <View style={styles.payRow}>
            <Text variant="bodySm" tone="secondary">
              {caixaCopy.budget.toPay}
            </Text>
            <Text style={styles.payValue}>{formatBRL(box.chargeCents)}</Text>
          </View>
        ) : null}
        <Text variant="caption" tone="muted" style={styles.lockWarning}>
          {caixaCopy.review.lockWarning}
        </Text>
        {feedback ? (
          <Text variant="bodySm" tone="danger" style={styles.feedbackText}>
            {feedback.message}
          </Text>
        ) : null}
        <Button
          label={confirming ? caixaCopy.preferences.saving : caixaCopy.review.confirmCta}
          onPress={() => void onConfirm()}
          disabled={!confirmEnabled}
          className="mt-2"
        />
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
  headerSpacer: { width: 32 },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  section: { gap: theme.spacing.sm },
  sectionLabel: { letterSpacing: 1 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbFallback: { backgroundColor: 'rgba(242,232,216,0.05)' },
  lineBody: { flex: 1, gap: 2 },
  dropped: { textDecorationLine: 'line-through', opacity: 0.6 },
  addressLoading: { alignSelf: 'flex-start' },
  noAddress: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER_GOLD_SOFT,
    borderRadius: 14,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  noAddressBody: { marginBottom: theme.spacing.xs },
  addressCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    gap: 2,
  },
  addressCardSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: `${theme.colors.accent}12`,
  },
  addressCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  addAddressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  totals: {
    gap: theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingTop: theme.spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER_GOLD_SOFT,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  payValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: theme.font.size.xxl,
    color: theme.colors.accent,
  },
  lockWarning: { marginBottom: theme.spacing.xs },
  feedbackText: { marginBottom: theme.spacing.xs },
});
```

> Nota p/ o implementador: confira que `Text` aceita `tone="secondary"` / `weight="regular"` no `@ccc/ui` (a home e a preferências usam `tone="muted"`, `tone="secondary"`, `weight="semibold"`). Se `weight="regular"` não existir, omita a prop (regular é o default). Confira também `theme.font.size.xxl` e `theme.radii.md` (usados em `montar.tsx`/preferências). Não invente tokens.

- [ ] **Step 6: Gate + commit**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/address-select.test.ts src/screens/caixa/review-sections.test.ts` (PASS)
Run: `pnpm --filter @ccc/mobile typecheck` e `pnpm --filter @ccc/mobile test`

```bash
git add apps/mobile/src/screens/caixa/address-select.ts apps/mobile/src/screens/caixa/address-select.test.ts apps/mobile/src/screens/caixa/review-sections.ts apps/mobile/src/screens/caixa/review-sections.test.ts apps/mobile/app/\(app\)/caixa/revisar.tsx
git commit -m "feat(mobile): box review+confirm screen (05)"
```

---

## Task 5: Fechar os dois achados de endereço na tela de Preferências

Achados adiados da 3b-1: (1) semear o endereço do box, não só do default; (2) bloquear auto-envio sem endereço.

**Files:**

- Modify: `apps/mobile/src/screens/caixa/address-select.ts` (append `canEnableAutoSend`)
- Modify: `apps/mobile/src/screens/caixa/address-select.test.ts` (append)
- Modify: `apps/mobile/app/(app)/caixa/preferencias.tsx`
- Modify: `apps/mobile/src/copy/caixa.ts` (`preferences.autoSendNeedsAddress`)

**Interfaces:**

- Consumes: `pickInitialAddressId` (Task 4).
- Produces: `canEnableAutoSend(selectedAddressId: string | null): boolean`.

- [ ] **Step 1: Teste (falha)**

Append em `apps/mobile/src/screens/caixa/address-select.test.ts`:

```ts
import { canEnableAutoSend } from './address-select';

describe('canEnableAutoSend', () => {
  it('requires a selected address', () => {
    expect(canEnableAutoSend('a1')).toBe(true);
    expect(canEnableAutoSend(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/address-select.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Append em `apps/mobile/src/screens/caixa/address-select.ts`:

```ts
// Auto-send at cutoff requires a shipping address, otherwise the worker's
// auto-confirm branch has nowhere to ship. Block the opt-in without one.
export function canEnableAutoSend(selectedAddressId: string | null): boolean {
  return selectedAddressId !== null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/address-select.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire na tela de Preferências**

Em `apps/mobile/app/(app)/caixa/preferencias.tsx`:

1. Import: adicionar `import { canEnableAutoSend, pickInitialAddressId } from '~/screens/caixa/address-select';` e a copy nova (Step 6).

2. Achado 1 — semear do box. Substituir o `useEffect` que hoje faz o default (o bloco que começa em `setSelectedAddressId((current) => { ... addresses.find((address) => address.isDefault) ... })`) por:

```tsx
// Seed from the box first (spec: BoxView.shippingAddressId), then default,
// without clobbering a manual selection.
useEffect(() => {
  setSelectedAddressId((current) => {
    if (current && addresses.some((address) => address.id === current)) return current;
    return pickInitialAddressId(box?.shippingAddressId ?? null, addresses);
  });
}, [box, addresses]);
```

3. Achado 2 — bloquear auto-envio sem endereço. Trocar o `onValueChange` do `Switch`:

```tsx
<Switch
  value={autoSendOptIn}
  onValueChange={(next) => {
    if (next && !canEnableAutoSend(selectedAddressId)) {
      setFeedback({ kind: 'address_error', message: caixaCopy.preferences.autoSendNeedsAddress });
      return;
    }
    setAutoSendOptIn(next);
  }}
  disabled={!isOpen}
  trackColor={{ false: theme.colors.border, true: GOLD_LABEL }}
  thumbColor={theme.colors.fg}
/>
```

4. Guardar no `onSave` também (defesa em profundidade contra estado inconsistente): no topo de `onSave`, antes do `save(...)`:

```tsx
if (autoSendOptIn && !canEnableAutoSend(selectedAddressId)) {
  showFeedback({ kind: 'address_error', message: caixaCopy.preferences.autoSendNeedsAddress });
  return;
}
```

- [ ] **Step 6: Copy**

Em `apps/mobile/src/copy/caixa.ts`, dentro de `preferences`, adicionar:

```ts
    autoSendNeedsAddress: 'Escolha um endereço para ativar o envio automático.',
```

- [ ] **Step 7: Gate + commit**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/address-select.test.ts` (PASS)
Run: `pnpm --filter @ccc/mobile typecheck` e `pnpm --filter @ccc/mobile test`

```bash
git add apps/mobile/src/screens/caixa/address-select.ts apps/mobile/src/screens/caixa/address-select.test.ts apps/mobile/app/\(app\)/caixa/preferencias.tsx apps/mobile/src/copy/caixa.ts
git commit -m "fix(mobile): seed box address and block auto-send without address"
```

---

## Task 6: Persist offline mínimo do draft de seleção

Draft AsyncStorage por box: persiste a seleção corrente; se ficou sujo (falha de escrita / app morto), reenvia no próximo mount. Sem lib de conectividade, sem fila. Espelha `src/tickets/offline-storage.ts`.

**Files:**

- Create: `apps/mobile/src/screens/caixa/builder-offline.ts`
- Create: `apps/mobile/src/screens/caixa/builder-offline.test.ts`
- Modify: `apps/mobile/src/hooks/useBoxBuilder.ts`
- Modify: `apps/mobile/src/hooks/useBoxBuilder.test.tsx` (append)

**Interfaces:**

- Consumes: `AsyncStorage`, `brand` (`@ccc/design`), `SelectionMap`.
- Produces: `loadDraft(boxId): Promise<BuilderDraft | null>`, `saveDraft(input): Promise<void>`, `clearDraft(boxId): Promise<void>`.

- [ ] **Step 1: Teste do storage (falha)**

Create `apps/mobile/src/screens/caixa/builder-offline.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  },
}));

import { clearDraft, loadDraft, saveDraft } from './builder-offline';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('builder-offline', () => {
  it('round-trips a dirty draft for the same box', async () => {
    await saveDraft({ boxId: 'b1', items: { i1: 2 }, partners: { m1: 1 }, dirty: true });
    const draft = await loadDraft('b1');
    expect(draft).toMatchObject({
      boxId: 'b1',
      dirty: true,
      items: { i1: 2 },
      partners: { m1: 1 },
    });
  });

  it('returns null for a different box id (stale cycle)', async () => {
    await saveDraft({ boxId: 'b1', items: { i1: 2 }, partners: {}, dirty: true });
    expect(await loadDraft('b2')).toBeNull();
  });

  it('clears the draft', async () => {
    await saveDraft({ boxId: 'b1', items: { i1: 1 }, partners: {}, dirty: true });
    await clearDraft('b1');
    expect(await loadDraft('b1')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/builder-offline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o storage**

Create `apps/mobile/src/screens/caixa/builder-offline.ts`:

```ts
// Caixa — minimal offline persistence for the builder selection. One draft per
// box, keyed nowhere (single slot); loadDraft returns null when the stored
// draft is for a different box (a new cycle), so a stale draft never leaks
// across cycles. No connectivity library: a dirty draft is resent on the next
// builder mount. Mirrors src/tickets/offline-storage.ts.

import { brand } from '@ccc/design';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

const STORAGE_KEY = `@${brand.app.storagePrefix}/caixa/builder-draft/v1`;

const selectionSchema = z.record(z.string(), z.number());

const draftSchema = z.object({
  version: z.literal(1),
  boxId: z.string(),
  savedAt: z.string(),
  dirty: z.boolean(),
  items: selectionSchema,
  partners: selectionSchema,
});

export type BuilderDraft = z.infer<typeof draftSchema>;

export async function loadDraft(boxId: string): Promise<BuilderDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || parsed.data.boxId !== boxId) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function saveDraft(input: {
  boxId: string;
  items: Record<string, number>;
  partners: Record<string, number>;
  dirty: boolean;
}): Promise<void> {
  const draft: BuilderDraft = {
    version: 1,
    boxId: input.boxId,
    // savedAt is informational only; never used for ordering.
    savedAt: new Date().toISOString(),
    dirty: input.dirty,
    items: input.items,
    partners: input.partners,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Best effort: a failed local persist must not break the builder.
  }
}

export async function clearDraft(boxId: string): Promise<void> {
  const existing = await loadDraft(boxId);
  if (!existing) return;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort.
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @ccc/mobile exec vitest run src/screens/caixa/builder-offline.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire no useBoxBuilder**

Em `apps/mobile/src/hooks/useBoxBuilder.ts`:

1. Import: `import { clearDraft, loadDraft, saveDraft } from '~/screens/caixa/builder-offline';`

2. Persistir a cada mudança. Nos setters, após atualizar o estado, persistir sujo. Como o `setState` é assíncrono, calcular o próximo mapa na hora:

```tsx
const persistDirty = useCallback(
  (nextItems: SelectionMap, nextPartners: SelectionMap) => {
    void saveDraft({ boxId: box.id, items: nextItems, partners: nextPartners, dirty: true });
  },
  [box.id],
);

const setItemQty = useCallback(
  (id: string, qty: number) => {
    setItems((prev) => {
      const next = { ...prev, [id]: Math.max(0, qty) };
      persistDirty(next, latest.current.partners);
      return next;
    });
    schedule();
  },
  [schedule, persistDirty],
);

const setPartnerQty = useCallback(
  (id: string, qty: number) => {
    setPartners((prev) => {
      const next = { ...prev, [id]: Math.max(0, qty) };
      persistDirty(latest.current.items, next);
      return next;
    });
    schedule();
  },
  [schedule, persistDirty],
);
```

3. Marcar limpo após PUT bem-sucedido. Dentro de `send`, no ramo de sucesso (após `setServerBox(result)`):

```tsx
const result = await updateBoxSelection(
  toSelectionUpdate(latest.current.items, latest.current.partners),
);
setWriteError(false);
setServerBox(result);
void saveDraft({
  boxId: box.id,
  items: latest.current.items,
  partners: latest.current.partners,
  dirty: false,
});
```

4. Resend no mount se sujo. Adicionar um efeito de mount-once:

```tsx
// On mount, if a dirty draft for THIS box survived (failed write / app kill),
// seed from it and resend. Runs once; the debounce/flush path owns the rest.
const resumed = useRef(false);
useEffect(() => {
  if (resumed.current) return;
  resumed.current = true;
  void (async () => {
    const draft = await loadDraft(box.id);
    if (!draft || !draft.dirty) return;
    setItems(draft.items);
    setPartners(draft.partners);
    latest.current = { items: draft.items, partners: draft.partners };
    void send();
  })();
}, [box.id, send]);
```

> Nota p/ o implementador: `latest.current` já é reatribuído a cada render (`latest.current = { items, partners }`). No efeito de resume, setá-lo antes do `send()` garante que o PUT use o draft mesmo antes do re-render. Não remova a reatribuição existente.

- [ ] **Step 6: Teste do hook (resend-on-mount)**

Append em `apps/mobile/src/hooks/useBoxBuilder.test.tsx`. Adicionar o mock do módulo offline no topo (junto dos mocks existentes) e um teste:

```tsx
const { loadDraft: loadDraftMock, saveDraft: saveDraftMock } = vi.hoisted(() => ({
  loadDraft: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('~/screens/caixa/builder-offline', () => ({
  loadDraft: (id: string) => loadDraftMock(id),
  saveDraft: (input: unknown) => saveDraftMock(input),
  clearDraft: vi.fn(),
}));
```

```tsx
it('resends a dirty draft on mount', async () => {
  loadDraftMock.mockResolvedValueOnce({
    version: 1,
    boxId: box.id,
    savedAt: 'x',
    dirty: true,
    items: { i1: 3 },
    partners: {},
  });
  updateBoxSelection.mockResolvedValueOnce(box);
  const root = createRoot(document.createElement('div'));
  await act(async () => {
    root.render(<Probe box={box} catalog={catalog} />);
    await flush();
  });
  expect(updateBoxSelection).toHaveBeenCalledWith(
    expect.objectContaining({ items: [{ catalogItemId: 'i1', quantity: 3 }] }),
  );
});
```

> Nota p/ o implementador: reutilize o `box`/`catalog`/`Probe`/`updateBoxSelection` mock já montados no arquivo. Se o `Probe` atual não aceitar props, siga o padrão exato já usado pelos testes existentes deste arquivo (não reescreva a harness). Ajuste apenas o necessário. Nas asserções, respeite o formato que `toSelectionUpdate` produz.

- [ ] **Step 7: Gate + commit**

Run: `pnpm --filter @ccc/mobile exec vitest run src/hooks/useBoxBuilder.test.tsx src/screens/caixa/builder-offline.test.ts` (PASS)
Run: `pnpm --filter @ccc/mobile typecheck` e `pnpm --filter @ccc/mobile test`

```bash
git add apps/mobile/src/screens/caixa/builder-offline.ts apps/mobile/src/screens/caixa/builder-offline.test.ts apps/mobile/src/hooks/useBoxBuilder.ts apps/mobile/src/hooks/useBoxBuilder.test.tsx
git commit -m "feat(mobile): offline persist + resend of box builder draft"
```

---

## Task 7: Docs + gate de go-live

Fecha a fase na doc e registra o flip do flag como passo de go-live (config, não código).

**Files:**

- Modify: `docs/superpowers/box-builder-roadmap.md`

- [ ] **Step 1: Atualizar o roadmap**

Em `docs/superpowers/box-builder-roadmap.md`, na seção "#### Fase 3b-2b", marcar CONCLUÍDA, registrar o escopo entregue (parceiros tela 04, revisão/confirm tela 05, os dois achados de endereço fechados, offline mínimo) e o plano (`docs/superpowers/plans/2026-08-13-box-builder-fase-3b-2b-mobile.md`). Adicionar um bloco de go-live:

```markdown
Go-live (após QA manual do fluxo completo):

- Ligar `EXPO_PUBLIC_CAIXA_ENABLED=true` no ambiente de build do mobile
  (perfil EAS / .env). O default no código fica OFF; o flip é config, não
  código. Testar num cliente premium real antes de promover.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/box-builder-roadmap.md
git commit -m "docs(box): mark Fase 3b-2b concluida, record go-live gate"
```

---

## Self-Review (checklist do autor do plano)

**Cobertura da spec:** telas 04 (Task 2), 05 (Task 4), achados de endereço 3b-1 (Task 5), offline mínimo (Task 6), confirm "confirma e estaciona" via `confirmBox` existente (Tasks 3+4), flag como go-live (Task 7). Frete tratado por spec Q1 (não mostrado antes do confirm; linha muted). Telas 08/09 já existem na home (3b-2a) e são o destino do confirm.

**Sem placeholders:** todo passo de código traz o código real. Notas ao implementador pedem conferência de tokens/assinaturas existentes (`ApiError`, props do `Text`, tokens de `theme`) em vez de inventar.

**Consistência de tipos:** `SelectionMap` (Task 1/6), `BoxConfirmResult` definido em `confirm-result.ts` e importado por `useBoxConfirm.ts` (Task 3), `pickInitialAddressId` criado na Task 4 e reusado na Task 5, `ReviewLine` local à Task 4. `toSelectionUpdate` já envia zeros (contrato diff-based preservado).

**Riscos sinalizados:**

- Cada tela remonta `useBoxBuilder` do box fresco; a corretude do fluxo linear depende do flush aguardado antes de navegar (`flush().then(push)`), já usado em `montar.tsx`. Mantido em Parceiros.
- Componentes RN não têm render test; a cobertura vem dos helpers puros + hooks. Os reviewers checam as telas contra o design.
- O construtor de `ApiError` e algumas props de `@ccc/ui` são assumidos por espelho do código existente; o implementador confere antes de rodar (notas embutidas).

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-08-13-box-builder-fase-3b-2b-mobile.md`.

**1. Subagent-Driven (recommended)** — dispatch de um subagent fresco por tarefa, review entre tarefas, iteração rápida.

**2. Inline Execution** — executar as tarefas nesta sessão com checkpoints.

Qual abordagem?
