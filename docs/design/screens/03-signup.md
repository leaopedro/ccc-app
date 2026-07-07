# Screen — `/(auth)/signup`

## Purpose

The signup screen converts a first-time visitor into a JDM Experience
member. It must read insider, premium, scene-shaped — not a generic
ticketing form. The visual hierarchy starts with a back-arrow and
two-line page title (`Cadastro` eyebrow + `Entre na cena` page title in
display type), then drops into a tight three-field form (`Nome`,
`E-mail`, `Senha`) with a muted password-rule helper, an inline
terms-and-privacy consent toggle, and a single brand-red `Criar conta`
CTA. Below the CTA, a muted line offers a brand-red `Entrar` link back
to login. The screen is dark (`bg-bg #0A0A0A`) end-to-end and uses the
shared `@jdm/ui` primitives (`Text`, `Button`) plus the local
`TextField`, all driven by NativeWind classes off the shared design
tokens. All copy lives in `~/copy/auth`.

## Layout sketch

```
SafeAreaView (bg-bg)
└─ KeyboardAvoidingView (behavior=padding on iOS)
   └─ ScrollView (px-5)
      ├─ Header row (flex-row items-start gap-3, pt-2)
      │  ├─ <Pressable accessibilityRole="button" hitSlop=8>
      │  │   └─ <ArrowLeft size=24 color="#F5F5F5" stroke=1.75>
      │  └─ Column (flex-1, gap-1)
      │     ├─ <Text variant=eyebrow tone=muted>Cadastro</Text>
      │     └─ <Text variant=h2 weight=bold accessibilityRole=header>
      │         Entre na cena
      │       </Text>
      ├─ Spacer (h=24)
      ├─ <TextField label="Nome" placeholder="Seu nome completo">
      ├─ Spacer (h=20)
      ├─ <TextField label="E-mail" placeholder="voce@email.com"
      │              autoComplete=email keyboardType=email-address>
      ├─ Spacer (h=20)
      ├─ <TextField label="Senha" secureTextEntry autoComplete=password-new>
      │  └─ Helper line below: <Text variant=bodySm tone=muted>
      │                          Mínimo 10 caracteres.
      │                        </Text>
      ├─ Spacer (h=20)
      ├─ ConsentRow (flex-row gap-3)
      │  ├─ <Pressable role=checkbox> 24x24 box, brand fill when checked
      │  └─ <Text variant=bodySm tone=secondary>
      │       Aceito os <Text tone=brand weight=semibold>Termos</Text>
      │       e a
      │       <Text tone=brand weight=semibold>Política de privacidade</Text>.
      │     </Text>
      ├─ Spacer (h=12)
      ├─ MarketingConsentRow (flex-row gap-3)
      │  ├─ <Pressable role=checkbox> 24x24 box (deferred persistence)
      │  └─ <Text variant=bodySm tone=muted>
      │       Quero receber novidades por e-mail e push.
      │     </Text>
      ├─ Spacer (h=32)
      ├─ <Button label="Criar conta" variant=primary size=lg fullWidth
      │          loading={isSubmitting} disabled={!termsAccepted}>
      ├─ Spacer (h=24)
      └─ Bottom row (flex-row, centered)
         ├─ <Text tone=muted>Já tem conta? </Text>
         └─ <Pressable href="/login">
            └─ <Text tone=brand weight=semibold>Entrar</Text>
```

## Copy strings (PT-BR, all in `~/copy/auth`)

