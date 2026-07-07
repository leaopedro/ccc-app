# Screen — `/(auth)/login`

## Purpose

The login screen is the first authenticated touch-point for returning JDM
Experience members. It must read insider, premium, racing-adjacent — not
corporate. The brand wordmark anchors the identity, a single uppercase
tagline ("BEM-VINDO À CENA.") sets tone, and the form is intentionally
minimal: e-mail, password, one brand-red CTA. Forgot-password lives as a
muted right-aligned link below the password field; sign-up lives as a
brand-red inline link at the bottom. The screen is dark (`bg-bg #0A0A0A`)
end-to-end and uses the shared `@jdm/ui` primitives (`Text`, `Button`)
plus the local `TextField`, all driven by NativeWind classes off the
shared design tokens.

## Layout sketch

```
SafeAreaView (bg-bg)
└─ KeyboardAvoidingView (behavior=padding on iOS)
   └─ ScrollView (px-5)
      ├─ Spacer (h=64)
      ├─ <Image logo-wordmark.webp> (220x88, contain, centered)
      ├─ Spacer (h=12)
      ├─ <Text variant=eyebrow tone=muted center>BEM-VINDO À CENA.</Text>
      ├─ Spacer (h=40)
      ├─ <TextField label="E-mail" autoComplete=email keyboardType=email-address>
      ├─ Spacer (h=16)
      ├─ <TextField label="Senha" secureTextEntry autoComplete=password>
      ├─ Spacer (h=8)
      ├─ Right-aligned <Pressable href="/forgot">
      │  └─ <Text tone=muted variant=bodySm>Esqueci minha senha</Text>
      ├─ Spacer (h=24)
      ├─ <Button label="Entrar" variant=primary size=lg fullWidth loading={isSubmitting}>
      ├─ Spacer (h=32)
      └─ Bottom row (flex-row, centered)
         ├─ <Text tone=muted>Ainda não está na cena? </Text>
         └─ <Pressable href="/signup">
            └─ <Text tone=brand weight=semibold>Criar conta</Text>
```

## Copy strings (PT-BR, all in `~/copy/auth`)

| Key                         | String                                    |
| --------------------------- | ----------------------------------------- |
| `login.tagline`             | `BEM-VINDO À CENA.`                       |
| `login.email`               | `E-mail`                                  |
| `login.password`            | `Senha`                                   |
| `login.submit`              | `Entrar`                                  |
| `login.forgot`              | `Esqueci minha senha`                     |
| `login.noAccountPrefix`     | `Ainda não está na cena? `                |
| `login.createAccount`       | `Criar conta`                             |
| `errors.invalidCredentials` | `E-mail ou senha inválidos.`              |
| `errors.rateLimited`        | `Muitas tentativas. Aguarde um instante.` |
| `errors.unknown`            | `Algo deu errado.`                        |
| `errors.network`            | `Sem conexão. Tente novamente.`           |
| `common.appName`            | `JDM Experience` (image a11y)             |

## Component map

| UI element     | Primitive / Element                                                 |
| -------------- | ------------------------------------------------------------------- |
| Root           | `<SafeAreaView>` + `<KeyboardAvoidingView>` + `<ScrollView>`        |
| Wordmark       | `<Image source={require('@jdm/design/assets/logo-wordmark.webp')}>` |
| Tagline        | `<Text variant="eyebrow" tone="muted">`                             |
| Field labels   | `<Text variant="eyebrow" tone="secondary">` (inside TextField)      |
| Inputs         | Local `<TextField>` (NativeWind variant)                            |
| Inline error   | `<Text variant="bodySm" tone="danger">` (inside TextField)          |
| Forgot link    | `<Pressable>` + `<Text tone="muted" variant="bodySm">`              |
| Primary CTA    | `<Button variant="primary" size="lg" fullWidth loading>`            |
| Sign-up prefix | `<Text tone="muted">`                                               |
| Sign-up link   | `<Pressable>` + `<Text tone="brand" weight="semibold">`             |

The single brand-red surface on the screen is the `Entrar` CTA. The
"Criar conta" inline link uses brand red text (not a filled surface), so
the screen still respects the "one brand red CTA per screen" rule from
`brand.md`.

## States

1. **Idle** — Empty fields, no errors, CTA enabled, not loading.
2. **Submitting** — `isSubmitting` true; CTA shows spinner via
   `loading` prop on `<Button>`. Inputs remain editable; user could in
   theory edit, but disabling them mid-submit would create a flicker
   on the network round-trip.
