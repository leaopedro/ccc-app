# Pagamentos no app mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar o isolamento iOS do binário, colocar o `PaymentSheet` nativo nos
três pontos de pagamento do app, remover as duas superfícies que sozinhas
rejeitam o build, e mostrar a caixa física antes da compra.

**Architecture:** O `StripeProvider` passa a montar em toda plataforma. Um seam
único em `src/payments/` produz a configuração do `PaymentSheet`, com `returnURL`
para o retorno de 3DS e Apple Pay declarado, e é consumido pelo carrinho, pela
contratação de assinatura e pela retomada de pedido. Nada de botão dedicado de
Apple Pay: a folha exibe a carteira quando configurada. As telas de paywall
passam a renderizar os benefícios que já vêm do banco.

**Tech Stack:** Expo Router, React Native, `@stripe/stripe-react-native` 0.50.3,
vitest com jsdom, EAS Build.

**Spec:** `docs/superpowers/specs/2026-08-29-pagamentos-mobile-consolidado-design.md`
(Correções de fato C2 e C5, Decisão 6, Decisão 7, Decisão 8, "Escopo que
faltava", "Android, que os specs esqueciam")

**Planos irmãos:** Plano 1 `docs/superpowers/plans/2026-08-29-gate-por-plataforma.md`
(gate por plataforma) e Plano 2 (fluxos nativos na API). **Os dois já entraram.**
Este plano depende deles.

## Global Constraints

- Idioma primário PT-BR. Copy nova entra nos arquivos de `apps/mobile/src/copy/`,
  PT e EN no mesmo arquivo, no padrão de dois objetos de `copy/garage.ts`.
- Comando de teste do mobile: `cd apps/mobile && pnpm exec vitest run <path>`.
  Nunca `pnpm --filter @ccc/mobile test -- <path>`; o `--` não filtra (canon §F8.12).
- Lint por pacote: `pnpm --filter @ccc/mobile lint`. Não rodar `eslint .` na raiz.
- Todos os números de linha deste plano são **âncoras de 2026-08-29**. Ler o
  arquivo antes de editar. Se a âncora não bater, procurar pelo trecho citado.
- Nenhum pedido e nenhuma membership muda de estado por chamada de cliente. O
  `PaymentSheet` confirma a PaymentIntent; quem vira `paid` é o webhook.
- Apple Pay não roda em simulador nem em CI. Toda verificação de carteira é
  manual, em aparelho físico, com Stripe em test mode.
- `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` já foi ligada em `preview` e `production`
  no commit `cc606ae`. **Não refazer.**
- Não ligar `expo-updates` para mudar comportamento de pagamento depois da
  aprovação. Exposição registrada no spec.
- Commits pequenos, um por task no mínimo. Branch a partir de `main` atualizada.
  Nunca commitar em `production`.

---

## Pré-requisitos humanos

Estes não são código. Cada um bloqueia uma task de desenvolvimento nomeada
abaixo. Um plano que esconde isso é inútil: o dev vai bater na parede.

| ID     | O que                                                                                                                                                                                                                                                                                                                                                                                                                   | Dono                      | Bloqueia                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------- |
| **H1** | No Apple Developer portal, habilitar o merchant id `merchant.com.casacarclub.app` nos App IDs `com.casacarclub.app.dev` e `com.casacarclub.app.preview` (hoje ele só existe no App ID de produção), e **regerar os provisioning profiles** das três variants. Sem isso o build `.dev` e `.preview` quebra na assinatura assim que a Task 2 entrar.                                                                      | Pedro                     | Task 2                  |
| **H2** | Extrair a chave publicável **live** da conta Stripe correta do Casa Car Club e a chave de **test** da mesma conta. Conferir contra `~/.claude/.../memory/stripe-accounts-prod.md`: existem dois `acct_` que se confundem, e a chave que está no `preview` hoje é da conta JDM, sem relação nenhuma com este projeto.                                                                                                    | Pedro                     | Task 3                  |
| **H3** | Cadastrar em `/premium/catalogo`, **no admin de produção**, os rótulos de benefício que descrevem a caixa física: o que vem dentro e com que cadência é entregue. Hoje existem doze rótulos semeados e **nenhum** menciona a caixa. Isto é entrada de dados, não código, e é o item de maior efeito da Decisão 6. Sem ele as Tasks 10 e 11 renderizam uma lista que não prova nada ao revisor.                          | Pedro                     | valor das Tasks 10 e 11 |
| **H4** | Decidir e **registrar por escrito** as duas questões de Android da seção "Android, que os specs esqueciam": (a) Google Pay entra na folha ou fica de fora; (b) o Android migra para a folha nativa ou continua no checkout hospedado (`PremiumScreen` abre `WebBrowser`, `ContratarScreen` usa `redirectToStripeCheckout`). Gravar a decisão no topo da Task 13 antes de executá-la.                                    | Pedro                     | Task 13                 |
| **H5** | **Decisão 8.** QA manual da caixa, incluindo confirmar com a AbacatePay que uma cobrança Pix fica **impagável** depois do `expiresIn`. Só depois disso `EXPO_PUBLIC_CAIXA_ENABLED` é ligada nos perfis do `eas.json`. Isto está no caminho crítico da submissão iOS porque a Decisão 6 promete a caixa no paywall e a Decisão 8 é o que faz a promessa ser verdadeira. **Nenhuma task deste plano liga essa variável.** | Pedro + operação da caixa | flip da flag, pós-plano |
| **H6** | `docs/legal/encarregado.md` nomeia **JDM Experience** como controlador e `privacidade@jdmexperience.com.br` como caixa do Encarregado. Trocar o nome da entidade controladora é fato jurídico, não busca-e-substitui. Confirmar a razão social e o e-mail antes da Task 15 tocar nesse arquivo.                                                                                                                         | Pedro                     | parte da Task 15        |
| **H7** | Verificação manual do Apple Pay: aparelho físico, cartão real na carteira, Stripe em test mode. Não roda em simulador nem em CI.                                                                                                                                                                                                                                                                                        | Pedro                     | aceite da Task 4        |

---

### Task 1: Remover o isolamento iOS do `StripeProvider`

O `_layout.tsx:222` impede o `StripeProvider` de montar no iOS. Enquanto ele
existir, todo o resto deste plano é inerte no iOS. Junto saem a regra de lint que
petrificava a decisão, o registro dela no eslint flat config, e o teste que a
exercitava. O canon §F8.16 **não é apagado**: ganha marca de superseded com data
e motivo, porque apagar decisão registrada esconde por que ela existiu.

**Files:**

- Modify: `apps/mobile/app/_layout.tsx:216-233` (o comentário do canon e o ternário)
- Modify: `apps/mobile/eslint.config.js:4` e `:11-23`
- Delete: `apps/mobile/eslint-rules/no-stripe-on-ios.cjs`
- Delete: `apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts`
- Modify: `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md:52`
- Test: `apps/mobile/app/__tests__/root-layout-stripe.test.tsx` (criar)

**Interfaces:**

- Produces: `StripeProvider` monta em qualquer plataforma quando há
  `stripePublishableKey` em `Constants.expoConfig.extra`. Todas as tasks
  seguintes dependem disto.

- [ ] **Step 1: Write the failing test**

Não existe teste do root layout hoje. Este é o menor teste honesto: a condição de
montagem é uma expressão, então extrair a expressão e testá-la é o que dá um
ciclo TDD real sem renderizar a árvore inteira do app.

```typescript
// apps/mobile/app/__tests__/root-layout-stripe.test.tsx
import { describe, expect, it } from 'vitest';

import { shouldMountStripeProvider } from '../stripe-provider-gate';

// Canon §F8.16 was superseded on 2026-08-29: the iOS bundle now pays through
// Stripe natively, because 3.1.3(e) puts physical goods and services consumed
// outside the app OUTSIDE in-app purchase. Mounting the provider is the
// precondition for every PaymentSheet in this plan.
describe('shouldMountStripeProvider', () => {
  it('mounts on iOS when a publishable key is present', () => {
    expect(shouldMountStripeProvider({ platform: 'ios', stripeKey: 'pk_live_x' })).toBe(true);
  });

  it('mounts on android and web too', () => {
    expect(shouldMountStripeProvider({ platform: 'android', stripeKey: 'pk_live_x' })).toBe(true);
    expect(shouldMountStripeProvider({ platform: 'web', stripeKey: 'pk_live_x' })).toBe(true);
  });

  it('does not mount without a key, on any platform', () => {
    expect(shouldMountStripeProvider({ platform: 'ios', stripeKey: '' })).toBe(false);
    expect(shouldMountStripeProvider({ platform: 'android', stripeKey: '' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run app/__tests__/root-layout-stripe.test.tsx`
Expected: FAIL, não resolve `../stripe-provider-gate`.

- [ ] **Step 3: Write minimal implementation**

Criar `apps/mobile/app/stripe-provider-gate.ts`:

```typescript
// Whether the root layout mounts StripeProvider.
//
// Until 2026-08-29 this was `Platform.OS !== 'ios' && stripeKey`, under canon
// §F8.16. That canon entry is superseded: it cited a guideline that no longer
// says what it was quoted as saying (3.1.5 is "Cryptocurrencies" today), and
// the live text — 3.1.3(e), Goods and Services Outside of the App — requires
// purchase methods OTHER than in-app purchase for physical goods consumed
// outside the app. The only condition left is having a key to mount with.
export const shouldMountStripeProvider = (args: { platform: string; stripeKey: string }): boolean =>
  args.stripeKey.length > 0;
```

Em `apps/mobile/app/_layout.tsx`, substituir o bloco de comentário e o ternário
das linhas 216-231 por:

```tsx
// Canon §F8.16 superseded on 2026-08-29 — see the plan
// docs/superpowers/plans/2026-08-29-pagamentos-mobile-app.md, Task 1.
// iOS pays natively through Stripe; Apple Pay rides on the PaymentSheet.
return (
  <ThemeProvider value={cccNavTheme}>
    {shouldMountStripeProvider({ platform: Platform.OS, stripeKey }) ? (
      <StripeProvider
        publishableKey={stripeKey}
        {...(stripeMerchantIdentifier ? { merchantIdentifier: stripeMerchantIdentifier } : {})}
      >
        {app}
      </StripeProvider>
    ) : (
      app
    )}
  </ThemeProvider>
);
```

Importar `shouldMountStripeProvider` de `./stripe-provider-gate`.

Em `apps/mobile/eslint.config.js`, apagar a linha 4 (`const noStripeOnIos = …`) e
todo o bloco de objeto das linhas 11-23. O array fica com `expoConfig` e o objeto
de `ignores`.

Apagar os dois arquivos:

```bash
git rm apps/mobile/eslint-rules/no-stripe-on-ios.cjs
git rm apps/mobile/src/screens/settings/__tests__/ios-stripe-isolation.test.ts
rmdir apps/mobile/eslint-rules 2>/dev/null || true
```

Em `docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md`, a linha 52
começa com `**§F8.16 — iOS bundle isolation.**`. **Não apagar.** Prefixar o
parágrafo com o aviso e manter o texto original abaixo dele:

```markdown
**§F8.16 — SUPERSEDIDO em 2026-08-29.** Motivo: a diretriz citada como base
(`3.1.5(a)`) não existe mais; `3.1.5` hoje é "Cryptocurrencies". O texto vivo é
`3.1.3(e) — Goods and Services Outside of the App`, que exige método de pagamento
**fora** do in-app purchase para bens e serviços **físicos** consumidos fora do
app. O iOS passa a pagar por Stripe nativo. A regra de lint `no-stripe-on-ios` e
o teste de isolamento foram removidos. Ver
`docs/superpowers/specs/2026-08-29-pagamentos-mobile-consolidado-design.md` (C1) e
`docs/superpowers/plans/2026-08-29-pagamentos-mobile-app.md` (Task 1). Texto
original preservado abaixo para histórico.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run app/__tests__/root-layout-stripe.test.tsx`
Expected: PASS, 3 testes.

Run: `pnpm --filter @ccc/mobile lint`
Expected: PASS. Se o eslint reclamar de config inválida, a remoção do bloco 11-23
deixou vírgula sobrando no array.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app apps/mobile/eslint.config.js docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md
git add -u apps/mobile/eslint-rules apps/mobile/src/screens/settings/__tests__
git commit -m "feat(mobile): StripeProvider monta no iOS, canon F8.16 superseded"
```

---

### Task 2: `merchantIdentifier` em toda variant

**BLOQUEADA POR H1.** Hoje `app.config.ts:39` só preenche
`stripeMerchantIdentifier` quando `variant === 'production'`. O valor alimenta
duas coisas: o `extra.stripeMerchantIdentifier` que o `_layout.tsx:225` passa ao
`StripeProvider`, e o config plugin do `@stripe/stripe-react-native`
(`app.config.ts:201-204`), que injeta o entitlement de Apple Pay no build nativo.

Preencher em toda variant significa que o build `.dev` e o `.preview` passam a
pedir o entitlement `merchant.com.casacarclub.app`. Se a Apple não tiver
habilitado esse merchant id nesses App IDs, e se os provisioning profiles não
forem regerados, **os dois builds quebram na assinatura**. Não executar esta task
antes de H1 estar confirmado.

**Files:**

- Modify: `apps/mobile/app.config.ts:39`
- Test: `apps/mobile/src/__tests__/app-config-merchant.test.ts` (criar)

**Interfaces:**

- Produces: `extra.stripeMerchantIdentifier === brand.app.stripeMerchantId` nas
  três variants. Task 4 depende disso para o Apple Pay aparecer na folha em
  build de preview.

- [ ] **Step 1: Write the failing test**

`app.config.ts` está em `ignores` do eslint e é carregado por ESM nativo do Expo,
então não vale importar o config inteiro no vitest. Extrair a decisão para um
módulo minúsculo e testar esse módulo.

```typescript
// apps/mobile/src/__tests__/app-config-merchant.test.ts
import { describe, expect, it } from 'vitest';

import { resolveMerchantIdentifier } from '../config/merchant-identifier';

// Apple Pay must work in .dev and .preview, otherwise the only build that can
// exercise the wallet is the one we cannot install on a test device. Apple Pay
// does not run in the simulator, so a production-only merchant id means the
// wallet is never tested before submission.
describe('resolveMerchantIdentifier', () => {
  it('returns the merchant id for every variant', () => {
    expect(resolveMerchantIdentifier('development')).toBe('merchant.com.casacarclub.app');
    expect(resolveMerchantIdentifier('preview')).toBe('merchant.com.casacarclub.app');
    expect(resolveMerchantIdentifier('production')).toBe('merchant.com.casacarclub.app');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/__tests__/app-config-merchant.test.ts`
Expected: FAIL, não resolve `../config/merchant-identifier`.

- [ ] **Step 3: Write minimal implementation**

Criar `apps/mobile/src/config/merchant-identifier.ts`:

```typescript
import { brand } from '@ccc/design/brand';

export type AppVariant = 'development' | 'preview' | 'production';

/**
 * The Apple Pay merchant identifier, for every build variant.
 *
 * Until 2026-08-29 this was production-only. That made Apple Pay untestable:
 * the wallet does not work in the simulator, and .dev/.preview are the only
 * builds installable on a test device.
 *
 * PREREQUISITE (H1): merchant.com.casacarclub.app must be enabled on the
 * com.casacarclub.app.dev and com.casacarclub.app.preview App IDs, and the
 * provisioning profiles regenerated. Without that, .dev and .preview fail to
 * sign.
 */
export const resolveMerchantIdentifier = (_variant: AppVariant): string =>
  brand.app.stripeMerchantId;
```

Em `apps/mobile/app.config.ts`, trocar a linha 39. O arquivo já importa
`@ccc/design/brand`; ele **não** pode importar de `~/config/...` (o alias `~`
não existe no loader ESM do Expo), então escrever o valor direto:

```typescript
// Apple Pay entitlement on every variant. See src/config/merchant-identifier.ts
// for the reasoning and for the Apple-portal prerequisite (H1).
const stripeMerchantIdentifier = brand.app.stripeMerchantId;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/__tests__/app-config-merchant.test.ts`
Expected: PASS.

Conferir que o config resolve nas três variants:

```bash
cd apps/mobile && for v in development preview production; do
  APP_VARIANT=$v pnpm exec expo config --type public --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(process.env.V, JSON.parse(s).extra.stripeMerchantIdentifier))" V=$v
done
```

Expected: `merchant.com.casacarclub.app` nas três.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app.config.ts apps/mobile/src/config apps/mobile/src/__tests__/app-config-merchant.test.ts
git commit -m "feat(mobile): merchantIdentifier em toda variant de build"
```

---

### Task 3: Chaves Stripe no `eas.json`

**BLOQUEADA POR H2.** Dois defeitos independentes no mesmo arquivo.

O perfil `production` (`eas.json:36-46`) **não define
`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`**. Logo `extra.stripePublishableKey` é
string vazia, logo `shouldMountStripeProvider` devolve `false`, logo o
`PaymentSheet` nasce morto exatamente no binário que vai para a App Store. Este é
o motivo pelo qual o spec diz que o bloco do `PaymentSheet` depende do bloco de
build.

O perfil `preview` (`eas.json:31`) carrega
`pk_test_51RD9T6PNWmr3Tc4tbQZ5Zq80wRCRfLCSKfvsJhGoRkdjgNFVWMfftNKrOuBgaRm1oSygfi8odFj3179hWzqXjfgc00w4zA61zM`,
que é da conta **JDM**, sem relação com este projeto. Um build de preview que
paga contra a conta errada não testa nada.

`EXPO_PUBLIC_PREMIUM_BILLING_ENABLED: "true"` já está nos dois perfis (linhas 33
e 44), do commit `cc606ae`. Não mexer.

**Files:**

- Modify: `apps/mobile/eas.json:31` e `:39-45`
- Test: `apps/mobile/src/__tests__/eas-stripe-keys.test.ts` (criar)

**Interfaces:**

- Produces: os perfis `preview` e `production` definem
  `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` da conta Casa Car Club.

- [ ] **Step 1: Write the failing test**

Teste sobre o JSON. Uma chave publicável não é segredo (é publicável por
definição, vai inline no bundle), então versioná-la é aceitável e é o que o
`preview` já faz. O teste pina os dois invariantes que quebraram.

```typescript
// apps/mobile/src/__tests__/eas-stripe-keys.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

type Profile = { env?: Record<string, string> };
type Eas = { build: Record<string, Profile> };

const eas = JSON.parse(readFileSync(join(process.cwd(), 'eas.json'), 'utf8')) as Eas;

// The JDM account's test key. It belongs to an unrelated project and was
// inherited by copy-paste; a preview build paying against it proves nothing.
const JDM_KEY_PREFIX = 'pk_test_51RD9T6';

describe('eas.json Stripe keys', () => {
  it('gives the production profile a publishable key', () => {
    const key = eas.build.production?.env?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    // Without this, extra.stripePublishableKey is '' and StripeProvider never
    // mounts in the submitted binary. The PaymentSheet would be dead on
    // arrival in the one build that matters.
    expect(key).toBeTruthy();
    expect(key?.startsWith('pk_live_')).toBe(true);
  });

  it('does not ship the JDM account key on any profile', () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      const key = profile.env?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
      expect(key.startsWith(JDM_KEY_PREFIX), `profile ${name}`).toBe(false);
    }
  });

  it('keeps premium billing on in preview and production', () => {
    expect(eas.build.preview?.env?.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED).toBe('true');
    expect(eas.build.production?.env?.EXPO_PUBLIC_PREMIUM_BILLING_ENABLED).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/__tests__/eas-stripe-keys.test.ts`
Expected: FAIL nos dois primeiros casos. O terceiro passa (já é `true`).

- [ ] **Step 3: Write minimal implementation**

Com as chaves de H2 em mãos, em `apps/mobile/eas.json`:

Trocar a linha 31 do perfil `preview` pela chave `pk_test_` da conta Casa Car
Club. Acrescentar ao `env` do perfil `production`, entre
`EXPO_PUBLIC_R2_PUBLIC_BASE_URL` e `SENTRY_ALLOW_FAILURE`:

```json
        "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_live_<chave live do Casa Car Club, de H2>",
```

O perfil `development` fica sem chave de propósito: ele lê `.env.local`, que é o
que permite a cada dev apontar para a própria conta de teste.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/__tests__/eas-stripe-keys.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/eas.json apps/mobile/src/__tests__/eas-stripe-keys.test.ts
git commit -m "fix(mobile): chave Stripe em production, chave da JDM fora do preview"
```

---

### Task 4: O seam do `PaymentSheet`, uma configuração só

Uma configuração, três consumidores. Sem botão dedicado de Apple Pay: a folha
exibe a carteira sozinha quando `applePay` está declarado e o `merchantIdentifier`
chegou ao `StripeProvider`. Um botão separado seria uma segunda superfície de
pagamento para manter, com as mesmas falhas e o dobro de estados.

Duas coisas verificadas em `node_modules/@stripe/stripe-react-native@0.50.3`,
`lib/typescript/src/types/PaymentSheet.d.ts`, e que corrigem uma suposição do spec:

- `returnURL` existe em `SetupParamsBase` (linha 24) e é documentado como "A URL
  that redirects back to your app that PaymentSheet can use to auto-dismiss web
  views used for additional authentication, e.g. 3DS2". Cartão brasileiro
  autentica muito. Sem `returnURL` a folha não volta e o pagamento pendura.
- `applePay` (linha 16) e `googlePay` (linha 18) são **opt-in**, cada um um
  objeto com `merchantCountryCode` obrigatório (linhas 103 e 120). O spec diz que
  "Google Pay vem junto do `PaymentSheet` a menos que seja explicitamente
  suprimido". **Isso não confere nesta versão do SDK.** Nenhum dos dois aparece
  sem ser passado. Não passar `googlePay` aqui; ele é a Task 13, depois de H4.

**Files:**

- Create: `apps/mobile/src/payments/payment-sheet.ts`
- Create: `apps/mobile/src/copy/payments.ts`
- Test: `apps/mobile/src/payments/__tests__/payment-sheet.test.ts`

**Interfaces:**

- Produces:
  - `type PaymentSheetOutcome = { kind: 'paid' } | { kind: 'cancelled' } | { kind: 'failed'; code?: string }`
  - `PAYMENT_SHEET_RETURN_URL: string`
  - `buildPaymentSheetConfig(args: { clientSecret: string; platform: string }): SetupParams`
  - `resolveSheetOutcome(error: { code?: string } | null | undefined): PaymentSheetOutcome`
  - `usePaymentSheet(): { pay: (clientSecret: string) => Promise<PaymentSheetOutcome> }`
  - `paymentsCopy` e `paymentsCopyEn` em `~/copy/payments`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/mobile/src/payments/__tests__/payment-sheet.test.ts
import { describe, expect, it, vi } from 'vitest';

// The SDK is native-only; the enum is all we need from it here.
vi.mock('@stripe/stripe-react-native', () => ({
  PaymentSheetError: { Canceled: 'Canceled', Failed: 'Failed', Timeout: 'Timeout' },
  useStripe: () => ({ initPaymentSheet: vi.fn(), presentPaymentSheet: vi.fn() }),
}));

const { buildPaymentSheetConfig, resolveSheetOutcome, PAYMENT_SHEET_RETURN_URL } =
  await import('../payment-sheet');

describe('buildPaymentSheetConfig', () => {
  it('always carries the client secret, the merchant name and a returnURL', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
    expect(cfg.paymentIntentClientSecret).toBe('pi_1_secret_x');
    expect(cfg.merchantDisplayName).toBeTruthy();
    // Brazilian cards authenticate through 3DS constantly. Without a returnURL
    // the web view never hands control back and the payment hangs forever.
    expect(cfg.returnURL).toBe(PAYMENT_SHEET_RETURN_URL);
  });

  it('declares Apple Pay on iOS', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'ios' });
    expect(cfg.applePay).toEqual({ merchantCountryCode: 'BR' });
  });

  it('does not declare Apple Pay off iOS', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
    expect(cfg.applePay).toBeUndefined();
  });

  // Google Pay is opt-in in @stripe/stripe-react-native 0.50.3 (PaymentSheet.d.ts:18).
  // It stays off until the Android decision (H4 / Task 13) is recorded.
  it('does not declare Google Pay yet', () => {
    const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
    expect(cfg.googlePay).toBeUndefined();
  });
});

describe('resolveSheetOutcome', () => {
  it('treats no error as paid', () => {
    expect(resolveSheetOutcome(null)).toEqual({ kind: 'paid' });
  });

  // Cancellation is not a failure. Showing an error alert to someone who chose
  // to close the sheet is how a working flow reads as broken.
  it('separates cancellation from failure', () => {
    expect(resolveSheetOutcome({ code: 'Canceled' })).toEqual({ kind: 'cancelled' });
    expect(resolveSheetOutcome({ code: 'Failed' })).toEqual({ kind: 'failed', code: 'Failed' });
  });

  it('reports a failure with no code as a plain failure', () => {
    expect(resolveSheetOutcome({})).toEqual({ kind: 'failed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/payments/__tests__/payment-sheet.test.ts`
Expected: FAIL, não resolve `../payment-sheet`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/mobile/src/payments/payment-sheet.ts
//
// The single PaymentSheet configuration for the whole app. Cart, subscription
// and order resumption all go through here, so a fix to one is a fix to three.
//
// No dedicated Apple Pay button: the sheet surfaces the wallet by itself when
// `applePay` is declared here AND `merchantIdentifier` reached StripeProvider
// (app.config.ts → extra.stripeMerchantIdentifier → app/_layout.tsx).
//
// Google Pay is deliberately absent. In @stripe/stripe-react-native 0.50.3 it
// is opt-in (`googlePay?: GooglePayParams`, PaymentSheet.d.ts:18), not on by
// default. Adding it is a product decision, tracked as H4 / Task 13.

import { brand } from '@ccc/design';
import { PaymentSheetError, useStripe } from '@stripe/stripe-react-native';
import { Platform } from 'react-native';

export type PaymentSheetOutcome =
  | { kind: 'paid' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code?: string };

/**
 * Where the 3DS web view hands control back. `brand.app.scheme` is 'ccc' and is
 * the same value app.config.ts registers as the app scheme, so the OS routes
 * this back into the app.
 */
export const PAYMENT_SHEET_RETURN_URL = `${brand.app.scheme}://stripe-redirect`;

export const buildPaymentSheetConfig = (args: { clientSecret: string; platform: string }) => ({
  paymentIntentClientSecret: args.clientSecret,
  merchantDisplayName: brand.name,
  returnURL: PAYMENT_SHEET_RETURN_URL,
  // Nothing we sell settles asynchronously through the sheet. Pix has its own
  // flow (AbacatePay), so delayed methods would only add ways to be told
  // "paid" before the money exists.
  allowsDelayedPaymentMethods: false,
  ...(args.platform === 'ios' ? { applePay: { merchantCountryCode: 'BR' } } : {}),
});

export const resolveSheetOutcome = (
  error: { code?: string } | null | undefined,
): PaymentSheetOutcome => {
  if (!error) return { kind: 'paid' };
  if (error.code === PaymentSheetError.Canceled) return { kind: 'cancelled' };
  return error.code ? { kind: 'failed', code: error.code } : { kind: 'failed' };
};

/** Init + present, collapsed into one call with one outcome union. */
export const usePaymentSheet = () => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const pay = async (clientSecret: string): Promise<PaymentSheetOutcome> => {
    const { error: initError } = await initPaymentSheet(
      buildPaymentSheetConfig({ clientSecret, platform: Platform.OS }),
    );
    if (initError) return resolveSheetOutcome(initError);
    const { error: presentError } = await presentPaymentSheet();
    return resolveSheetOutcome(presentError);
  };

  return { pay };
};
```

Copy nova, PT e EN no mesmo arquivo, no padrão de dois objetos de
`copy/garage.ts`:

```typescript
// apps/mobile/src/copy/payments.ts
//
// Copy shared by every PaymentSheet surface (cart, subscription, order
// resumption). PT-BR is primary; EN is the i18n scaffold the repo mandates.

const ptBR = {
  sheet: {
    // A closed sheet is a choice, not a failure. Never show this as an error.
    cancelled: 'Pagamento cancelado. Seu pedido continua aguardando pagamento.',
    failed: 'Não foi possível concluir o pagamento. Tente de novo ou use outro cartão.',
    // The 3DS web view came back but the bank did not approve.
    authFailed: 'Seu banco não autorizou a compra. Tente de novo ou use outro cartão.',
    // Confirmation is asynchronous: the webhook is what flips the order.
    confirming: 'Confirmando pagamento...',
    unavailable: 'Pagamento indisponível neste aparelho. Tente pelo site.',
  },
} as const;

const en = {
  sheet: {
    cancelled: 'Payment cancelled. Your order is still awaiting payment.',
    failed: 'We could not complete the payment. Try again or use another card.',
    authFailed: 'Your bank declined the purchase. Try again or use another card.',
    confirming: 'Confirming payment...',
    unavailable: 'Payment is unavailable on this device. Try the website.',
  },
} as const;

export const paymentsCopy = ptBR;
export const paymentsCopyEn = en;
export type PaymentsCopy = typeof ptBR;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/payments/__tests__/payment-sheet.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/payments apps/mobile/src/copy/payments.ts
git commit -m "feat(mobile): seam unico do PaymentSheet com returnURL e Apple Pay"
```

**Aceite manual (H7):** aparelho físico, cartão real na carteira, Stripe em test
mode. A folha precisa mostrar a linha de Apple Pay no topo. Um build de preview
serve, desde que H1 e a Task 2 tenham entrado.

---

### Task 5: `PaymentSheet` no carrinho

Hoje `app/(app)/cart/index.tsx:541-552` abre `result.checkoutUrl` com
`Linking.openURL` no nativo. Com o fluxo nativo do Plano 2, o servidor devolve
`clientSecret` e a folha resolve dentro do app.

**Interface consumida do Plano 2, a conferir antes de escrever código:** o spec
diz que `beginCheckoutRequestSchema` ganha um campo `flow`
(`packages/shared/src/cart.ts:230-237`), e que com `flow: 'native'` a resposta
traz `clientSecret` não nulo (`:247`, hoje `nullable`). **Ler
`packages/shared/src/cart.ts` e a rota `apps/api/src/routes/cart.ts` antes de
começar** e usar os nomes que o Plano 2 de fato entregou. Não confiar nos nomes
deste parágrafo.

**Files:**

- Modify: `apps/mobile/app/(app)/cart/index.tsx:510-556` (o `handlePay`)
- Test: `apps/mobile/src/payments/__tests__/cart-payment-flow.test.ts` (criar)

**Interfaces:**

- Consumes: `usePaymentSheet` da Task 4; `flow` e `clientSecret` do Plano 2.
- Produces: `resolveCartPaymentAction`, a decisão pura sobre o que fazer com a
  resposta de `beginCheckout`.

- [ ] **Step 1: Write the failing test**

O `handlePay` é grande e vive num componente de 1300 linhas. Extrair a decisão e
testar a decisão; o componente só executa.

```typescript
// apps/mobile/src/payments/__tests__/cart-payment-flow.test.ts
import { describe, expect, it } from 'vitest';

import { resolveCartPaymentAction } from '../cart-payment-flow';

describe('resolveCartPaymentAction', () => {
  it('routes pix to the pix screen', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'pix',
        isWeb: false,
        clientSecret: null,
        checkoutUrl: null,
        brCode: '000201...',
        reservationExpiresAt: '2026-08-29T12:00:00.000Z',
        firstOrderId: 'ord_1',
      }),
    ).toEqual({
      kind: 'pix',
      orderId: 'ord_1',
      brCode: '000201...',
      expiresAt: '2026-08-29T12:00:00.000Z',
    });
  });

  it('routes a native card checkout to the payment sheet', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: false,
        clientSecret: 'pi_1_secret_x',
        checkoutUrl: null,
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'sheet', clientSecret: 'pi_1_secret_x' });
  });

  // Web has no native SDK. It keeps the hosted Checkout Session it already has.
  it('keeps web on the hosted checkout url', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: true,
        clientSecret: null,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x',
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.com/c/pay/cs_test_x' });
  });

  // A native card checkout with no client secret is a server contract break,
  // not something to paper over by opening a browser: the hosted session would
  // create a SECOND payment path for the same cart.
  it('errors when a native card checkout has no client secret', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'card',
        isWeb: false,
        clientSecret: null,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_x',
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'error' });
  });

  it('errors when pix comes back without a brCode', () => {
    expect(
      resolveCartPaymentAction({
        paymentMethod: 'pix',
        isWeb: false,
        clientSecret: null,
        checkoutUrl: null,
        brCode: null,
        reservationExpiresAt: null,
        firstOrderId: 'ord_1',
      }),
    ).toEqual({ kind: 'error' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/payments/__tests__/cart-payment-flow.test.ts`
Expected: FAIL, não resolve `../cart-payment-flow`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/mobile/src/payments/cart-payment-flow.ts
//
// Pure decision over a beginCheckout response. The cart screen executes; this
// decides. Keeps the branching testable without rendering a 1300-line screen.

export type CartPaymentAction =
  | { kind: 'pix'; orderId: string; brCode: string; expiresAt: string }
  | { kind: 'sheet'; clientSecret: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'error' };

export const resolveCartPaymentAction = (args: {
  paymentMethod: 'card' | 'pix';
  isWeb: boolean;
  clientSecret: string | null;
  checkoutUrl: string | null;
  brCode: string | null;
  reservationExpiresAt: string | null;
  firstOrderId: string | undefined;
}): CartPaymentAction => {
  if (args.paymentMethod === 'pix') {
    if (!args.brCode || !args.reservationExpiresAt || !args.firstOrderId) return { kind: 'error' };
    return {
      kind: 'pix',
      orderId: args.firstOrderId,
      brCode: args.brCode,
      expiresAt: args.reservationExpiresAt,
    };
  }
  if (args.isWeb) {
    return args.checkoutUrl ? { kind: 'redirect', url: args.checkoutUrl } : { kind: 'error' };
  }
  // Native card. Falling back to checkoutUrl here would open a hosted session
  // for a cart that already has a PaymentIntent — two payment paths, one cart,
  // and the second charge invisible to charge.refunded.
  return args.clientSecret ? { kind: 'sheet', clientSecret: args.clientSecret } : { kind: 'error' };
};
```

Em `app/(app)/cart/index.tsx`, dentro de `CartScreen`, chamar
`const { pay } = usePaymentSheet();` junto dos outros hooks (perto da linha 327),
e substituir o corpo de `handlePay` (linhas 510-556) por:

```typescript
const handlePay = useCallback(async () => {
  setCheckingOut(true);
  try {
    const result = await beginCheckout({
      paymentMethod,
      ...(isWeb ? {} : { flow: 'native' as const }),
      ...(selectedFulfillmentMethod ? { fulfillmentMethod: selectedFulfillmentMethod } : {}),
      ...(selectedShippingAddressId ? { shippingAddressId: selectedShippingAddressId } : {}),
      ...(needsEventPickup && eventPickupEnabled && selectedPickupEventId
        ? { pickupEventId: selectedPickupEventId }
        : {}),
      ...getCheckoutReturnUrls(),
    });

    const action = resolveCartPaymentAction({
      paymentMethod,
      isWeb,
      clientSecret: result.clientSecret,
      checkoutUrl: result.checkoutUrl,
      brCode: result.brCode,
      reservationExpiresAt: result.reservationExpiresAt,
      firstOrderId: result.orderIds[0],
    });

    if (action.kind === 'error') {
      showError(cartCopy.errors.checkout);
      return;
    }
    if (action.kind === 'pix') {
      router.push({
        pathname: '/(app)/events/buy/checkout-pix',
        params: {
          orderId: action.orderId,
          brCode: action.brCode,
          expiresAt: action.expiresAt,
          amountCents: String(result.cart.totals.amountCents),
          currency: result.cart.totals.currency,
        },
      } as never);
      return;
    }
    if (action.kind === 'redirect') {
      if (typeof window !== 'undefined') {
        redirectToStripeCheckout({ checkoutUrl: action.url, orderIds: result.orderIds });
      }
      return;
    }

    const outcome = await pay(action.clientSecret);
    if (outcome.kind === 'cancelled') {
      showError(paymentsCopy.sheet.cancelled);
      return;
    }
    if (outcome.kind === 'failed') {
      showError(paymentsCopy.sheet.failed);
      return;
    }
    // Paid on the sheet. The order flips to `paid` only when the webhook
    // lands, so send the member to the order list rather than claiming
    // success here.
    router.replace('/profile/orders' as never);
  } catch {
    showError(cartCopy.errors.checkout);
  } finally {
    setCheckingOut(false);
  }
}, [
  eventPickupEnabled,
  needsEventPickup,
  pay,
  paymentMethod,
  router,
  selectedFulfillmentMethod,
  selectedPickupEventId,
  selectedShippingAddressId,
]);
```

Acrescentar os imports de `~/payments/payment-sheet`,
`~/payments/cart-payment-flow` e `~/copy/payments`. Conferir a rota real da lista
de pedidos: o arquivo é `app/(app)/profile/orders.tsx`, então o href é
`/profile/orders`. Se o `typedRoutes` reclamar, ler
`apps/mobile/app/(app)/profile/` antes de forçar o cast.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/payments/__tests__/cart-payment-flow.test.ts`
Expected: PASS, 5 testes.

Run: `cd apps/mobile && pnpm exec vitest run src/cart`
Expected: PASS, sem regressão nos testes de carrinho existentes.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/payments "apps/mobile/app/(app)/cart/index.tsx"
git commit -m "feat(mobile): carrinho paga pelo PaymentSheet no nativo"
```

---

### Task 6: `PaymentSheet` na contratação de assinatura

`src/screens/assinaturas/checkout.ts` é o único lugar do módulo que fala com
provedor de pagamento, por desenho. É lá que a folha entra. O ramo
`ios_unsupported` (linha 27) morre junto.

**Interface consumida do Plano 2, a conferir antes de escrever código:** o spec
promete um "par novo de request/response para a assinatura nativa". **Ler
`apps/mobile/src/api/premium.ts` e `packages/shared/src/premium.ts`** e usar o
nome que o Plano 2 entregou. Este plano chama de `createPremiumSubscriptionNative`
e assume que devolve `{ clientSecret: string }`; se o nome diferir, ajustar aqui e
manter o resto.

**Files:**

- Modify: `apps/mobile/src/screens/assinaturas/checkout.ts`
- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx:182-212` (o `onSubmit`)
- Test: `apps/mobile/src/screens/assinaturas/__tests__/checkout.test.ts` (arquivo existente; conferir com `ls` antes)

**Interfaces:**

- Consumes: `usePaymentSheet` da Task 4.
- Produces: `CheckoutOutcome` ganha `{ kind: 'sheet'; clientSecret: string }` e
  perde `{ kind: 'ios_unsupported' }`.

- [ ] **Step 1: Write the failing test**

```typescript
// acrescentar a apps/mobile/src/screens/assinaturas/__tests__/checkout.test.ts
// (se o arquivo não existir, criar seguindo o padrão de mocks de
//  __tests__/ContratarScreen.test.tsx: `const platform = { OS: 'android' }` +
//  vi.mock('react-native', ...) devolvendo `Platform: platform`)

it('returns a sheet outcome on iOS instead of the old ios_unsupported', async () => {
  platform.OS = 'ios';
  createPremiumSubscriptionNative.mockResolvedValue({ clientSecret: 'pi_sub_secret_x' });

  const outcome = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

  expect(outcome).toEqual({ kind: 'sheet', clientSecret: 'pi_sub_secret_x' });
});

it('returns a sheet outcome on Android too', async () => {
  platform.OS = 'android';
  createPremiumSubscriptionNative.mockResolvedValue({ clientSecret: 'pi_sub_secret_y' });

  const outcome = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

  expect(outcome).toEqual({ kind: 'sheet', clientSecret: 'pi_sub_secret_y' });
});

// Web has no native SDK; it keeps the hosted session.
it('still redirects on web', async () => {
  platform.OS = 'web';
  createPremiumCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_x' });

  const outcome = await startPremiumCheckout({ planSlug: 'fundador', addonKeys: [] });

  expect(outcome).toEqual({ kind: 'redirected' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/__tests__/checkout.test.ts`
Expected: FAIL, iOS devolve `{ kind: 'ios_unsupported' }`.

- [ ] **Step 3: Write minimal implementation**

Em `src/screens/assinaturas/checkout.ts`, reescrever o cabeçalho e a função. O
comentário de topo cita a regra de lint que a Task 1 apagou; ele sai junto.

```typescript
// Contratação (checkout) seam.
//
// The SINGLE place that talks to a payment provider from the assinaturas
// module. Platform branching lives here so no screen has to know about it.
//
// Until 2026-08-29 iOS returned `ios_unsupported` and the screen rendered a
// "contract on the website" notice. That notice was in-app steering to an
// external purchase method on the Brazil storefront, which the 3.1.3 chapeau
// forbids outright (the exception is US-storefront only). iOS now pays through
// the native PaymentSheet like every other native platform.

import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { createPremiumCheckout, createPremiumSubscriptionNative } from '~/api/premium';

import { resolveCheckoutError, type CheckoutError } from './checkout-error';

export type CheckoutOutcome =
  | { kind: 'redirected' }
  | { kind: 'returned' }
  | { kind: 'sheet'; clientSecret: string }
  | { kind: 'error'; error: CheckoutError };

export async function startPremiumCheckout(input: {
  planSlug: string;
  addonKeys: string[];
}): Promise<CheckoutOutcome> {
  if (Platform.OS !== 'web') {
    try {
      const intent = await createPremiumSubscriptionNative(input);
      return { kind: 'sheet', clientSecret: intent.clientSecret };
    } catch (err) {
      return { kind: 'error', error: resolveCheckoutError(err) };
    }
  }

  let url: string;
  try {
    const session = await createPremiumCheckout(input);
    url = session.url;
  } catch (err) {
    return { kind: 'error', error: resolveCheckoutError(err) };
  }

  window.location.href = url;
  return { kind: 'redirected' };
}
```

O bloco de comentário longo sobre `openAuthSessionAsync` (linhas 41-64 do arquivo
atual) descreve o caminho hospedado no Android. Se H4 decidir manter o Android
hospedado, ele volta na Task 13; até lá **preservar o comentário** movendo-o para
o topo do arquivo sob o título `// Histórico: caminho hospedado no Android`, com
o `import * as WebBrowser` mantido. Não apagar conhecimento que custou caro.

Em `ContratarScreen.tsx`, no `onSubmit` (linhas 182-212), tratar o outcome novo.
Chamar `const { pay } = usePaymentSheet();` junto dos outros hooks, **acima** dos
`return` antecipados de loading e erro (React não aceita hook depois de early
return; hoje o primeiro `return` está na linha 109).

```typescript
if (outcome.kind === 'sheet') {
  const sheet = await pay(outcome.clientSecret);
  if (sheet.kind === 'cancelled') {
    setCheckoutError({ message: paymentsCopy.sheet.cancelled });
    return;
  }
  if (sheet.kind === 'failed') {
    setCheckoutError({ message: paymentsCopy.sheet.failed });
    return;
  }
  setPhase('confirming');
  const active = await pollSubscriptionActive();
  if (active) {
    showToast(copy.successToast);
    router.replace('/assinaturas/minha-assinatura');
  } else {
    setPhase('pending');
  }
  return;
}
```

`setCheckoutError` espera um `CheckoutError`. **Ler
`src/screens/assinaturas/checkout-error.ts` antes** e montar o objeto no formato
que esse tipo exige; se ele tiver mais campos obrigatórios que `message`, usar o
construtor que já existe lá em vez de inventar um literal.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/`
Expected: PASS. O teste 6 de `ContratarScreen.test.tsx` (linhas 365-373) ainda vai
falhar: ele afirma que no iOS o CTA não monta e que `iosTitle` aparece. Esse teste
é reescrito na Task 9. Se as duas tasks forem executadas por agentes diferentes,
deixar o teste 6 falhando é aceitável **apenas** entre a Task 6 e a Task 9; não
commitar suíte vermelha sem a Task 9 na sequência imediata.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/assinaturas
git commit -m "feat(mobile): assinatura contrata pelo PaymentSheet nativo"
```

---

### Task 7: `PaymentSheet` na retomada de pedido

`app/(app)/profile/orders.tsx:209` desabilita o Stripe no iOS por canon §F8.16, e
`PayWithStripeButton` (linhas 91-135) monta a folha com apenas
`paymentIntentClientSecret` e `merchantDisplayName`: sem `returnURL`, sem Apple
Pay. As duas coisas saem daqui.

**Files:**

- Modify: `apps/mobile/app/(app)/profile/orders.tsx:93-128` e `:206-209`
- Test: `apps/mobile/src/cart/__tests__/resume-selector.test.ts` (arquivo existente; conferir com `ls src/cart/__tests__/`)

**Interfaces:**

- Consumes: `usePaymentSheet` da Task 4.
- Produces: `selectResumeKind` devolve `'native-stripe'` no iOS quando há chave.

- [ ] **Step 1: Write the failing test**

`selectResumeKind` (`src/cart/resume-selector.ts:27`) já é pura e não sabe de
plataforma: quem gateia o iOS é o chamador, em `orders.tsx:209`. Então o teste
precisa ser do chamador. Extrair a expressão.

```typescript
// apps/mobile/src/cart/__tests__/resume-stripe-availability.test.ts
import { describe, expect, it } from 'vitest';

import { stripeResumeAvailable } from '../resume-stripe-availability';

describe('stripeResumeAvailable', () => {
  // Canon §F8.16 used to force `false` here on iOS, so an iOS member with a
  // pending card order had no way at all to pay it — kind === 'none', no button.
  it('is available on iOS when a publishable key is configured', () => {
    expect(stripeResumeAvailable({ platform: 'ios', hasPublishableKey: true })).toBe(true);
  });

  it('is available on android', () => {
    expect(stripeResumeAvailable({ platform: 'android', hasPublishableKey: true })).toBe(true);
  });

  it('is unavailable without a key', () => {
    expect(stripeResumeAvailable({ platform: 'ios', hasPublishableKey: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/cart/__tests__/resume-stripe-availability.test.ts`
Expected: FAIL, não resolve `../resume-stripe-availability`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/mobile/src/cart/resume-stripe-availability.ts
//
// Whether the "pay this pending order with a card" button may use the native
// Stripe sheet. Until 2026-08-29 this was hardcoded false on iOS under canon
// §F8.16, which left iOS members with a pending card order and no way to pay
// it: selectResumeKind fell through to 'none' and rendered nothing.
export const stripeResumeAvailable = (args: {
  platform: string;
  hasPublishableKey: boolean;
}): boolean => args.hasPublishableKey;
```

Em `app/(app)/profile/orders.tsx`:

Trocar as linhas 206-209 (o comentário do canon mais o valor) por:

```typescript
    stripeAvailable: stripeResumeAvailable({
      platform: Platform.OS,
      hasPublishableKey: STRIPE_AVAILABLE,
    }),
```

E trocar o corpo de `PayWithStripeButton` para usar o seam, substituindo as
linhas 93 e 111-123:

```typescript
const { pay } = usePaymentSheet();
```

```typescript
const outcome = await pay(data.clientSecret);
if (outcome.kind === 'cancelled') return;
if (outcome.kind === 'failed') {
  Alert.alert(ordersCopy.payError, paymentsCopy.sheet.failed);
  return;
}
reload();
```

Remover os imports que ficarem órfãos: `PaymentSheetError` e `useStripe` de
`@stripe/stripe-react-native` saem se nada mais os usar no arquivo. Rodar o lint
para confirmar.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/cart/`
Expected: PASS, incluindo `resume-selector.test.ts` que já existia.

Run: `pnpm --filter @ccc/mobile lint`
Expected: PASS, sem import não usado.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/cart "apps/mobile/app/(app)/profile/orders.tsx"
git commit -m "feat(mobile): retomada de pedido usa o seam do PaymentSheet no iOS"
```

---

### Task 8: Apagar o botão morto de RevenueCat

`src/screens/settings/PremiumScreen.tsx:165-188` renderiza "Assinar Gold" no iOS,
chamando `fetchOfferings()` (`:116`) contra um SDK que **nunca é inicializado**:
`src/lib/revenuecat.ts:26` define `initRevenueCat` e não existe chamador nenhum no
app. A rota é alcançável por deep link. Botão de compra que não faz nada é
rejeição 2.1 sozinho.

**Não ligar a RevenueCat.** Isso reverteria decisão registrada. O botão sai.

O ramo Android (`:178-187`) abre `WebBrowser` para o checkout hospedado. Ele
**fica** nesta task; migrar ou não é a Task 13, depois de H4.

**Files:**

- Modify: `apps/mobile/src/screens/settings/PremiumScreen.tsx:1-13`, `:33`, `:58`, `:111-132`, `:164-188`
- Test: `apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx:265-320` (arquivo existente)

**Interfaces:**

- Produces: `PremiumScreen` não importa mais nada de `~/lib/revenuecat`.
  `src/lib/revenuecat.ts` fica no repo, sem chamador, e é assunto de outro plano.

- [ ] **Step 1: Write the failing test**

Substituir os casos existentes que afirmam a presença do CTA iOS. Os asserts em
`:269`, `:297-313` afirmam o contrário do que passa a valer.

```typescript
// em apps/mobile/src/screens/settings/__tests__/PremiumScreen.test.tsx
// Trocar o caso de :269 e o de :297 por estes dois.

// A purchase button wired to an uninitialised SDK is an App Store 2.1
// rejection on its own: it does nothing when tapped, and the route is
// deep-linkable so a reviewer can reach it without a tab.
it('never renders an iOS RevenueCat CTA', async () => {
  platform.OS = 'ios';
  await renderScreen();
  expect(container.querySelector('[data-testid="premium-cta-ios"]')).toBeNull();
});

it('never calls into the RevenueCat SDK', async () => {
  platform.OS = 'ios';
  await renderScreen();
  expect(mockFetchOfferings).not.toHaveBeenCalled();
  expect(mockPurchasePackage).not.toHaveBeenCalled();
});
```

Manter o caso de `:315` (Android abre `WebBrowser`), que continua verdadeiro.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/settings/__tests__/PremiumScreen.test.tsx`
Expected: FAIL, o CTA iOS monta.

- [ ] **Step 3: Write minimal implementation**

Em `PremiumScreen.tsx`:

- Apagar o import da linha 33 (`import { fetchOfferings, purchasePackage } from '~/lib/revenuecat';`).
- Apagar `onSubscribeIos` inteira (linhas 111-132) e o state `purchasing`
  (linha 58) com todos os usos.
- Substituir o bloco 164-188 pelo ramo único que sobra:

```tsx
{
  /* Subscribe CTA. The iOS branch used to call a RevenueCat SDK that is
          never initialised (lib/revenuecat.ts has no caller), so the button did
          nothing when tapped — an App Store 2.1 finding by itself. Removed on
          2026-08-29; RevenueCat was deliberately NOT wired up. */
}
{
  showSubscribeCTA ? (
    <Pressable
      onPress={() => void onSubscribeAndroid()}
      style={styles.cta}
      accessibilityRole="button"
      accessibilityLabel="Assinar Premium Gold"
      testID="premium-cta-android"
    >
      <Text style={styles.ctaText}>Assinar Gold</Text>
    </Pressable>
  ) : null;
}
```

- Atualizar o comentário de cabeçalho (linhas 1-13): a linha
  `// iOS  → CTA calls purchasePackage from ~/lib/revenuecat (canon §F8.16: no Stripe).`
  sai e é substituída por
  `// Subscribe CTA opens the hosted web checkout. Native migration is tracked as H4/Task 13.`
- Se `Platform` ficar sem uso no arquivo, remover o import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/settings/`
Expected: PASS.

Run: `pnpm --filter @ccc/mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/settings
git commit -m "fix(mobile): remove o botao morto de RevenueCat do PremiumScreen"
```

---

### Task 9: Remover o encaminhamento externo e o "em breve"

Correção C2 do spec, e é rejeição autônoma no binário de hoje.
`src/copy/assinaturas.ts:73-74` entrega `'Contratação pelo site.'` e
`'No iPhone a contratação é feita pelo site da Casa Car Club.'`, renderizados em
`ContratarScreen.tsx:311-315`. Isso é encaminhamento para método de compra externo
dentro do app, na storefront do Brasil. O chapeau de 3.1.3 proíbe: a exceção vale
só para a storefront dos EUA. Com pagamento nativo funcionando, também é
desnecessário.

Junto sai `'Assinaturas em breve.'`. **Nota de verificação:** o spec e o briefing
apontam `copy/assinaturas.ts:89`; a string está de fato em **`:101`**
(`unavailableTitle`), com `:102` como subcopy. A linha 89 é `usageAccess`. O
estado `billingUnavailable` que consome essas duas strings continua existindo
(`MinhaAssinaturaScreen.tsx:388-395`, disparado por 503 de
`GROWTH_PREMIUM_BILLING_ENABLED`), então o trabalho é **reescrever** o texto, não
apagar o ramo. "Em breve" descreve um recurso que não existe; o que existe é
manutenção.

**Files:**

- Modify: `apps/mobile/src/copy/assinaturas.ts:73-74` e `:101-102`
- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx:311-325` e `:518-534` (estilos órfãos)
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx:362-374`
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx:370-374`

**Interfaces:**

- Produces: `assinaturasCopy.contratar` perde `iosTitle` e `iosSubcopy`.
  `assinaturasCopy.minhaAssinatura.unavailableTitle` muda de texto.

- [ ] **Step 1: Write the failing test**

```typescript
// em apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx
// Substituir o caso 6 (linhas 365-373).

// 6. iOS renders the same CTA as every other native platform. The old "contract
// on the website" notice was in-app steering to an external purchase method on
// the Brazil storefront, which the App Store 3.1.3 chapeau forbids outright.
it('renders the CTA on iOS like every other platform', async () => {
  platform.OS = 'ios';
  await renderScreen();

  expect(container.querySelector('[data-testid="contratar-cta"]')).not.toBeNull();
  expect(text()).not.toContain('pelo site');
  expect(text()).not.toContain('No iPhone');
});
```

```typescript
// em apps/mobile/src/screens/assinaturas/__tests__/MinhaAssinaturaScreen.test.tsx
// Substituir o caso da linha 370.

it('renders an informative state when billing is unavailable (503/flag off)', async () => {
  hookState.value = result({ billingUnavailable: true });
  await renderScreen();
  // "Em breve" describes a feature that does not exist. What actually happened
  // is a temporary outage, and the copy has to say that.
  expect(text()).not.toContain('em breve');
  expect(text()).toContain(assinaturasCopy.minhaAssinatura.unavailableTitle);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/`
Expected: FAIL nos dois casos.

- [ ] **Step 3: Write minimal implementation**

Em `src/copy/assinaturas.ts`, apagar as linhas 73-74 inteiras (`iosTitle` e
`iosSubcopy`) e trocar 101-102 por:

```typescript
    // Billing switched off (flag / 503). Not "coming soon": the feature exists
    // and is momentarily unavailable. Saying "em breve" to a member who already
    // pays reads as the product having been withdrawn.
    unavailableTitle: 'Assinaturas indisponíveis no momento.',
    unavailableSubcopy: 'Estamos em manutenção. Tente de novo em alguns minutos.',
```

Em `ContratarScreen.tsx`, trocar o ternário das linhas 311-325 pelo CTA sem
condicional:

```tsx
<TierCta
  tier={plan.tier}
  label={submitting ? copy.ctaLoading : copy.cta}
  onPress={() => void onSubmit()}
  disabled={submitting}
  loading={submitting}
  testID="contratar-cta"
/>
```

Apagar os estilos `iosNotice`, `iosTitle` e `iosSubcopy` (linhas 518-534) e
remover `Platform` do import de `react-native` (linha 17) se nada mais no arquivo
o usar. Atualizar o comentário da linha 273 (`{/* Fixed footer — summary + CTA
(or the iOS web-contract notice). */}`) para `{/* Fixed footer — summary + CTA. */}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/`
Expected: PASS, incluindo o teste 6 reescrito da Task 6.

Confirmar que a string sumiu do código-fonte:

```bash
cd apps/mobile && grep -rn "pelo site\|No iPhone\|Assinaturas em breve" src app || echo "limpo"
```

Expected: `limpo`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/copy/assinaturas.ts apps/mobile/src/screens/assinaturas
git commit -m "fix(mobile): remove encaminhamento externo no iOS e o texto de em breve"
```

---

### Task 10: Benefícios renderizados no `ContratarScreen`

Decisão 6, parte (a). A versão anterior deste trabalho mirou no arquivo errado: os
benefícios do paywall **não** vêm de `copy/garage.ts`, vêm do banco, por
`GET /api/plans/:slug` (`src/api/premium-catalog.ts:36-37` →
`apps/api/src/routes/premium-catalog.ts`). `PlanosScreen.tsx:116-121` e
`PlanoDetalheScreen.tsx:162-168` já renderizam a lista; `ContratarScreen.tsx:214-231`
renderiza tier, nome, preço e add-ons, e **nenhum benefício**. Essa é a última tela
antes do pagamento.

**Lembrete de dependência do Plano 1:** ele trocou o retorno de `getPremiumPlan`
para o envelope `{ plan, subscriptionsEnabled }`. Ler
`src/api/premium-catalog.ts` antes de mexer no `refresh` da tela.

**H3 é o que dá valor a esta task.** Renderizar uma lista de doze rótulos que não
mencionam a caixa não prova nada ao revisor. Cadastrar os rótulos é ação de Pedro
no admin, em produção, não código.

**Files:**

- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx:214-231`
- Modify: `apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx` (a constante `PLAN`, hoje com `benefits: []`, linha ~141)

**Interfaces:**

- Consumes: `orderedBenefits(plan)` de `~/screens/assinaturas/tier-visual`
  (definida em `tier-visual.ts:97-99`, devolve `string[]` ordenado por
  `sortOrder`). É a mesma função que as outras duas telas usam.
- Produces: nada novo. Só render.

- [ ] **Step 1: Write the failing test**

```typescript
// em apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx

// The last screen before payment must show what the money buys. Decision 6:
// the physical box has to be visible BEFORE the purchase, and the box lives in
// these DB-backed benefit labels, not in any copy file.
it('renders the plan benefits, in sortOrder', async () => {
  getPremiumPlan.mockResolvedValue({
    ...PLAN,
    benefits: [
      { label: 'Caixa física trimestral na sua casa', sortOrder: 2 },
      { label: 'Acesso ao clube 24 horas', sortOrder: 1 },
    ],
  });
  await renderScreen();

  const body = text();
  expect(body).toContain('Acesso ao clube 24 horas');
  expect(body).toContain('Caixa física trimestral na sua casa');
  expect(body.indexOf('Acesso ao clube 24 horas')).toBeLessThan(
    body.indexOf('Caixa física trimestral na sua casa'),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/__tests__/ContratarScreen.test.tsx`
Expected: FAIL, nenhum dos dois rótulos aparece.

- [ ] **Step 3: Write minimal implementation**

Em `ContratarScreen.tsx`, importar `Check` de `lucide-react-native` e
`orderedBenefits` do `tier-visual` (o import de `tier-visual` já existe na linha
34; acrescentar o nome à lista). Calcular `const benefits = orderedBenefits(plan);`
junto de `visual` e `t` (linha 177), e inserir um bloco logo depois do `planCard`
que fecha na linha 231:

```tsx
{
  benefits.length > 0 ? (
    <View style={styles.benefitsSection}>
      <Text style={styles.benefitsTitle}>{assinaturasCopy.detail.benefitsTitle}</Text>
      <View style={styles.benefits}>
        {benefits.map((benefit) => (
          <View key={benefit} style={styles.benefitRow}>
            <Check color={visual.accent} size={18} strokeWidth={2} style={styles.benefitIcon} />
            <Text style={styles.benefitText}>{benefit}</Text>
          </View>
        ))}
      </View>
    </View>
  ) : null;
}
```

`assinaturasCopy.detail.benefitsTitle` já existe (`copy/assinaturas.ts:36`,
`'O QUE ESTÁ INCLUÍDO'`) e é o mesmo título que `PlanoDetalheScreen` usa. Não
criar chave nova.

Estilos, copiados de `PlanoDetalheScreen.tsx:287-303` para manter as duas telas
iguais:

```typescript
  benefitsSection: { marginTop: 28 },
  benefitsTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  benefits: { marginTop: 16, gap: 13 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  benefitIcon: { marginTop: 1 },
  benefitText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 19,
    color: c.cream,
  },
```

O mock de `lucide-react-native` no teste (`ContratarScreen.test.tsx:414-418`
aproximadamente) hoje só exporta `ArrowLeft`. Acrescentar `Check: icon` ao objeto
devolvido, senão o render quebra.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/__tests__/ContratarScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/assinaturas
git commit -m "feat(mobile): contratacao renderiza os beneficios do plano"
```

---

### Task 11: Caixa física e cadência de entrega antes da compra

Decisão 6, parte (b). Os rótulos de benefício (H3) descrevem o que vem na caixa.
Falta o enquadramento: que existe uma caixa física, que ela é entregue no endereço
do membro, e com que frequência. Isso é o que transforma a assinatura de "pacote
digital" em "bens físicos consumidos fora do app", que é o terreno da 3.1.3(e).

**Escolha registrada:** o bloco é copy estática, não campo novo de API.
`monthlyBoxBudgetCents` existe no modelo e nunca é serializado; decidir se o valor
aparece é questão em aberto no spec e **não** é resolvida aqui. Um bloco de copy
não promete valor em reais, promete a existência da caixa. Se depois a API passar
a serializar o orçamento, este bloco é onde ele entra.

**Risco que precisa estar nas notas de review, do próprio spec:** o paywall promete
a caixa e `navigation/caixa-slot.ts:7` esconde a aba de quem não é premium.
Prometer no paywall o que a navegação esconde é exposição 2.3.1. A Decisão 8 (H5)
é o que sustenta isto.

**Files:**

- Modify: `apps/mobile/src/copy/assinaturas.ts` (novo bloco `caixa` dentro de `contratar`)
- Modify: `apps/mobile/src/screens/assinaturas/ContratarScreen.tsx`
- Modify: `apps/mobile/src/screens/assinaturas/PlanoDetalheScreen.tsx`
- Test: `apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx`

**Interfaces:**

- Produces: `assinaturasCopy.contratar.caixa` com `title`, `body` e `delivery`.

- [ ] **Step 1: Write the failing test**

```typescript
// em apps/mobile/src/screens/assinaturas/__tests__/ContratarScreen.test.tsx

// Decision 6: the physical box has to be visible BEFORE the purchase, framed
// as a physical good delivered to an address. Guideline 3.1.3(e) turns on the
// word "physical", and a reviewer only sees what the paywall renders.
it('states the physical box and its delivery cadence before purchase', async () => {
  await renderScreen();
  const body = text();
  expect(body).toContain(assinaturasCopy.contratar.caixa.title);
  expect(body).toContain(assinaturasCopy.contratar.caixa.delivery);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/__tests__/ContratarScreen.test.tsx`
Expected: FAIL, `assinaturasCopy.contratar.caixa` é `undefined`.

- [ ] **Step 3: Write minimal implementation**

Em `src/copy/assinaturas.ts`, dentro de `contratar`, logo depois de
`modulesSubcopy` (linha 45):

```typescript
    // Decisão 6 — the physical side of the membership, stated before purchase.
    // The per-plan contents come from the DB benefit labels (registered by hand
    // in /premium/catalogo, prerequisite H3); this block is the framing that
    // makes them read as a physical delivery rather than an app feature.
    caixa: {
      title: 'A CAIXA CASA CAR CLUB',
      body: 'Sua assinatura inclui uma caixa física com curadoria da Casa, entregue no endereço cadastrado na sua conta.',
      delivery: 'Entrega mensal, sem custo adicional de frete.',
    },
```

`assinaturas.ts` é PT-only hoje: não tem objeto `en`, ao contrário de
`copy/garage.ts` e `copy/badges.ts`. Para cumprir o mandato de i18n sem reescrever
o arquivo inteiro, acrescentar no fim, antes do `export type`:

```typescript
/**
 * EN scaffold. This file was PT-only until 2026-08-29; only the keys added from
 * that date on carry an EN twin, so the eventual move to a shared locale package
 * is mechanical instead of a rewrite.
 */
export const assinaturasCopyEn = {
  contratar: {
    caixa: {
      title: 'THE CASA CAR CLUB BOX',
      body: 'Your membership includes a physical box curated by the Casa, delivered to the address on your account.',
      delivery: 'Delivered monthly, shipping included.',
    },
  },
} as const;
```

**Antes de escrever `delivery`, confirmar a cadência real com Pedro.** "Entrega
mensal" é o que a existência de `monthlyBoxBudgetCents` sugere, mas orçamento
mensal não prova entrega mensal. Prometer uma cadência errada no paywall é
exatamente a exposição 2.3.1 que a Decisão 6 tenta fechar.

Em `ContratarScreen.tsx`, renderizar o bloco logo abaixo dos benefícios da
Task 10:

```tsx
<View style={styles.caixaCard}>
  <Text style={styles.caixaTitle}>{copy.caixa.title}</Text>
  <Text style={styles.caixaBody}>{copy.caixa.body}</Text>
  <Text style={styles.caixaDelivery}>{copy.caixa.delivery}</Text>
</View>
```

```typescript
  caixaCard: {
    marginTop: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.tileBorder,
    backgroundColor: c.surface,
    padding: 18,
    gap: 8,
  },
  caixaTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 2.8,
    color: c.goldDeep,
  },
  caixaBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20, color: c.cream },
  caixaDelivery: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: c.muted55 },
```

Repetir o mesmo bloco em `PlanoDetalheScreen.tsx`, abaixo da lista de benefícios
que já existe em `:162-168`. `PlanosScreen` é a lista de comparação e fica de
fora: ela renderiza três cards lado a lado e o bloco repetido três vezes vira
ruído. **Ler `PlanoDetalheScreen.tsx` antes de editar**; os nomes de estilo
`benefits`/`benefitRow` já existem lá e não podem colidir.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/screens/assinaturas/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/copy/assinaturas.ts apps/mobile/src/screens/assinaturas
git commit -m "feat(mobile): caixa fisica e cadencia de entrega visiveis no paywall"
```

---

### Task 12: Reescrever a folha "O que é Premium?"

Decisão 6, parte secundária, e o spec é explícito sobre isso: **é a folha da
garagem, não o paywall.** Ela lista dois benefícios puramente digitais em
`copy/garage.ts:105-108` (PT) e `:221-224` (EN). O comentário logo acima
(`:99-104`) registra que "Garagem em destaque" e "Página pública premium" foram
removidos em 2026-08-14 por não existirem no código, e adverte que prometer
benefício não implementado é exposição 2.3.1. **Essa advertência continua valendo
para o que for acrescentado agora.**

**Files:**

- Modify: `apps/mobile/src/copy/garage.ts:105-108` e `:221-224`
- Test: `apps/mobile/src/copy/__tests__/garage-premium-benefits.test.ts` (criar)

**Interfaces:**

- Produces: `garageCopy.garage.premiumBenefits` e
  `garageCopyEn.garage.premiumBenefits` passam a citar a caixa física.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/mobile/src/copy/__tests__/garage-premium-benefits.test.ts
import { describe, expect, it } from 'vitest';

import { garageCopy, garageCopyEn } from '../garage';

// Two purely digital benefits is the shape that makes the membership read as a
// digital bundle, which is the 3.1.1 argument the spec says Decision 6 only
// weakens rather than removes. The physical box has to be in the list a member
// reads while deciding.
describe('premium explainer sheet', () => {
  it('mentions the physical box in PT', () => {
    const titles = garageCopy.garage.premiumBenefits.map((b) => b.title).join(' | ');
    expect(titles.toLowerCase()).toContain('caixa');
  });

  it('mentions the physical box in EN', () => {
    const titles = garageCopyEn.garage.premiumBenefits.map((b) => b.title).join(' | ');
    expect(titles.toLowerCase()).toContain('box');
  });

  // Both lists must stay the same length: a reviewer reading EN must see the
  // same promises as one reading PT.
  it('keeps PT and EN in lockstep', () => {
    expect(garageCopyEn.garage.premiumBenefits).toHaveLength(
      garageCopy.garage.premiumBenefits.length,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/copy/__tests__/garage-premium-benefits.test.ts`
Expected: FAIL nos dois primeiros casos.

- [ ] **Step 3: Write minimal implementation**

Em `src/copy/garage.ts`, substituir o array de `:105-108`:

```typescript
    premiumBenefits: [
      {
        title: 'Caixa física da Casa',
        sub: 'Curadoria entregue no seu endereço, incluída na assinatura.',
      },
      { title: 'Capas personalizadas', sub: 'Escolha entre 9 cenários ou envie a sua.' },
      { title: 'Selo Premium', sub: 'Aparece nos seus carros em todo o app.' },
    ],
```

E o de `:221-224`:

```typescript
    premiumBenefits: [
      { title: 'The Casa box', sub: 'A curated box delivered to your address, included.' },
      { title: 'Custom covers', sub: 'Pick from 9 scenes or upload your own.' },
      { title: 'Premium badge', sub: 'Appears on your cars across the app.' },
    ],
```

Manter o comentário de `:99-104` intacto, e acrescentar uma linha ao fim dele:

```typescript
// 2026-08-29: a caixa física entra aqui por causa da Decisão 6. Ela existe
// e é entregue; a advertência acima continua valendo para qualquer item
// novo que ainda não exista no produto.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/copy/`
Expected: PASS, 3 testes.

Run: `cd apps/mobile && pnpm exec vitest run src/screens/garage/`
Expected: PASS. Se algum teste da folha contava dois itens, atualizar.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/copy/garage.ts apps/mobile/src/copy/__tests__
git commit -m "feat(mobile): folha O que e Premium cita a caixa fisica, PT e EN"
```

---

### Task 13: Android — Google Pay e hospedado versus nativo

**BLOQUEADA POR H4.** O spec é direto: o plano precisa **forçar a decisão** em vez
de deixar isso embarcar sem exame. Com a Task 1 e a Task 5 dentro, o Android já
ganhou a folha nativa no carrinho, porque `_layout.tsx:222` só gateava iOS e
`orders.tsx:209` já habilitava Stripe fora do iOS. Duas coisas ficaram por
decidir, e as duas são de produto, escondidas dentro de mudança de código.

**Fato verificado que corrige o spec:** em `@stripe/stripe-react-native` 0.50.3,
Google Pay é **opt-in**, não opt-out. `PaymentSheet.d.ts:18` declara
`googlePay?: GooglePayParams` e `:120-135` exige `merchantCountryCode`. Ele
**não** aparece a menos que seja passado. A Task 4 não passa. Então o estado atual
já é "Google Pay desligado", e a decisão (a) é entre manter assim e ligar de
propósito, não entre suprimir e aceitar.

- [ ] **Step 0: Registrar a decisão**

Copiar a decisão de H4 para o topo desta task, com data, antes de tocar em código.
Se ela não existir por escrito, **parar aqui** e devolver a task.

- [ ] **Step 1: Write the failing test**

Ramo (a-1), Google Pay **ligado**:

```typescript
// em apps/mobile/src/payments/__tests__/payment-sheet.test.ts
// Substituir o caso 'does not declare Google Pay yet'.

// Decision H4, recorded on <data>: Google Pay is offered on Android.
it('declares Google Pay on Android', () => {
  const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'android' });
  expect(cfg.googlePay).toEqual({ merchantCountryCode: 'BR', currencyCode: 'BRL', testEnv: false });
});

it('does not declare Google Pay on iOS', () => {
  const cfg = buildPaymentSheetConfig({ clientSecret: 'pi_1_secret_x', platform: 'ios' });
  expect(cfg.googlePay).toBeUndefined();
});
```

Ramo (a-2), Google Pay **desligado**: manter o caso que a Task 4 já escreveu e
trocar o comentário dele de `until the Android decision (H4 / Task 13) is
recorded` para `Decision H4, recorded on <data>: Google Pay stays off on
Android.` Sem essa troca, o comentário mente sobre o estado do produto.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/payments/__tests__/payment-sheet.test.ts`
Expected: no ramo (a-1), FAIL. No ramo (a-2), PASS já no passo 2, e a task vira só
a troca de comentário mais a parte (b).

- [ ] **Step 3: Write minimal implementation**

Ramo (a-1), em `src/payments/payment-sheet.ts`, acrescentar ao objeto de
`buildPaymentSheetConfig`:

```typescript
  ...(args.platform === 'android'
    ? { googlePay: { merchantCountryCode: 'BR', currencyCode: 'BRL', testEnv: false } }
    : {}),
```

`testEnv: false` exige que a conta já tenha acesso ao ambiente de produção do
Google Pay. Se não tiver, o valor é `true` e a folha paga em ambiente de teste.
Conferir antes de mandar build.

Parte (b), o destino do Android. Depois da Task 6, `startPremiumCheckout` já leva
**todo** nativo para a folha, incluindo Android, e `PremiumScreen` continua
abrindo `WebBrowser`. Isso é incoerente e é exatamente o que H4 precisa resolver.

- (b-1) **Android nativo**, o padrão que as Tasks 6 e 8 já deixaram meio pronto:
  em `PremiumScreen.tsx`, trocar `onSubscribeAndroid` por uma navegação para
  `/assinaturas/contratar`, que já paga pela folha. `expo-web-browser`,
  `baseUrl` e `DEEP_LINK_RETURN` (`PremiumScreen.tsx:16,29,38`) saem se ninguém
  mais os usar.
- (b-2) **Android hospedado**: em `checkout.ts`, restringir o ramo nativo a
  `Platform.OS === 'ios'` e devolver o Android ao caminho de
  `openAuthSessionAsync` que a Task 6 preservou em comentário. Nesse caso o
  comentário longo sobre `_openAuthSessionPolyfillAsync` volta a ser código vivo
  e precisa voltar ao seu lugar original, não ficar no cabeçalho.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/payments/ src/screens/assinaturas/ src/screens/settings/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): decisao de Android sobre Google Pay e checkout nativo"
```

---

### Task 14: Varredura de abas com placeholder

Blocker 2.1 do rastreador, que a correção C8 do spec confirma como **aberto**.
Aba primária que cai em placeholder no binário submetido é achado 2.1. As strings
conhecidas, todas âncoras de 2026-08-29:

- `src/screens/settings/PremiumScreen.tsx:83` — `'Premium em breve'`, rota
  alcançável por deep link.
- `src/copy/caixa.ts:92` — `'Catálogo em curadoria'` / `'Novos itens aparecem aqui em breve.'`
- `src/copy/events.ts:23` — `'Volte em breve. O cenário não para.'` (estado vazio,
  legítimo se houver eventos publicados)
- `src/copy/events.ts:33` — `'EM BREVE'` (badge de evento futuro, legítimo)
- `src/copy/auth.ts:128` — `'Você está dentro. Em breve, eventos e ingressos.'`
- `src/copy/assinaturas.ts:101-102` — resolvido na Task 9.

**Files:**

- Test: `apps/mobile/src/navigation/__tests__/no-placeholder-tabs.test.ts` (criar)
- Modify: o que a varredura encontrar

**Interfaces:**

- Produces: nada. É rede de segurança.

- [ ] **Step 1: Write the failing test**

Guarda estática. Ela não substitui a passada manual, ela impede a regressão.

```typescript
// apps/mobile/src/navigation/__tests__/no-placeholder-tabs.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

// Every screen a primary tab lands on. A reviewer taps each of these; landing
// on "em breve" is a 2.1 finding on its own.
// Paths confirmed on 2026-08-29 with `ls apps/mobile/app/\(app\)/`. Note that
// inicio is a FILE, not a directory with an index.
const TAB_LANDINGS = [
  'app/(app)/inicio.tsx',
  'app/(app)/events/index.tsx',
  'app/(app)/store/index.tsx',
  'app/(app)/cart/index.tsx',
  'app/(app)/profile/index.tsx',
];

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('primary tab landings', () => {
  it('renders no "em breve" placeholder inline', () => {
    for (const rel of TAB_LANDINGS) {
      expect(read(rel).toLowerCase(), rel).not.toContain('em breve');
    }
  });
});
```

**Reconferir os caminhos com `ls apps/mobile/app/\(app\)/` antes de rodar.** Um
teste que lê arquivo inexistente falha por motivo errado.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm exec vitest run src/navigation/__tests__/no-placeholder-tabs.test.ts`
Expected: pode passar de primeira, porque as strings vivem nos arquivos de copy e
não inline nas telas. Se passar, o teste ainda vale como guarda, e o trabalho real
é o passo 3.

- [ ] **Step 3: Varredura manual, com registro**

Rodar a busca e classificar **cada** ocorrência em uma de três linhas: legítima
(estado vazio ou badge), resolvida por outra task, ou a corrigir aqui.

```bash
cd apps/mobile && grep -rn "em breve\|Em breve\|EM BREVE" src app --include='*.ts' --include='*.tsx'
```

Com `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED=true` nos dois perfis, o banner de
`PremiumScreen.tsx:83` não aparece em build de preview nem de produção. Ele
continua sendo a única string do app que diz que um recurso não existe, numa rota
alcançável por deep link. Trocar por texto de manutenção, como na Task 9:

```typescript
        <Text style={styles.maintenanceText}>Assinaturas indisponíveis no momento.</Text>
```

`src/copy/caixa.ts:92` é o estado vazio do catálogo da caixa. Com
`EXPO_PUBLIC_CAIXA_ENABLED` desligada (H5), a aba da caixa não aparece, então isso
não é alcançável no binário submetido. **Registrar como dependente de H5 e não
mexer.**

`events.ts:23` e `:33` e `auth.ts:128` são estados vazios e badge, não
placeholders de recurso ausente. Deixar.

Depois: instalar o build de preview num aparelho e tocar em **cada** aba, mais os
deep links `ccc://premium`, `ccc://assinaturas/contratar`, `ccc://caixa`.
Registrar o resultado no PR.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm exec vitest run src/navigation/ src/screens/settings/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "fix(mobile): varredura de placeholder nas abas primarias"
```

---

### Task 15: Os oito docs com `com.jdmexperience.app`

Correção C5 do spec. `docs/eas-credentials.md` **já está correto** e usa
`com.casacarclub.app`. **Não tocar nele.**

**Nota de verificação, e ela muda o tamanho da task:** só três dos oito arquivos
contêm literalmente `com.jdmexperience.app` — `docs/mobile-build.md` (linhas 62 e
184), `docs/revenuecat.md` (linhas 17, 42, 62) e `docs/manual-testing.md` (linhas
273-274). Os outros cinco carregam marca JDM de outra forma, o que é o mesmo
defeito com outra roupa:

- `docs/secrets.md:9` — `noreply@jdmexperience.com.br`
- `docs/vercel.md:10,26,38,47` — repo `leaopedro/jdm`, org `jdm-experience`,
  domínio `admin.jdmexperience.com.br`
- `docs/mobile-web.md:33,34,53,66,75` — projeto `jdm-mobile-web`, domínio
  `app.jdmexperience.com.br`, API `jdm-production.up.railway.app`
- `docs/railway.md:11,19,105` — projeto `jdm-experience`, e-mail de smoke
- `docs/legal/encarregado.md` — **BLOQUEADO POR H6**

O domínio canônico é `casacar.club`, nunca `casacarclub.com.br`. Nomes de projeto
reais no Railway e no Vercel estão em `railway-r2-prod-config.md`; usar os nomes
de lá, não inventar.

`docs/revenuecat.md:16-18` já tem um aviso dizendo que o conteúdo é da JDM e que
nada ali vale para o Casa Car Club. Esse arquivo pode ficar como está, **desde que
o aviso fique acima de tudo e seja inequívoco**. Reescrever um guia de RevenueCat
inteiro para um SDK que a Task 8 acabou de tirar do caminho é trabalho jogado
fora.

**Files:**

- Modify: `docs/mobile-build.md`, `docs/secrets.md`, `docs/vercel.md`,
  `docs/mobile-web.md`, `docs/railway.md`, `docs/manual-testing.md`
- Modify: `docs/revenuecat.md` (só o aviso de topo)
- Modify: `docs/legal/encarregado.md` (**só depois de H6**)
- Test: `docs/__tests__` não existe; a verificação é o `grep` do passo 4

- [ ] **Step 1: Inventariar**

```bash
cd /Users/pedro/Projects/ccc/ccc-app && for f in docs/mobile-build.md docs/secrets.md docs/vercel.md docs/mobile-web.md docs/railway.md docs/manual-testing.md docs/legal/encarregado.md; do
  echo "--- $f"; grep -in "jdm" "$f"
done
```

Colar a saída no PR. É o que prova que a varredura foi feita, e não uma
substituição cega.

- [ ] **Step 2: Confirmar o alvo de cada linha**

Bundle ids: `com.jdmexperience.app` → `com.casacarclub.app`, mantendo os sufixos
`.dev` e `.preview`.
Domínios: `*.jdmexperience.com.br` → o subdomínio equivalente sob `casacar.club`
(a API de produção é `api.casacar.club`, conforme `eas.json:29,41`).
Nomes de projeto Railway e Vercel: usar os que estão em
`railway-r2-prod-config.md`, não traduzir na mão.
Identificadores de issue `JDMA-###`: **deixar como estão.** São chaves de tracker
histórico; reescrevê-las quebra a rastreabilidade e não engana revisor nenhum.

- [ ] **Step 3: Editar**

Um commit por arquivo, para revisão granular. Em `docs/legal/encarregado.md`,
trocar **apenas** o que H6 confirmou por escrito. Nome de controlador e e-mail de
Encarregado são fatos jurídicos publicados; um busca-e-substitui aqui cria um
documento LGPD que aponta para uma caixa que não existe.

- [ ] **Step 4: Verificar**

```bash
cd /Users/pedro/Projects/ccc/ccc-app && grep -rn "com.jdmexperience.app" docs/ --include='*.md' | grep -v "docs/superpowers/"
```

Expected: nenhuma saída. As ocorrências sob `docs/superpowers/` são specs e planos
históricos e ficam; reescrever registro passado apaga o motivo de a correção
existir.

```bash
cd /Users/pedro/Projects/ccc/ccc-app && grep -rin "jdmexperience.com.br" docs/ --include='*.md' | grep -v "docs/superpowers/"
```

Expected: nenhuma saída, ou só `docs/revenuecat.md` sob o aviso de topo e
`docs/legal/encarregado.md` se H6 ainda não tiver saído.

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: troca a marca JDM residual pela do Casa Car Club"
```

---

### Task 16: Suíte completa, lint e notas de review

- [ ] **Step 1: Suíte inteira do mobile**

Run: `pnpm --filter @ccc/mobile test`
Expected: PASS. O arquivo `ios-stripe-isolation.test.ts` não existe mais (Task 1);
se ele reaparecer, alguém desfez a Task 1 num merge.

- [ ] **Step 2: Suíte dos pacotes tocados indiretamente**

Run: `pnpm --filter @ccc/shared test && pnpm --filter @ccc/api test`
Expected: PASS. A API precisa de Docker rodando para os Testcontainers; ver
`api-test-setup-gotchas.md`.

- [ ] **Step 3: Lint por pacote**

Run: `pnpm --filter @ccc/mobile lint && pnpm --filter @ccc/shared lint`
Expected: PASS. Não rodar `eslint .` na raiz; estoura memória.

- [ ] **Step 4: Notas de review, no PR**

Registrar, com estas palavras:

- Canon §F8.16 foi supersedido, não apagado, com data e motivo
  (`docs/superpowers/plans/2026-05-26-f8-billing-chunks-skeleton.md:52`).
- A citação correta de diretriz é **3.1.3(e)**, não `3.1.5(a)`. `3.1.5` hoje é
  "Cryptocurrencies". A palavra que sustenta o argumento é **physical**.
- Google Pay é **opt-in** em `@stripe/stripe-react-native` 0.50.3
  (`PaymentSheet.d.ts:18`), ao contrário do que o spec afirma. A decisão de H4
  está registrada na Task 13.
- **Risco aberto, da Decisão 6:** o paywall promete a caixa e
  `navigation/caixa-slot.ts:7` esconde a aba de quem não é premium. Prometer no
  paywall o que a navegação esconde é exposição 2.3.1. A Decisão 8 (H5) é o que
  sustenta a promessa, e H5 **não** é código deste plano.
- `EXPO_PUBLIC_CAIXA_ENABLED` continua **desligada**. Ligá-la depende de H5,
  incluindo a confirmação com a AbacatePay de que uma cobrança Pix é impagável
  depois do `expiresIn`.
- Apple Pay não foi verificado em CI, e não pode ser: exige aparelho físico
  (H7). Anexar a evidência manual.
- H3 (cadastro dos rótulos de benefício no admin de produção) é o que dá valor às
  Tasks 10 e 11. Sem ele o paywall renderiza doze rótulos que não mencionam a
  caixa, e o revisor não vê prova física nenhuma.

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore(mobile): suite verde e notas de review dos pagamentos"
```

---

## Notas para quem executa

- Os números de linha são **âncoras de 2026-08-29**. As Tasks 5, 6, 7, 9, 10 e 11
  editam os mesmos arquivos; a partir da segunda, as âncoras andaram. Ler antes
  de editar, sempre.
- As Tasks 5 e 6 consomem interface do Plano 2, que ainda não estava escrito
  quando este plano foi redigido. Os nomes `flow: 'native'` e
  `createPremiumSubscriptionNative` são **suposições derivadas do spec**, não
  código lido. Conferir em `packages/shared/src/cart.ts`,
  `packages/shared/src/premium.ts` e `apps/mobile/src/api/premium.ts` antes de
  escrever, e ajustar.
- A Task 6 deixa o teste 6 de `ContratarScreen.test.tsx` vermelho até a Task 9. É
  a única janela vermelha planejada. Não abrir PR entre as duas.
- Ordem obrigatória: Task 1 antes de tudo (sem `StripeProvider` no iOS nada
  monta), Task 3 antes de qualquer build de produção (sem chave o provider não
  monta lá), Task 2 depois de H1, Task 13 depois de H4.
- O dinheiro continua entrando só por webhook verificado. O `PaymentSheet`
  confirma a PaymentIntent; nenhuma tela deste plano marca pedido como pago.
- As três corridas que a revisão achou no fluxo avulso — `handleCartFailure` não
  cancelar a PaymentIntent, folha velha confirmando com `clientSecret` velho, e a
  ausência de worker de expiração — são **do lado da API** e pertencem ao Plano 2.
  Este plano não as fecha, e o `PaymentSheet` nativo as torna alcançáveis. Se o
  Plano 2 não as tiver fechado, sinalizar antes de mandar build.