| Key                        | String                                          |
| -------------------------- | ----------------------------------------------- |
| `signup.eyebrow`           | `Cadastro`                                      |
| `signup.title`             | `Entre na cena`                                 |
| `signup.name`              | `Nome`                                          |
| `signup.namePlaceholder`   | `Seu nome completo`                             |
| `signup.email`             | `E-mail`                                        |
| `signup.emailPlaceholder`  | `voce@email.com`                                |
| `signup.password`          | `Senha`                                         |
| `signup.passwordHint`      | `Mínimo 10 caracteres.`                         |
| `signup.termsPrefix`       | `Aceito os `                                    |
| `signup.termsLink`         | `Termos`                                        |
| `signup.termsBetween`      | `e a`                                           |
| `signup.privacyLink`       | `Política de privacidade`                       |
| `signup.termsSuffix`       | `.`                                             |
| `signup.marketingConsent`  | `Quero receber novidades por e-mail e push.`    |
| `signup.submit`            | `Criar conta`                                   |
| `signup.haveAccountPrefix` | `Já tem conta? `                                |
| `signup.haveAccountLink`   | `Entrar`                                        |
| `signup.back`              | `Voltar`                                        |
| `signup.termsRequired`     | `Aceite os Termos e a Política para continuar.` |
| `errors.emailExists`       | `Esse e-mail já está cadastrado.`               |
| `errors.weakPassword`      | `Use pelo menos 10 caracteres.`                 |
| `errors.rateLimited`       | `Muitas tentativas. Aguarde um instante.`       |
| `errors.unknown`           | `Algo deu errado.`                              |
| `errors.network`           | `Sem conexão. Tente novamente.`                 |
| `common.appName`           | `JDM Experience` (image a11y, unused on signup) |

## Component map

| UI element            | Primitive / Element                                                 |
| --------------------- | ------------------------------------------------------------------- |
| Root                  | `<SafeAreaView>` + `<KeyboardAvoidingView>` + `<ScrollView>`        |
| Back arrow            | `<Pressable>` + `<ArrowLeft>` from `lucide-react-native`            |
| Eyebrow               | `<Text variant="eyebrow" tone="muted">`                             |
| Page title            | `<Text variant="h2" weight="bold" accessibilityRole="header">`      |
| Field labels          | `<Text variant="eyebrow" tone="secondary">` (inside `TextField`)    |
| Inputs                | Local `<TextField>` (NativeWind variant)                            |
| Password helper       | `<Text variant="bodySm" tone="muted">` (rendered when no error)     |
| Inline error          | `<Text variant="bodySm" tone="danger">` (inside `TextField`)        |
| Consent checkbox      | `<Pressable accessibilityRole="checkbox">` + 24×24 bordered box     |
| Consent text          | `<Text variant="bodySm">` with nested brand-tone `<Text>` for links |
| Primary CTA           | `<Button variant="primary" size="lg" fullWidth loading>`            |
| "Já tem conta" prefix | `<Text tone="muted">`                                               |
| "Entrar" link         | `<Pressable>` + `<Text tone="brand" weight="semibold">`             |

The single brand-red surface on the screen is the `Criar conta` CTA.
The `Termos`, `Política de privacidade`, and `Entrar` inline links use
brand red text only (not a filled surface), preserving the "one brand
red surface per screen" rule from `brand.md`.

## States

1. **Idle** — Empty fields, no errors, terms unchecked, CTA visually
   enabled but `disabled` until terms toggle is on. (Marketing toggle
   has no effect on submit.)
2. **Submitting** — `isSubmitting` true; CTA shows spinner via
   `loading` prop on `<Button>`. Inputs remain editable to avoid
   flicker on the network round-trip.
3. **409 e-mail taken** — `setError('email',
authCopy.errors.emailExists)`; e-mail field shows danger border and
   inline error `Esse e-mail já está cadastrado.`
4. **422 field validation (server)** — If the API returns field-level
   errors (`fields: { email | name | password: string }`), each is
   mapped via `setError(<field>, { message })`. Otherwise falls back to
   `errors.unknown` on `password`.
5. **429 rate-limited** — `setError('password',
authCopy.errors.rateLimited)`; password field shows danger border
   and inline error `Muitas tentativas. Aguarde um instante.`
