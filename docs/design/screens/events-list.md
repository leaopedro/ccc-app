# Events List — Screen Spec

Route: `apps/mobile/app/(app)/events/index.tsx`
Native header: provided by `events/_layout.tsx` (title "Eventos"). The screen
adds a brand strip below the native header to assert voice without fighting
the navigator.

## Purpose

The events list is the front door of the scene. It must read as a curated
catalogue of rolês — not a generic ticketing feed. Three windows (`upcoming`,
`past`, `nearby`) sit on a segmented control. Each event is a hero card:
16:9 cover, dark fade overlay, display-font title bottom-left, sans
metadata below. The screen rewards the insider — date in PT-BR short
format, city/state, and contextual badges (`EM BREVE` when the event is
within 7 days). All states keep the dark surface, brand red restricted to
one accent per state.

## Layout sketch

```
┌─────────────────────────────────────────┐
│  (native stack header — "Eventos")      │
├─────────────────────────────────────────┤
│  EYEBROW · CALENDÁRIO                   │  brand strip
│  Eventos                                │  display h1
├─────────────────────────────────────────┤
│  [ Próximos ] [ Anteriores ] [ Perto ]  │  segmented tabs
│  ─────────                              │  underline on active
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  │  cover 16:9
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  │
│  │   [EM BREVE]                      │  │  badge over fade
│  │   DRIFT DAY CURITIBA              │  │  display title
│  │   sex, 12 mai · 14:00 – 22:00     │  │  bodySm secondary
│  └───────────────────────────────────┘  │
│  Autódromo · Curitiba/PR                │  caption muted
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  ...next card...                  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Component tree

```
View (flex-1 bg-bg)
├─ View (px-5 pt-2 pb-4)                 -- brand strip
│  ├─ Text variant="eyebrow" tone="brand"  "Calendário"
│  └─ Text variant="h1"                    "Eventos"
├─ View (segmented tabs row)
│  └─ Pressable × 3
│     └─ Text + active underline
└─ <FlatList | LoadingSkeleton | EmptyState | ErrorState | NoLocationState>
   └─ Pressable card
      ├─ View aspect-16/9 (cover Image + LinearGradient + Badge)
      │  └─ Title overlay (bottom)
      └─ Footer row (date, venue/city, optional inline meta)
```

## Copy strings (PT-BR)

Existing in `apps/mobile/src/copy/events.ts` are reused. New keys are
added to the same `eventsCopy` object (no duplication):

```ts
header: {
  eyebrow: 'Calendário',
  title: 'Eventos',
},
list: {
  empty: 'Nenhum encontro por aqui ainda.',           // overrides existing
  emptyHint: 'Volte em breve. O cenário não para.',
  errorTitle: 'Não rolou carregar.',
  errorHint: 'Confere sua conexão e tenta de novo.',
  noLocationTitle: 'Defina seu estado no perfil pra ver o que rola perto.',
  noLocationCta: 'Editar perfil',
  retry: 'Tentar de novo',                            // overrides existing
  refreshing: 'Atualizando…',                         // unchanged
},
badges: {
  soon: 'EM BREVE',
  soldOut: 'ESGOTADO',
},
```

> Note: the existing `eventsCopy.list.empty`, `list.retry`, `list.noLocation`
> strings are kept where their meaning is unchanged; new entries above are
> added to the same export object.

## Component breakdown (`@jdm/ui` primitives)

| Region                  | Primitive                    | Notes                                       |
| ----------------------- | ---------------------------- | ------------------------------------------- |
| Brand strip eyebrow     | `Text variant="eyebrow"`     | tone `brand`                                |
| Brand strip title       | `Text variant="h1"`          | display Anton, tracking-tight               |
| Tab labels              | `Text variant="bodySm"`      | weight semibold; tone primary or muted      |
| Card title (overlay)    | `Text variant="h2"`          | one-line, `numberOfLines={2}`, font-display |
| Card date row           | `Text variant="bodySm"`      | tone secondary                              |
| Card meta row           | `Text variant="caption"`     | tone muted                                  |
| `EM BREVE` / `ESGOTADO` | `Badge`                      | tone `brand` for soon, `danger` for sold    |
| Error retry             | `Button variant="secondary"` |                                             |
| No-location CTA         | `Button variant="ghost"`     | navigates to `/profile`                     |

`Card` primitive is intentionally NOT used for the hero card. Hero cards
need image-overlay layout that the current `Card` (which forces padding

- surface bg) does not express well. The card uses a `Pressable` with
  `rounded-xl overflow-hidden bg-surface` directly. If a third hero usage
  appears we can lift this into a `<HeroCard>` primitive per the design
  system rule "three usages = a primitive."

## States

### Loading

Three skeleton cards. Each is a `View` with `bg-surface-alt rounded-xl`,
fixed `aspectRatio: 16/9` block plus two short rounded bars below.
Pulsing via `Animated.Value` opacity loop (0.4 → 1.0 → 0.4 over 1200 ms).
No external animation lib.

### Empty (upcoming / past / nearby with results = 0)

Centred column:

- Line 1: `Text variant="h3"` "Nenhum encontro por aqui ainda."
- Line 2: `Text variant="bodySm" tone="muted"` "Volte em breve. O cenário não para."

### Error

Centred column:

- `Text variant="h3"` "Não rolou carregar."
- `Text variant="bodySm" tone="muted"` "Confere sua conexão e tenta de novo."
- `Button variant="secondary" label="Tentar de novo"`

### No-location (nearby only, profile.stateCode === null)

Centred column:

- `Text variant="h3"` "Defina seu estado no perfil pra ver o que rola perto."
- `Button variant="ghost" label="Editar perfil"` → `router.push('/profile')`

### Populated

FlatList with `gap-6` between cards. Pull-to-refresh `RefreshControl` tinted
to `tokens.color.brand` (`#E10600`) on iOS via `tintColor`, on Android via
`colors={[brand]}`.