3. **401 invalid credentials** — `setError('password',
authCopy.errors.invalidCredentials)`; password field shows danger
   border and inline error `E-mail ou senha inválidos.`
4. **403 e-mail not verified** — `router.replace('/verify-email-pending',
{ email })`. No error rendered on this screen — the user lands on
   the pending screen instead.
5. **429 rate-limited** — `setError('password',
authCopy.errors.rateLimited)`; password field shows danger border
   and inline error `Muitas tentativas. Aguarde um instante.`
6. **Network failure (non-ApiError)** — `setError('password',
authCopy.errors.network)`; inline error `Sem conexão. Tente
novamente.`
7. **Other API error (5xx, etc.)** — `setError('password',
authCopy.errors.unknown)`; inline error `Algo deu errado.`
8. **Field validation (zod)** — On submit, zod's `loginSchema` runs.
   Either field can render its own inline error via
   `errors.email?.message` / `errors.password?.message`.

## TextField visual states

| State    | Wrapper classes                                                   | Input classes              |
| -------- | ----------------------------------------------------------------- | -------------------------- |
| Default  | `bg-surface-alt border border-border rounded-lg h-12 px-4`        | `text-fg text-base flex-1` |
| Focused  | `bg-surface-alt border border-border-strong rounded-lg h-12 px-4` | same                       |
| Error    | `bg-surface-alt border border-danger rounded-lg h-12 px-4`        | same + danger inline label |
| Disabled | adds `opacity-50` to wrapper (driven by `editable={false}`)       | input non-editable         |

Focus is tracked via local `useState` toggled in `onFocus` / `onBlur`,
not the Tailwind `focus-within:` modifier (NativeWind doesn't ship a
parity for that on RN). Placeholder color is locked to `#8A8A93`
(`text-fg-muted`) to match the design tokens, and the input forces
`fontFamily: 'Inter_400Regular'` because RN's default text style would
otherwise fall back to the system font.

The label above the input uses the `eyebrow` text variant (uppercase,
widest tracking) tinted `text-fg-secondary` for hierarchy below the
brand display type but above body text.

## Accessibility notes

- Root is `<SafeAreaView>`; the wordmark and tagline therefore clear the
  notch on iPhones with a hardware cutout.
- `<KeyboardAvoidingView behavior="padding">` (iOS only) lifts the
  whole stack when the soft keyboard appears; on Android the system
  default `adjustResize` handles this.
- The wordmark `Image` has `accessibilityLabel="JDM Experience"`.
- The tagline is decorative; it inherits `accessibilityRole="text"` and
  is left out of header semantics (the entire screen is a single form,
  not a multi-section page).
- Each `TextField` injects `accessibilityLabel` derived from the visible
  label. When an error is set, the accessible name expands to
  `${label}, error: ${message}` so the screen reader announces both.
- The forgot-password and sign-up `<Pressable>` elements declare
  `accessibilityRole="link"` with explicit `accessibilityLabel`, and
  use `hitSlop={8}` so their tap target reaches the 44 pt minimum even
  though the visible text is small.
- The primary `<Button>` already wires `accessibilityRole="button"` and
  flips `accessibilityState.busy` while loading.
- Contrast: `text-fg (#F5F5F5)` and `text-fg-muted (#8A8A93)` on
  `bg-bg (#0A0A0A)` clear WCAG AA. The brand-red CTA renders
  `text-fg-inverse (#0A0A0A)` on `#E10600` (clears AA large).
- The danger border (`#EF4444`) plus inline danger text gives a dual
  signal (color + text) for users who can't perceive the red border.

## Deliberately left out (and why)

- **Social sign-in (Google, Apple).** Strings exist in `authCopy.login`
  but the auth backend doesn't support OAuth in the MVP. Surfacing a
  button that errors out would be worse than not surfacing it.
- **"Show password" toggle.** Adds an `expo-vector-icons` dependency
  and a tiny stateful component for a feature most password managers
  already cover. Defer.
- **Biometric / Face ID quick-login.** Requires `expo-local-authentication`
  and a stored refresh-token contract that doesn't exist yet.
- **Background hero photography.** The brand guide allows it but
  loading a real scene photo on the entry screen risks slow first
  paint on slow networks. Dark `bg-bg` + wordmark + tagline carries
  enough brand weight on its own; revisit once we have CDN-hosted
  optimized variants.
- **Marketing-consent toggle.** Belongs on signup, not login.
- **Country/language picker.** PT-BR is the only locale shipped in the
  MVP per the project brief.