6. **Other API error (5xx, etc.)** — `setError('password',
authCopy.errors.unknown)`; inline error `Algo deu errado.`
7. **Network failure (non-`ApiError`)** — `setError('password',
authCopy.errors.network)`; inline error `Sem conexão. Tente
novamente.`
8. **Field validation (zod, client)** — On submit, zod's `signupSchema`
   runs. Each field can render its own inline error via
   `errors.name?.message` / `errors.email?.message` /
   `errors.password?.message`.
9. **Terms not accepted** — Submit is blocked at the button level;
   tapping the disabled button does nothing. The terms label remains
   `secondary` (the brand red links inside it carry the visual draw).

On success: `useAuth().signup(values)` resolves, then
`router.replace({ pathname: '/verify-email-pending', params: { email
} })`.

## Accessibility notes

- Root is `<SafeAreaView>` from `react-native-safe-area-context`; the
  back arrow and title therefore clear the notch on iPhones with a
  hardware cutout.
- `<KeyboardAvoidingView behavior="padding">` (iOS only) lifts the
  whole stack when the soft keyboard appears; on Android the system
  default `adjustResize` handles this.
- Back-arrow `<Pressable>` declares `accessibilityRole="button"` and
  `accessibilityLabel="Voltar"` and uses `hitSlop={8}` so its tap area
  reaches the 44 pt minimum even though the icon itself is 24 px.
- Page title carries `accessibilityRole="header"`.
- Each `TextField` injects `accessibilityLabel` from the visible label;
  on error the accessible name expands to `${label}, error: ${message}`
  so the screen reader announces both.
- The password field's helper line is rendered as standard `<Text>`
  below the field. Once an error is present, the `TextField` itself
  swaps in the `danger` inline message. We intentionally hide the
  helper while the inline error is up so the screen reader reads one
  message, not both.
- Each consent row uses `<Pressable accessibilityRole="checkbox"
accessibilityState={{ checked }} accessibilityLabel=...>` and the
  whole row (box + text) is the tap target, so the tap area is well
  above 44 pt.
- The terms-and-privacy `<Pressable>` link components inside the
  consent label don't navigate yet (no Termos/Privacy screens shipped).
  They render as visually styled `<Text>` only, not nested
  `<Pressable>`, to avoid the WCAG conflict of a checkbox tap target
  containing a separate link tap target. When terms screens land, we
  pull these out into a dedicated row above the checkbox.
- `errors` updates trigger `accessibilityLiveRegion="polite"` on the
  form container so screen readers announce server-side error mapping
  without needing focus changes.
- Contrast: `text-fg (#F5F5F5)` and `text-fg-muted (#8A8A93)` on
  `bg-bg (#0A0A0A)` clear WCAG AA. The brand-red CTA renders
  `text-fg-inverse (#0A0A0A)` on `#E10600` (clears AA large). Brand-red
  inline links on `bg-bg` clear AA large at our 14 px size.
- The danger border (`#EF4444`) plus inline danger text gives a dual
  signal (color + text) for users who can't perceive the red border.

## Deliberately deferred (and why)

- **Marketing-consent persistence (LGPD).** The mockup and brief both
  call for a separate marketing-vs-transactional consent capture.
  Today the toggle renders and is tracked locally via `useState`, but
  the value isn't sent to the API. This unblocks the visual contract
  while keeping the API surface small. Persistence lands with the LGPD
  sweep (roadmap X.4 — consent capture / data export / deletion), at
  which point we add `marketingOptIn: boolean` to `signupSchema`,
  mirror it on `PublicUser`, and wire it through here.
- **Terms / Privacy navigation.** The `Termos` and `Política de
privacidade` words are visually styled brand red (matching the
  mockup) but do not navigate, because no `/terms` or `/privacy`
  screens ship in the MVP. Will be linked once those static pages land.
- **Social sign-up (Google / Apple).** Strings live in
  `authCopy.login` only and the auth backend doesn't support OAuth in
  the MVP. Not surfaced here.
- **Show-password toggle.** Adds a stateful child + icon dependency
  that most password managers already cover. Defer.
- **Country / language picker.** PT-BR is the only locale shipped in
  the MVP per the project brief.
