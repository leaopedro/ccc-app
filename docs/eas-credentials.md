# EAS and store setup runbook

Goal: configure Apple, Google Play, and Expo/EAS for the mobile app profiles
already checked into the repo, then produce the first working builds for Phase
0.9.

This document is the source of truth for `JDMA-116`.

## What exists in the repo today

`apps/mobile/app.config.ts` already pins these variants:

| Profile     | `APP_VARIANT` | iOS bundle id                 | Android package               | Intended use                             |
| ----------- | ------------- | ----------------------------- | ----------------------------- | ---------------------------------------- |
| development | development   | `com.casacarclub.app.dev`     | `com.casacarclub.app.dev`     | First EAS dev-client / simulator proof   |
| preview     | preview       | `com.casacarclub.app.preview` | `com.casacarclub.app.preview` | Internal device builds for smoke testing |
| production  | production    | `com.casacarclub.app`         | `com.casacarclub.app`         | App Store / Play Store release           |

`apps/mobile/eas.json` already pins:

- `development`: development client, iOS simulator build.
- `preview`: internal distribution, iOS device build, Android APK.
- `production`: store-targeted profile with submit stubs.

Implication:

- The fastest first proof is `development` on an iOS simulator.
- The first real-device build for push, Stripe native modules, and v0.1 smoke is
  `preview`, not `development`.
- Google Play is not required to install the first `preview` APK, but it is
  required before Play Internal / production submission.

## Secrets and storage rules

Never commit any of the following:

- Apple certificates, provisioning profiles, `.p8` keys.
- Google Play service-account JSON.
- Android upload keystores.
- `apps/mobile/.env`.
- `apps/mobile/secrets/play-service-account.json`.

Store locations:

- EAS hosted credentials: Apple certs/profiles, Android keystore.
- EAS secret store: `APPLE_ID`, `ASC_APP_ID` when submit is in scope.
- Local untracked file: `apps/mobile/.env` with `EAS_PROJECT_ID`.
- Local untracked file: `apps/mobile/secrets/play-service-account.json` only when
  running `eas submit` manually.
- GitHub Actions secrets: `EXPO_TOKEN`, `EAS_PROJECT_ID` when CI build automation
  starts.

## Step 1: Apple setup

Do this once before the first iOS device build.

### 1.0 Exact values for Casa Car Club

Use these values exactly.

#### App IDs

| Purpose            | Description field         | Bundle ID field               | Type              |
| ------------------ | ------------------------- | ----------------------------- | ----------------- |
| Dev variant        | `Casa Car Club (Dev)`     | `com.casacarclub.app.dev`     | `Explicit App ID` |
| Preview variant    | `Casa Car Club (Preview)` | `com.casacarclub.app.preview` | `Explicit App ID` |
| Production variant | `Casa Car Club`           | `com.casacarclub.app`         | `Explicit App ID` |

#### Merchant ID

| Field       | Value                          |
| ----------- | ------------------------------ |
| Description | `Casa Car Club Apple Pay`      |
| Identifier  | `merchant.com.casacarclub.app` |

This merchant identifier matches the checked-in mobile code:

- `apps/mobile/app/_layout.tsx` uses `merchantIdentifier="merchant.com.casacarclub.app"`.

#### App Store Connect record

Create this record now:

| Field            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Platforms        | `iOS`                                                                                      |
| Name             | `Casa Car Club`                                                                            |
| Primary language | `Portuguese (Brazil)` if available; otherwise the closest Portuguese option shown by Apple |
| Bundle ID        | `com.casacarclub.app`                                                                      |
| SKU              | `casa-car-club-ios-prod`                                                                   |
| User Access      | `Full Access`                                                                              |

Do not create the Store Connect record against `com.casacarclub.app.preview`
unless you explicitly want preview builds in TestFlight as a separate app record.

### 1.1 Confirm account access

