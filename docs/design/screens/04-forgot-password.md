# Screen — `/(auth)/forgot`

## Purpose

The forgot-password screen lets a returning member request a password-reset
link. It is a tight, single-job page: a back affordance to `/login`, a
title, a one-line directive in the brand's casual PT-BR voice, an e-mail
field, and one brand-red CTA `Enviar link`. The screen is dark
(`bg-bg #0A0A0A`) end-to-end and reuses the `@jdm/ui` `Text` and `Button`
primitives plus the local `TextField`. After a successful submission the
screen swaps in place to a confirmation state (a `Mail` icon, a short
energetic line, the obscured e-mail, and a "Reenviar" link gated by a
30-second cooldown) without navigating away — the user keeps a clear
"Voltar pro login" exit at all times.

## Layout sketch

```
SafeAreaView (bg-bg)
└─ KeyboardAvoidingView (behavior=padding on iOS)
   └─ ScrollView (px-5)
      ├─ Top row (flex-row items-center gap-3, h=56, mt=12)
      │  ├─ <Pressable hitSlop=12 a11y=link onPress=router.back>
      │  │  └─ <ArrowLeft size=24 color=#F5F5F5 strokeWidth=1.75>
      │  └─ <Text variant=h2 weight=semibold>Recuperar senha</Text>
      ├─ Spacer (h=24)
      │
      ├─ IDLE STATE
      │  ├─ <Text variant=body tone=secondary>
      │  │     Digita o e-mail da sua conta e a gente
      │  │     manda um link pra você redefinir a senha.
      │  ├─ Spacer (h=24)
      │  ├─ <TextField label="E-mail" placeholder="voce@email.com"
      │  │              autoComplete=email keyboardType=email-address
      │  │              autoCapitalize=none>
      │  ├─ Spacer (h=24)
      │  ├─ <Button variant=primary size=lg fullWidth label="Enviar link"
      │  │          loading={isSubmitting}>
      │  ├─ Spacer (h=16)
      │  └─ <Pressable href="/login" centered hitSlop=12 a11y=link>
      │     └─ <Text tone=muted>Voltar pro login</Text>
      │
      └─ SUCCESS STATE (replaces idle in place, accessibilityLiveRegion=polite)
         ├─ <View self-center bg-brand/12 size=72 rounded-full center>
         │   └─ <Mail size=32 color=#F5F5F5 strokeWidth=1.75>
         ├─ Spacer (h=20)
         ├─ <Text variant=h2 weight=semibold center>Confira seu e-mail</Text>
         ├─ Spacer (h=8)
         ├─ <Text variant=body tone=secondary center>
         │     Mandamos um link pra <obscured@email.com>.
         │     Toque no link pra redefinir sua senha.
         ├─ Spacer (h=24)
         ├─ <Pressable centered hitSlop=12 a11y=link
         │             disabled={cooldown>0} onPress=resend>
         │   └─ <Text tone={cooldown>0 ? 'muted' : 'brand'} weight=semibold>
         │      Reenviar (em XXs) | Reenviar
         ├─ Spacer (h=12)
         └─ <Pressable href="/login" centered hitSlop=12 a11y=link>
            └─ <Text tone=muted>Voltar pro login</Text>
```

## Copy strings (PT-BR, all under `authCopy.forgot.*` in `~/copy/auth`)

| Key                       | String                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `forgot.title`            | `Recuperar senha`                                                                                   |
| `forgot.subtitle`         | `Digita o e-mail da sua conta e a gente manda um link pra você redefinir a senha.`                  |
| `forgot.email`            | `E-mail`                                                                                            |
| `forgot.emailPlaceholder` | `voce@email.com`                                                                                    |
| `forgot.submit`           | `Enviar link`                                                                                       |
| `forgot.back`             | `Voltar pro login`                                                                                  |
| `forgot.successTitle`     | `Confira seu e-mail`                                                                                |
| `forgot.successBody`      | (fn) `Mandamos um link pra ${email}. Toque no link pra redefinir sua senha.`                        |
| `forgot.resend`           | `Reenviar`                                                                                          |
| `forgot.resendIn`         | (fn) `Reenviar em ${seconds}s`                                                                      |
| `forgot.notFound`         | `E-mail não encontrado.`                                                                            |
| `forgot.sent`             | `Se o e-mail existir, enviaremos um link em instantes.` _(legacy, kept for backward compatibility)_ |
| `errors.rateLimited`      | `Muitas tentativas. Aguarde um instante.`                                                           |
| `errors.unknown`          | `Algo deu errado.`                                                                                  |
| `errors.network`          | `Sem conexão. Tente novamente.`                                                                     |

## Component map

