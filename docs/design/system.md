# JDM Experience — Design System

Single-page reference. Read this before redesigning any screen.

Brand fundamentals (voice, photography, do/don't) live in
`packages/design/brand.md`. This file covers tokens, primitives, and
implementation patterns.

## Where things live

| Concern             | Path                                  |
| ------------------- | ------------------------------------- |
| Tokens (TS)         | `packages/design/src/tokens.ts`       |
| Tokens (Tailwind)   | `packages/design/tailwind-preset.cjs` |
| Brand assets        | `packages/design/assets/`             |
| Brand voice         | `packages/design/brand.md`            |
| UI primitives       | `packages/ui/src/`                    |
| Mobile Tailwind cfg | `apps/mobile/tailwind.config.js`      |
| Mobile global CSS   | `apps/mobile/global.css`              |
| Per-screen specs    | `docs/design/screens/<name>.md`       |
| Screenshots         | `docs/design/screenshots/<name>.png`  |

## How tokens get to a className

1. Source of truth: `packages/design/src/tokens.ts` (typed object).
2. Mirror: `packages/design/tailwind-preset.cjs` (Tailwind preset object).
3. Mobile `tailwind.config.js` extends the preset → NativeWind compiles
   classes to RN style objects at build time.
4. Author writes `<View className="bg-bg p-5 rounded-xl">`; NativeWind
   converts it. No runtime CSS.

If you need a token that isn't in the preset, add it to **both**
`tokens.ts` and `tailwind-preset.cjs`, in the same commit.

## Color usage rules

- One brand red surface per screen as primary CTA.
- Body text always `text-fg` on dark; never pure white (#FFF) — use `#F5F5F5`.
- Surfaces stack: `bg` < `surface` < `surface-alt`. Don't go deeper.
- Hairlines: `border-border`. Strong: `border-border-strong` (focus/hover).
- Status colors only for status — never decoration.

## Typography classes

| Variant | Class chain                                   | Use                        |
| ------- | --------------------------------------------- | -------------------------- |
| display | `font-display text-5xl tracking-tight`        | Landing hero only          |
| h1      | `font-display text-4xl tracking-tight`        | Section opener             |
| h2      | `font-sans text-2xl`                          | Page title                 |
| h3      | `font-sans text-xl`                           | List/card title            |
| body    | `font-sans text-base`                         | Default body               |
| bodySm  | `font-sans text-sm`                           | Secondary text, helper     |
| caption | `font-sans text-xs`                           | Metadata                   |
| eyebrow | `font-sans text-xs uppercase tracking-widest` | Section labels, brand tags |
| mono    | `font-mono text-base`                         | Ticket codes, IDs, timers  |

Body weight: pass `weight` prop on `<Text>` (`regular | medium | semibold |
bold`). Inter font family is set via `style={{ fontFamily }}`.

## Primitives reference (`@jdm/ui`)

### `<Button>`

```tsx
<Button label="Comprar ingresso" onPress={...} />
<Button label="Cancelar" variant="secondary" />
<Button label="Login" loading={isSubmitting} />
<Button label="Excluir" variant="danger" />
<Button label="Voltar" variant="ghost" />
```

Props: `label`, `variant` (`primary` | `secondary` | `ghost` | `danger`),
`size` (`sm` | `md` | `lg`), `loading`, `fullWidth`, `iconLeft`, `iconRight`,
all `Pressable` props.

Visual rules:

- Primary CTA = `variant="primary"`. Glow shadow on press.
- Secondary = outlined, neutral surface.
- Ghost = no surface; for tertiary nav links.
- Default size `md` (h-12). Hero CTA → `lg`.
- Always pass `fullWidth` on the primary auth/CTA in mobile flows.

### `<Text>`

```tsx
<Text variant="h1">Eventos próximos</Text>
<Text variant="bodySm" tone="muted">Curitiba/PR</Text>
<Text variant="eyebrow" tone="brand">PREMIUM</Text>
<Text variant="mono">JDM-3F2A-9K</Text>
```

Props: `variant`, `tone` (`primary` | `secondary` | `muted` | `brand` |
`inverse` | `danger`), `weight`, all `RN.TextProps`.

Default `tone="primary"`, `variant="body"`.

### `<Card>`

```tsx
<Card variant="raised" padding="md">
  <Text variant="h3">Drift Day Curitiba</Text>
  <Text tone="muted">12/05 · BR-277</Text>
</Card>
```

Props: `variant` (`flat` | `raised` | `outlined`), `padding` (`none` | `sm`
| `md` | `lg`).

### `<Badge>`

```tsx
<Badge label="ESGOTADO" tone="danger" />
<Badge label="PREMIUM" tone="brand" />
<Badge label="AO VIVO" tone="live" />
```

All caps, widest tracking, bold Inter. Props: `label`, `tone`, `size`.

## Layout patterns

- Screen container: `flex-1 bg-bg`. Add `SafeAreaView` for full-bleed
  screens; `useSafeAreaInsets()` if a screen has its own header.
- Default screen padding: `px-5` (20 px). Match the `layout.screenPadding`
  token.
- Vertical rhythm: `gap-4` for related content, `gap-6` for sections.
- Lists: `<FlatList contentContainerClassName="gap-4 px-5 py-4">`.

## Touch + accessibility

- Minimum touch target: 44 × 44 pt. Buttons hit ≥ 48.
- Every `Pressable` needs `accessibilityRole` + `accessibilityLabel`.
- Status changes need `accessibilityLiveRegion="polite"`.
- Headings get `accessibilityRole="header"`.
- Form inputs label-linked; errors in `accessibilityHint`.

## States to design for every screen

1. **Loading** — full-screen `<ActivityIndicator color={brand}>` for
   first paint; skeleton placeholders for inline updates.
2. **Empty** — single line + soft illustration if applicable. No apology.
3. **Error** — single line + retry button.
4. **Populated** — primary state.
5. **Pressed / focused** — interactive feedback; `active:opacity-80`.

## Iconography

Library: `lucide-react-native`. Stroke 1.75 default. Color inherits
`text-fg`; use `text-brand` only when icon is the active state of a tab
or button. Sizes: 20 (dense), 24 (default), 32 (hero).

## Don't reinvent

If a screen needs something the primitives don't cover — confirm with the
team and add it to `@jdm/ui` rather than one-off it. Three usages = a
primitive.
