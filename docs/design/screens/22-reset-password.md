# Screen — `/reset-password`

## Purpose

Final step of the password-recovery flow. The user lands here from a
deep-link in the recovery e-mail (`/reset-password?token=...`) and sets
a brand-new password. The screen mirrors the design language of `login`
and `forgot`: dark `bg-bg #0A0A0A` end-to-end, a back arrow + title row,
a tight subtitle that states the password floor, two stacked password
fields (each with a visibility toggle), a 3-bar strength gauge under the
new-password field, and a single brand-red CTA. On success the user is
sent back to `/login`. If the deep-link arrives without a `token`, the
form is replaced by a "link inválido" empty-state that points the user
back to `/forgot`.

## Layout sketch

```
SafeAreaView (bg-bg)
└─ KeyboardAvoidingView (behavior=padding on iOS)
   └─ ScrollView (px-5)
      ├─ Header row (h-14, mt-3, flex-row gap-3 items-center)
      │  ├─ <Pressable> ArrowLeft icon (44pt hit area)
      │  └─ <Text variant=h2 weight=semibold>Nova senha</Text>
      ├─ Spacer (h=24)
      ├─ <Text variant=body tone=secondary>Cria uma senha nova pra sua conta. Mínimo 10 caracteres.</Text>
      ├─ Spacer (h=24)
      ├─ TextField "Senha nova"  (secureTextEntry toggleable, with right eye icon)
      ├─ StrengthMeter (3 segments under the field; live hint text)
      ├─ Spacer (h=20)
      ├─ TextField "Confirma a senha" (secureTextEntry toggleable, with right eye icon)
      ├─ Spacer (h=24)
      ├─ <Button label="Alterar senha" variant=primary size=lg fullWidth loading={isSubmitting}>
      └─ Spacer (h=16)
         └─ if (token-error) <Button label="Pedir outro link" variant=ghost onPress=/forgot>
```

When `token` is missing (`no-token` state), the body collapses to a
single error tile + a ghost button to `/forgot`:

```
SafeAreaView
└─ ScrollView (px-5)
   ├─ Header row (back arrow + "Nova senha")
   ├─ Spacer (h=32)
   ├─ <Card variant=outlined padding=lg>
   │  ├─ <Text variant=h3>Link inválido.</Text>
   │  └─ <Text tone=secondary>O link expirou ou está incompleto. Pede outro pra continuar.</Text>
   └─ Spacer + <Button label="Pedir outro link" variant=primary fullWidth>
```

## Copy strings (PT-BR, all in `~/copy/auth.reset.*` and `~/copy/auth.errors.*`)

| Key                      | String                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `reset.title`            | `Nova senha`                                                   |
| `reset.subtitle`         | `Cria uma senha nova pra sua conta. Mínimo 10 caracteres.`     |
| `reset.password`         | `Senha nova`                                                   |
| `reset.confirm`          | `Confirma a senha`                                             |
| `reset.submit`           | `Alterar senha`                                                |
| `reset.done`             | `Senha atualizada.`                                            |
| `reset.mismatch`         | `As senhas não batem.`                                         |
| `reset.invalidLinkTitle` | `Link inválido.`                                               |
| `reset.invalidLinkBody`  | `O link expirou ou está incompleto. Pede outro pra continuar.` |
| `reset.requestNewLink`   | `Pedir outro link`                                             |
| `reset.showPassword`     | `Mostrar senha`                                                |
| `reset.hidePassword`     | `Esconder senha`                                               |
| `reset.strengthLabel`    | `Força da senha`                                               |
| `reset.strengthWeak`     | `Fraca`                                                        |
| `reset.strengthMedium`   | `Média`                                                        |
| `reset.strengthStrong`   | `Forte`                                                        |
| `errors.weakPassword`    | (existing) `Use pelo menos 10 caracteres.`                     |
| `errors.rateLimited`     | (existing) `Muitas tentativas. Aguarde um instante.`           |
| `errors.network`         | (existing) `Sem conexão. Tente novamente.`                     |
| `errors.unknown`         | (existing) `Algo deu errado.`                                  |
| `common.back`            | (existing) `Voltar`                                            |

## Component map

| UI element         | Primitive / Element                                             |
| ------------------ | --------------------------------------------------------------- |
| Root               | `<SafeAreaView>` from `react-native-safe-area-context`          |
| Keyboard handling  | `<KeyboardAvoidingView>` + `<ScrollView>`                       |
| Back arrow         | `<Pressable>` + `<ArrowLeft>` from `lucide-react-native`        |
| Title              | `<Text variant="h2" weight="semibold">`                         |
| Subtitle           | `<Text variant="body" tone="secondary">`                        |
| Password / Confirm | Local `<TextField>` (NativeWind variant) + right eye toggle     |
| Visibility toggle  | `<Pressable>` + `<Eye>` / `<EyeOff>` from `lucide-react-native` |
| Strength gauge     | Three `<View>` segments + `<Text variant="caption">`            |
| Primary CTA        | `<Button variant="primary" size="lg" fullWidth loading>`        |
| Recover-link CTA   | `<Button variant="ghost">` (only on token error / no-token)     |
| No-token tile      | `<Card variant="outlined" padding="lg">` with title + body      |

The single brand-red surface on this screen is the `Alterar senha`
filled CTA. The `Pedir outro link` ghost button is text-only, so it does
not violate the "one brand red CTA per screen" rule.