| UI element    | Primitive / Element                                                     |
| ------------- | ----------------------------------------------------------------------- | --------------------------- |
| Root          | `<SafeAreaView>` + `<KeyboardAvoidingView>` + `<ScrollView>`            |
| Back arrow    | `<Pressable>` + `<ArrowLeft>` from `lucide-react-native`                |
| Title         | `<Text variant="h2" weight="semibold">`                                 |
| Subtitle      | `<Text variant="body" tone="secondary">`                                |
| Field         | Local `<TextField>`                                                     |
| Primary CTA   | `<Button variant="primary" size="lg" fullWidth loading>`                |
| Back-to-login | `<Pressable>` + `<Text tone="muted">`                                   |
| Success icon  | `<View bg-brand/12 rounded-full>` + `<Mail>` from `lucide-react-native` |
| Success title | `<Text variant="h2" weight="semibold">`                                 |
| Success body  | `<Text variant="body" tone="secondary">` (with obscured e-mail)         |
| Resend link   | `<Pressable>` + `<Text tone="brand"                                     | "muted" weight="semibold">` |

The single brand-red surface is the `Enviar link` CTA on idle, or the
"Reenviar" inline link on success (only when the cooldown is over). The
"one brand red CTA per screen" rule from `brand.md` is preserved across
both states.

## States

1. **Idle** — Empty field, no errors, CTA enabled.
2. **Submitting** — `isSubmitting` true; CTA shows spinner via the
   `loading` prop on `<Button>`. Field stays editable.
3. **Success / Confirmation** — In-place swap. Renders mail icon,
   `Confira seu e-mail`, the obscured e-mail, `Reenviar` (with 30 s
   cooldown), and `Voltar pro login`. `accessibilityLiveRegion="polite"`
   on the swap container so screen readers announce the change.
4. **Cooldown** — Right after first submit and after each successful
   resend, the resend link disables for 30 s and renders
   `Reenviar em ${n}s` in muted tone.
5. **404 not found** — `setError('email', authCopy.forgot.notFound)`;
   field renders danger border + inline `E-mail não encontrado.`.
6. **429 rate-limited** — `setError('email', authCopy.errors.rateLimited)`;
   inline `Muitas tentativas. Aguarde um instante.`.
7. **Network failure (non-`ApiError`)** — `setError('email',
authCopy.errors.network)`; inline `Sem conexão. Tente novamente.`.
8. **Generic API error (5xx, etc.)** — `setError('email',
authCopy.errors.unknown)`; inline `Algo deu errado.`.
9. **Field validation (zod)** — `forgotPasswordSchema` from
   `@jdm/shared/auth` runs on submit; renders `errors.email?.message`.

## Resend / cooldown

- After the first successful submit, a 30-second cooldown timer starts
  via `setInterval` cleared on unmount.
- The resend `<Pressable>` is `disabled` while `cooldown > 0` and
  switches the label between `forgot.resend` and `forgot.resendIn(n)`.
- Resend re-uses `forgotPasswordRequest` against the captured e-mail
  and re-arms the cooldown on success. Errors funnel to a small inline
  `<Text tone="danger">` below the resend link, mirroring the idle-state
  error mapping (404 / 429 / network / generic).

## E-mail obscuring

Display rule: keep the first character of the local part, mask the
remainder with `•` up to length-1, keep the `@`, then keep the domain
intact. e.g. `someone@gmail.com` → `s••••••@gmail.com`. This avoids
leaking the full address back to a shoulder-surfer while still confirming
which inbox to check.

## Accessibility notes

- Root is `<SafeAreaView>`; the back row clears the notch.
- `<KeyboardAvoidingView behavior="padding">` (iOS) lifts the form when
  the soft keyboard appears; Android uses default `adjustResize`.
- Back arrow `<Pressable>` declares `accessibilityRole="link"`,
  `accessibilityLabel="Voltar"`, and `hitSlop={12}` to clear 44 pt.
- Title is a heading: `accessibilityRole="header"`.
- Subtitle is decorative body text.
- The `TextField` injects `accessibilityLabel` from its visible label,
  expanded to `${label}, error: ${message}` when an error is set.
- Success-state container uses `accessibilityLiveRegion="polite"` so
  the swap is announced.
- All inline links use `accessibilityRole="link"` with explicit
  `accessibilityLabel` and `hitSlop={12}` so the visible text reaches
  44 pt even when small.
- Primary `<Button>` already declares `accessibilityRole="button"` and
  flips `accessibilityState.busy` while submitting.
- Contrast: `text-fg (#F5F5F5)` and `text-fg-secondary (#C9C9CD)` and
  `text-fg-muted (#8A8A93)` on `bg-bg (#0A0A0A)` clear WCAG AA. The
  brand-red CTA renders `text-fg-inverse (#0A0A0A)` on `#E10600` (clears
  AA large). Danger border (`#EF4444`) + inline danger text gives a
  dual signal.

## Deliberately deferred (and why)

- **Magic-link one-tap UX.** The reset link in the e-mail still drops
  the user back into the existing `/(auth)/reset-password` web flow;
  in-app deep-link handling is out of scope for this PR.
- **CAPTCHA / bot challenge.** Server-side rate-limiting on
  `/auth/forgot-password` already exists and is the right layer.
- **"Use a different e-mail" inline action on the success state.**
  The Voltar pro login link plus a fresh trip into the screen is
  cheaper than building a third interactive affordance for a low-traffic
  recovery path. Revisit if support sees confusion.
- **Server-driven success copy.** The API only returns a generic
  `MessageResponse`; for the MVP we render local copy.