- Apple Developer Program membership must be active.
- In App Store Connect, the acting user needs `Account Holder`, `Admin`, or
  `App Manager` to create app records.
- In the Apple Developer portal, the same team must own the bundle ids below.

### 1.2 Create the bundle identifiers

Create these App IDs in Apple Developer:

- `com.casacarclub.app.dev`
- `com.casacarclub.app.preview`
- `com.casacarclub.app`

Recommended display names:

- `Casa Car Club (Dev)`
- `Casa Car Club (Preview)`
- `Casa Car Club`

Apple screen inputs for each App ID:

1. `Certificates, Identifiers & Profiles` → `Identifiers` → `+`
2. Choose `App IDs`
3. Keep the default `App` type
4. Fill the fields from the `App IDs` table above
5. Choose `Explicit App ID`
6. Paste the bundle ID exactly
7. Enable only the capabilities listed in `1.2a`
8. `Continue` → `Register`

### 1.2a Capabilities to enable on the App IDs

Enable these on all three App IDs:

- `Push Notifications`
- `Apple Pay`

Do not enable these today unless scope changes:

- `Sign in with Apple`
- `Associated Domains`
- `iCloud`
- `App Groups`
- `Wallet`

Why these two:

- Push is already in the app via `expo-notifications`.
- Apple Pay is already referenced by the Stripe payment sheet config and the
  `merchant.com.casacarclub.app` identifier.

After you enable a capability, Apple notes that provisioning profiles using that
App ID become invalid and need regeneration. That is fine here because EAS will
regenerate signing assets on the next interactive build.

### App Review note — o iOS paga pela Stripe, e isso é deliberado