### Per-card

| State    | Visual                                                   |
| -------- | -------------------------------------------------------- |
| default  | full opacity, no scale                                   |
| pressed  | `active:opacity-80` + 0.99 scale                         |
| sold-out | badge `ESGOTADO` (danger) — currently OMITTED, see below |

## Badge derivation

- **`EM BREVE`**: shown when `startsAt - now < 7 days` AND > 0 (future only).
- **`ESGOTADO`**: there is **no `soldOut` field** on `EventSummary`
  (`packages/shared/src/events.ts`). The list payload omits tier capacity
  on purpose. So the sold-out badge is **deliberately omitted on the
  list** for now. When the API exposes it (e.g. `availability:
'on_sale' | 'sold_out' | 'closed'` on the summary), wire the badge
  here and update this spec.

## Accessibility

- Each card `Pressable`:
  - `accessibilityRole="button"`
  - `accessibilityLabel` = `${title}, ${formatted date range}, ${city}/${state}`
  - `accessibilityHint="Abre os detalhes do evento"`
- Tabs:
  - `accessibilityRole="tab"`
  - `accessibilityState={{ selected }}`
  - Targets ≥ 44 pt high (h-12 + horizontal padding)
- Header eyebrow + title:
  - Title has `accessibilityRole="header"`
- Skeleton state has `accessibilityLabel="Carregando eventos"` on the
  container with `accessibilityLiveRegion="polite"`.
- All copy passes WCAG AA on `bg` (#0A0A0A): primary `#F5F5F5` (15.5:1),
  secondary `#C9C9CD` (10.4:1), muted `#8A8A93` (4.7:1 — body sizes only).

## Deliberately left out

- **Sold-out badge wiring** — list payload doesn't carry availability.
  Stub kept in spec for the day it does.
- **Filter chips** (state / type) — `eventsCopy.filters.*` exists but
  the screen has no filter bar. Out of scope for this redesign; tracked
  as a follow-up.
- **Pagination via `nextCursor`** — preserved as not-implemented; the
  current screen never paginated. Not regressed, not added.
- **Wordmark image in the strip** — `assets/logo-wordmark.webp` exists
  but loading it as an `<Image>` adds a perf + dark-mode mask burden
  that's out of scope. The brand strip is type-led (Anton + brand-red
  eyebrow), which the brand guide endorses.
- **`Card` primitive use for hero** — see component breakdown.
- **Skeleton with `react-native-reanimated`** — current Animated API is
  enough; no new dependency.