## States

1. **Idle** — Both fields empty, no errors, strength gauge at 0 bars,
   CTA disabled until the form has any input (still gated by zod on
   submit). Visibility toggles default to "hide" (`secureTextEntry = true`).
2. **Submitting** — `isSubmitting` true; CTA shows spinner via the
   `loading` prop. Inputs and toggles remain interactive (RN doesn't
   render a flicker when re-enabled, but locking them mid-submit would).
3. **Mismatch** — Local zod refine fires when `password !== confirm`.
   `errors.confirm.message = reset.mismatch`. Confirm field renders the
   danger border + inline error.
4. **Weak password (zod)** — `password.length < 10`. `errors.password
.message = errors.weakPassword`. Password field shows danger border
   - inline error.
5. **400 invalid token** — `setError('password', { message:
reset.invalidLinkTitle })` AND swap the bottom area to render the
   ghost `Pedir outro link` button which navigates to `/forgot`.
6. **422 weak password from API** — `setError('password', { message:
errors.weakPassword })` so we surface server-side rules without
   doubling them in the schema.
7. **429 rate-limited** — `setError('password', { message:
errors.rateLimited })`.
8. **Network failure (non-ApiError)** — `setError('password', { message:
errors.network })`.
9. **Other API error (5xx)** — `setError('password', { message:
errors.unknown })`.
10. **Success → redirect** — After the API call resolves, immediately
    `router.replace('/login')`. The login screen does not yet read a
    success param; this PR intentionally does NOT modify `login.tsx`.
11. **No-token** — When `useLocalSearchParams<{ token?: string }>()`
    returns no `token` (or empty string), the form section is hidden and
    the screen renders an outlined card with `reset.invalidLinkTitle` +
    `reset.invalidLinkBody` + a primary `Pedir outro link` button that
    routes to `/forgot`.

## Strength gauge logic table

The gauge is purely visual feedback — server-side validation still
bounds the password through `passwordSchema` (`min: 10`).

| Heuristic                                  | Tier | Bars | Label  |
| ------------------------------------------ | ---- | ---- | ------ |
| empty                                      | 0    | 0    | (none) |
| `length >= 8 && hasNumber`                 | 1    | 1    | Fraca  |
| tier 1 holds + `hasUpper && hasLower`      | 2    | 2    | Média  |
| tier 2 holds + `hasSymbol && length >= 12` | 3    | 3    | Forte  |

The active bar(s) use `bg-brand`; inactive segments use
`bg-surface-alt`. The label text colors are `tone="muted"` at tier 0–1,
`tone="secondary"` at tier 2, `tone="brand"` at tier 3.

NOTE: the spec brief mentions the heuristic uses an 8-character floor
for tier 1, but the actual server / zod minimum is 10. We keep the
zod minimum at 10 for _acceptance_, while the visual gauge starts to
register a single bar at 8 chars+number — the spec brief instructed the
gauge be heuristic-only ("visual only, no zxcvbn"), so the cosmetic
floor of 8 is intentional and gives faster feedback as the user types.
The button still won't accept the form unless zod passes.

## Accessibility notes

- Root is `<SafeAreaView>` from `react-native-safe-area-context` so the
  back-arrow row clears the notch on hardware-cutout iPhones.
- `<KeyboardAvoidingView behavior="padding">` (iOS only) lifts the form
  when the soft keyboard appears.
- Back arrow button: `accessibilityRole="link"`,
  `accessibilityLabel={authCopy.common.back}`, `hitSlop={12}`, wrapper
  is 44×44 pt to clear the touch-target floor.
- Title `<Text>` carries `accessibilityRole="header"` so VoiceOver
  announces it as a heading.
- Each `<TextField>` already injects `accessibilityLabel`, expanding to
  `${label}, error: ${message}` on error.
- Visibility toggles: `<Pressable>` with `accessibilityRole="button"`
  and a label that flips between `reset.showPassword` /
  `reset.hidePassword`. `accessibilityState.selected` mirrors the
  current `secureTextEntry` value.
- Strength gauge: parent View has `accessibilityRole="progressbar"`
  with `accessibilityLabel={authCopy.reset.strengthLabel}` and an
  `accessibilityValue={{ min: 0, max: 3, now: tier }}` so screen
  readers can announce the current strength.
- `accessibilityLiveRegion="polite"` is set on the form root so
  newly-set inline errors are announced.
- Contrast: text `#F5F5F5` / `#C9C9CD` / `#8A8A93` on `#0A0A0A` clears
  WCAG AA. Brand red `#E10600` carries `text-fg-inverse` on it (clears
  AA Large). Strength bars (`#E10600` active vs. `#1F1F1F` inactive)
  hit a 3:1 large-element contrast.
- Inline errors are red text + a red field border: dual signal (color +
  copy) for users who can't perceive the red.

## Deliberately left out

- **zxcvbn-based password scoring.** Pulls a ~400 KB dictionary in;
  brief calls out heuristic-only.
- **"Logged out other devices" confirmation.** Explicitly out of scope
  per brief.
- **Login banner reading a success param.** The brief forbids editing
  `login.tsx` in this PR. The redirect lands on the standard login.
- **Caps-lock indicator.** Native RN doesn't expose physical-keyboard
  modifier state portably; deferred.
- **Password manager autofill hints (`textContentType="newPassword"`).**
  Worth adding once we test on iOS 17+ keychain autofill. Tracked
  separately.