> **Reescrito em 2026-09-02.** Esta seção mandava exatamente o oposto do que o
> app faz hoje. Ficou desatualizada quando o pagamento nativo entrou (PR #45) e
> teria mandado alguém desfazer o trabalho antes de submeter. O texto antigo
> exigia que o bundle iOS não citasse a Stripe, descrevia uma regra de lint
> `no-stripe-on-ios` que não existe mais, e dizia que o iOS assinava por
> StoreKit via RevenueCat, que nunca chegou a ser ligado.

O canon §F8.16 está **superseded**, não apagado. A decisão está em
`docs/superpowers/specs/2026-08-12-apple-pay-ios-design.md` e no spec
consolidado `2026-08-29-pagamentos-mobile-consolidado-design.md`.

**Qual diretriz vale para quê.** Isto é o que decide tudo abaixo, então vale
ler antes de mexer:

- **Carrinho** (produtos da loja e ingressos): bem físico e serviço consumido
  fora do app. A **3.1.3(e)** exige método que **não** seja IAP, e nomeia o
  Apple Pay como correto. Por isso o carrinho pode usar Stripe, e por isso o
  fallback dele para checkout hospedado é legítimo.
- **Assinatura premium**: depende do que está no produto. Com
  `EXPO_PUBLIC_CAIXA_ENABLED` ligado, a adesão entrega uma caixa física a cada
  ciclo e cai na mesma 3.1.3(e). Desligado, sobram capas e selo, tudo dentro do
  app, e aí é assinatura digital, onde a **3.1.1** pede IAP.
- **Encaminhar o usuário para fora** para comprar algo digital é o chapeau da
  **3.1.3**, e vale mesmo quando a compra funciona. Foi por isso que o texto
  "contrate pelo site" saiu do app.

Não confundir com a 3.1.5(a): aquela numeração hoje é Criptomoedas.

**Como está implementado:**

- `apps/mobile/app/_layout.tsx` monta `<StripeProvider>` no iOS também. O que
  decide é haver chave publicável, não a plataforma
  (`app/stripe-provider-gate.ts`).
- `src/payments/payment-sheet.ts` é o seam único do PaymentSheet, com
  `returnURL` para o retorno do 3DS e Apple Pay declarado.
- Carrinho, assinatura e retomada de pedido passam por ele no nativo.
- `src/screens/assinaturas/checkout.ts`: sem chave publicável, o iOS lê
  `EXPO_PUBLIC_CAIXA_ENABLED` para decidir. Com caixa, cai no checkout
  hospedado, que é legítimo para bem físico. Sem caixa, responde indisponível,
  porque o link para fora seria a violação do chapeau.
- A regra de lint `no-stripe-on-ios` e o teste de isolamento **foram
  removidos** junto com a decisão que os motivava.

**Antes de submeter TestFlight ou App Store:**

1. `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` está definida nos perfis `preview` e
   `production` desde 2026-09-04, com a chave da conta **sandbox** da Casa Car
   Club (`pk_test_51U4ESa…`). Ela tem que casar com a conta cujo secret a API
   usa: o Railway de produção roda em `sk_test_51U4ESa…`. Chave de outra conta
   faz o client secret não abrir no app.
   **É chave de TEST, e isso é proposital hoje.** Serve para TestFlight e para a
   análise da Apple. Não serve para venda ao público: o membro concluiria a
   compra sem ser cobrado. Por isso `app.config.ts` derruba o build de
   `production` que carregue `pk_test_`, a menos que `ALLOW_TEST_STRIPE_KEY=1`
   esteja setada. Use a variável para TestFlight e review.
   Ir a live não é trocar esta linha: é mover a stack inteira para a conta do
   CNPJ junto, secret da API, os dois webhook secrets e esta publicável. As duas
   contas ainda estão com `charges_enabled: false`, então nenhum build cobra de
   verdade hoje.
2. `EXPO_PUBLIC_PREMIUM_BILLING_ENABLED` `true` (já está nos três perfis).
3. `EXPO_PUBLIC_CAIXA_ENABLED` `true` (já está nos três perfis). Se for
   desligado, reler a seção das diretrizes acima antes de submeter: a
   assinatura vira produto digital e a análise muda.
4. Apple Pay testado em aparelho real. O `merchantIdentifier` só é aplicado no
   variant `production` (`app.config.ts`), porque o merchant id precisa estar
   habilitado no App ID correspondente no portal da Apple. Enquanto não
   estiver nos App IDs `.dev` e `.preview`, não dá para testar Apple Pay num
   build de preview.

`EXPO_PUBLIC_RC_IOS_API_KEY` não é mais necessária. A RevenueCat está dormente,
com a condição exata de reativação registrada em `docs/revenuecat.md` e em
`packages/shared/src/legal.ts`.

### 1.2b Create the Merchant ID first

Because Apple Pay is one of the enabled capabilities, create the merchant
identifier before you finish enabling Apple Pay on the App IDs:

1. `Certificates, Identifiers & Profiles` → `Identifiers` → `+`
2. Choose `Merchant IDs`
3. Fill:
   - `Description` = `Casa Car Club Apple Pay`
   - `Identifier` = `merchant.com.casacarclub.app`
4. `Continue` → `Register`

Then go back to each App ID:

1. Open the App ID
2. Click `Edit`
3. Enable `Apple Pay`
4. Select `merchant.com.casacarclub.app`
5. `Continue` → `Save`

Note:

- One merchant identifier can be reused across multiple apps. That is the right
  setup for these three variants.

### 1.3 Create the App Store Connect app record

Before uploading a build to App Store Connect, Apple requires an app record.
For Phase 0.9, create the production record now:

- Platform: `iOS`
- Name: `Casa Car Club`
- Primary language: `Portuguese (Brazil)` or the closest PT option available
- Bundle ID: `com.casacarclub.app`
- SKU: `casa-car-club-ios-prod`

Apple screen inputs:

1. App Store Connect → `Apps` → `+` → `New App`
2. `Platforms` = `iOS`
3. `Name` = `Casa Car Club`
4. `Primary Language` = `Portuguese (Brazil)` if Apple offers it
5. `Bundle ID` = `com.casacarclub.app`
6. `SKU` = `casa-car-club-ios-prod`
7. `User Access` = `Full Access`
8. Click `Create`

Optional now, useful later:

- Create a second record for `com.casacarclub.app.preview` only if you want to
  push preview builds through TestFlight instead of Expo internal distribution.

Not required for Phase 0.9:

- A Store Connect app record for `com.casacarclub.app.dev`

### 1.4 Register test devices for preview installs

For internal iOS preview builds, Expo uses ad hoc provisioning. Every iPhone
that will install the preview IPA must be registered first:

```bash
pnpm --filter @ccc/mobile exec eas device:create
pnpm --filter @ccc/mobile exec eas device:list
```

Notes:

- `eas device:create` opens the device-registration flow. Complete it on the
  iPhone in Safari.
- Adding a new iPhone later requires another `preview` build so the new UDID is
  included in the provisioning profile.
- Expo notes that after `eas device:create`, you need to run the iOS build
  interactively so Apple can add that device to the ad hoc provisioning profile.

### 1.5 Let EAS manage signing

For the first iOS build, accept the EAS prompts to generate and store:

- Apple distribution certificate
- Provisioning profile for the relevant bundle id

Do not export them into the repo.

## Step 2: Google Play setup

Do this once before Play Internal or production release. It is not required for
the first direct-install APK from EAS, but it should be configured in the same
heartbeat so Android does not become the next blocker.

### 2.1 Create the Play Console app

Create the production Android app in Play Console:

- App name: `Casa Car Club`
- Default language: `Portuguese (Brazil)` if available
- Package name: `com.casacarclub.app`

Why production only:

- `preview` already builds as an APK and can be installed directly from the EAS
  artifact URL.
- Play tracks are tied to the production package namespace.

### 2.2 Opt into Play App Signing

On the first Play upload, accept Play App Signing unless there is a specific
reason to bring a legacy signing key. That keeps the upload key and the Play
app-signing key separated.

### 2.3 Create a service account for EAS submit

Create a Google Cloud service account and grant it Play Console access with at
least release-management permissions for this app.

Expected local file path when submit work starts:

`apps/mobile/secrets/play-service-account.json`

That path matches `submit.production.android.serviceAccountKeyPath` in
`apps/mobile/eas.json`. Keep the file gitignored and local-only.

### 2.4 Create the internal testing track

Once the app exists in Play Console:

- Open `Testing > Internal testing`
- Create the internal test track if prompted
- Add tester emails or a Google Group

This is the store-backed Android test path. Use it after the first direct APK
proof if you want installs and updates through Google Play.

## Step 3: Expo / EAS linkage

### 3.1 Log in

Run on a real terminal with TTY:

```bash
pnpm dlx eas-cli login
pnpm --filter @ccc/mobile exec eas whoami
```

### 3.2 Link the project

Run once:

```bash
pnpm --filter @ccc/mobile exec eas init --non-interactive
```

Copy the generated UUID into `apps/mobile/.env`:

```dotenv
EAS_PROJECT_ID=<uuid-from-eas-init>
```

`app.config.ts` already reads `process.env.EAS_PROJECT_ID`.

### 3.3 Keep `.env` aligned

Minimum local file for the first build:

```dotenv
APP_VARIANT=development
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000
EAS_PROJECT_ID=<uuid-from-eas-init>
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_redacted_replace_me
EXPO_PUBLIC_SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT_MOBILE=
```

For `preview`, `eas.json` overrides `APP_VARIANT=preview` and points the app at
`https://api.casacar.club`.

## Step 4: First builds to run

Run these in order.

### 4.1 Fastest proof: iOS simulator dev build

Use this to prove the Expo project is linked and the native project compiles.
This does not prove device install, push, or App Store readiness.

```bash
pnpm --filter @ccc/mobile exec eas build --profile development --platform ios
```

Expected outcome:

- EAS build finishes successfully.
- Artifact is a simulator build for `com.casacarclub.app.dev`.

### 4.2 First real iPhone build: preview

Use this for the first installable iPhone build:

```bash
pnpm --filter @ccc/mobile exec eas build --profile preview --platform ios
```

Expected outcome:

- Internal-distribution IPA for `com.casacarclub.app.preview`
- Install URL or QR from Expo
- Build points at Railway production API per `eas.json`

Important:

- If a new device was just added, run this interactively so EAS can update the
  ad hoc provisioning profile.

### 4.3 First real Android build: preview APK

Use this for the first installable Android artifact:

```bash
pnpm --filter @ccc/mobile exec eas build --profile preview --platform android
```

Expected outcome:

- Installable APK for `com.casacarclub.app.preview`
- Direct download URL from Expo

### 4.4 Store-targeted builds later

Do not use these as the first proof. They are for release readiness:

```bash
pnpm --filter @ccc/mobile exec eas build --profile production --platform ios
pnpm --filter @ccc/mobile exec eas build --profile production --platform android
```

Production submit remains blocked on:

- `APPLE_ID`
- `ASC_APP_ID`
- `apps/mobile/secrets/play-service-account.json`
- Store listing metadata and compliance screens

## Step 4b: Conta de revisão da Apple

App Review precisa entrar no app. `apps/mobile/app/_layout.tsx` manda todo
usuário sem `emailVerifiedAt` para `/verify-email-pending`, então um revisor que
se cadastra sozinho trava naquela tela e rejeita a build por não conseguir usar o
app. A conta tem que chegar pronta.

```bash
REVIEW_ACCOUNT_EMAIL=review@casacar.club \
REVIEW_ACCOUNT_PASSWORD='<gere na hora, não versione>' \
  pnpm --filter @ccc/api exec tsx src/scripts/seed-review-account.ts
```

O script é idempotente: rode antes de cada submissão. Ele deixa pronto:

- conta já verificada, com termos aceitos na versão vigente;
- assinatura ativa, para as superfícies pagas não estarem vazias;
- evento futuro publicado com ingresso disponível;
- **posts de outro membro** no feed desse evento.

O último item não é enfeite. Sem post no feed o card nunca monta, e os controles
de denúncia e bloqueio que a regra 1.2 exige ficam inalcançáveis numa passada
limpa de review. Os posts precisam ser de outra pessoa, porque em conteúdo
próprio esses controles ficam escondidos de propósito.

A senha é reescrita a cada execução: a fonte da verdade é o App Store Connect,
não o banco. Cole email e senha em App Store Connect → App Review Information.

## Step 5: Evidence required for `JDMA-116`

Before Phase 0.9 can move toward done, capture all of this on the issue:

- EAS project linked and `EAS_PROJECT_ID` stored locally.
- Apple bundle ids created.
- App Store Connect production app record created.
- Google Play production app created.
- `development` iOS build URL.
- `preview` iOS build URL.
- `preview` Android build URL.
- Install proof on at least one physical iPhone or Android device for the
  `preview` build.
- Smoke result summary: launch, API reachability, navigation, auth open, no
  native crash on foreground/background.

Roadmap rule reminder:

- `plans/roadmap.md` 0.9 flips to `[x]` only after the required build proof is
  merged and the builds actually exist.

## Troubleshooting

- `eas init` says the project is already linked:
  inspect `apps/mobile/.env` and confirm `EAS_PROJECT_ID` is present.
- iOS preview build says no devices are registered:
  rerun `eas device:create`, then rebuild `preview` for iOS.
- Android preview build succeeds but testers cannot install:
  confirm the artifact is an APK from the `preview` profile, not a production
  AAB.
- iOS preview installs on one phone but not another:
  the second UDID was not in the provisioning profile used for that build.
- App launches but API calls fail:
  verify `https://api.casacar.club/health` and confirm the preview
  build used the checked-in `preview` profile.
