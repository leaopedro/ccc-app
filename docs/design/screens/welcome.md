# Screen — `/welcome` (post-login home)

## Purpose

First impression of the JDM Experience brand for an authenticated user.
The screen lands you in the scene: brand wordmark up top, the next
upcoming encontro as a hero card with a clear "Ver evento" CTA, a tight
strip of follow-up events, three quick-action chips into the primary
tabs, and a display-font affirmation as a brand sign-off. It is read-only
(no API mutations) and reuses the existing `listEvents({ window:
'upcoming' })` endpoint — no new endpoints introduced.

## Layout sketch

```
SafeAreaView (bg-bg)
└─ ScrollView (px-5, vertical rhythm gap-8)
   ├─ Header row
   │  ├─ <Image logo-wordmark.webp> (h-9, contain)
   │  └─ <Text variant=eyebrow tone=muted>OLÁ, {firstName}</Text>
   │
   ├─ Section: "Próximo rolê"  (eyebrow label)
   │  └─ Hero card (Card variant=raised, p-0, rounded-xl)
   │     ├─ Cover Image (16:9, top)
   │     │   └─ overlaid Badge "INGRESSO GARANTIDO" (deferred — see states)
   │     ├─ Body (p-5, gap-3)
   │     │   ├─ <Text eyebrow tone=brand>{eventTypeLabel}</Text>
   │     │   ├─ <Text h1>{title}</Text>
   │     │   ├─ <Text bodySm tone=secondary>{dateRange}</Text>
   │     │   ├─ <Text bodySm tone=muted>{venue · city/UF}</Text>
   │     │   └─ <Button label="Ver evento" variant=primary fullWidth size=lg>
   │
   ├─ Section: "Também na cena"  (eyebrow label, only if 2+ upcoming)
   │  └─ Horizontal ScrollView (gap-3)
   │     └─ Secondary cards (w-64, Card raised, p-0)
   │        ├─ Cover Image (16:9)
   │        └─ Body (p-3, gap-1)
   │           ├─ <Text caption tone=muted>{date}</Text>
   │           ├─ <Text h3 numberOfLines={2}>{title}</Text>
   │           └─ <Text caption tone=muted>{city/UF}</Text>
   │
   ├─ Section: "Atalhos"  (3 quick-action chips, row, gap-3)
   │  ├─ Chip "Eventos"   → /events
   │  ├─ Chip "Ingressos" → /tickets
   │  └─ Chip "Garagem"   → /garage
   │
   └─ Footer brand affirmation
      └─ <Text display center>BEM-VINDO À CENA.</Text>
```

## Copy strings (PT-BR, all inline in `welcome.tsx`)

| Key                 | String                               |
| ------------------- | ------------------------------------ |
| greetingEyebrow     | `OLÁ, {firstName}`                   |
| heroEyebrow         | `PRÓXIMO ROLÊ`                       |
| heroCta             | `Ver evento`                         |
| secondaryEyebrow    | `TAMBÉM NA CENA`                     |
| quickActionsEyebrow | `ATALHOS`                            |
| quickEventos        | `Eventos`                            |
| quickIngressos      | `Ingressos`                          |
| quickGaragem        | `Garagem`                            |
| brandAffirmation    | `BEM-VINDO À CENA.`                  |
| emptyTitle          | `Nenhum encontro agendado.`          |
| emptySub            | `Volte logo. A cena não para.`       |
| errorLine           | `Não rolou carregar. Tenta de novo.` |
| errorRetry          | `Tentar novamente`                   |
| eventTypeMeeting    | `ENCONTRO`                           |
| eventTypeDrift      | `DRIFT`                              |
| eventTypeOther      | `EVENTO`                             |

`formatEventDateRange` from `~/lib/format` is reused for all date strings.

## Component breakdown (`@jdm/ui` primitives)

| UI element                     | Primitive / Element                                                     |
| ------------------------------ | ----------------------------------------------------------------------- |
| Wordmark                       | `<Image source={require('@jdm/design/...')}>`                           |
| Greeting                       | `<Text variant="eyebrow" tone="muted">`                                 |
| Section eyebrow                | `<Text variant="eyebrow" tone="muted">`                                 |
| Hero title                     | `<Text variant="h1">`                                                   |
| Hero type tag                  | `<Text variant="eyebrow" tone="brand">`                                 |
| Hero CTA                       | `<Button variant="primary" size="lg" fullWidth>`                        |
| Hero / secondary card shell    | `<Card variant="raised" padding="none">`                                |
| Secondary card title           | `<Text variant="h3" numberOfLines={2}>`                                 |
| Secondary card meta            | `<Text variant="caption" tone="muted">`                                 |
| Quick-action chip              | `<Pressable>` + `<Text variant="bodySm" weight="semibold">` (44 pt min) |
| Brand affirmation              | `<Text variant="display">` centered                                     |
| Loading skeleton               | `<View>` placeholders w/ `bg-surface-alt`                               |
| Error retry                    | `<Button variant="secondary">`                                          |
| Active-ticket badge (deferred) | `<Badge tone="success" label="INGRESSO GARANTIDO">`                     |
| Premium badge (deferred)       | `<Badge tone="brand" label="PREMIUM">`                                  |

## States

1. **Loading** — Wordmark + greeting eyebrow render immediately. Hero
   slot shows a skeleton: `Card variant="raised"` with a 16:9 dim
   placeholder + two short bars (`bg-surface-alt h-3 rounded-md`).
   Secondary strip and quick actions render their static shells (chips
   are still tappable while events load — they're routes, not data).
2. **Error** — Hero slot replaced with a centered single-line error
   `Não rolou carregar. Tenta de novo.` + secondary `Button label="Tentar novamente"`.
   Quick actions still render. Brand affirmation still renders.
3. **Empty (no upcoming events)** — Hero slot replaced with a Card showing
   `Nenhum encontro agendado.` + muted sub `Volte logo. A cena não para.`
   Secondary strip omitted. Quick actions + affirmation still render.
4. **Populated — 1 event** — Hero card only; secondary strip omitted.
5. **Populated — 2+ events** — Hero (events[0]) + secondary strip
   (events[1..3], capped at 3 cards). Strip header `TAMBÉM NA CENA`.
6. **No active ticket** _(MVP default)_ — No success badge overlay on
   hero. Primary CTA stays "Ver evento".
7. **Active ticket** _(deferred — see "Left out")_ — Top-right corner of
   hero cover overlays `<Badge tone="success" label="INGRESSO GARANTIDO">`.
   Below the CTA, a ghost link `Ver QR` would route to
   `/tickets/{ticketId}`. Not wired in MVP because `useAuth().user`
   carries no ticket data and the brief disallows new API calls here.
8. **Premium member** _(deferred — same reason)_ — A `<Badge tone="brand"
label="PREMIUM">` would render next to the greeting. Not wired in MVP
   because `PublicUser.role` only exposes `user | organizer | admin |
staff` — no membership flag.
9. **Not premium** _(MVP default)_ — No premium badge.

## Accessibility notes

- Root is `SafeAreaView`; first child of `ScrollView` has top padding so
  content clears the notch.
- Wordmark `Image` has `accessibilityLabel="JDM Experience"`.
- Greeting eyebrow has `accessibilityRole="text"` (decorative tone).
- Section eyebrows are `accessibilityRole="header"`.
- Hero card and secondary cards are `<Pressable>` with
  `accessibilityRole="button"` and a label combining title + date range,
  plus `accessibilityHint="Abre os detalhes do evento"`.
- Quick-action chips are `<Pressable>` with `accessibilityRole="button"`
  and label = chip text. Each chip is height 44 pt, gap 12 pt.
- Hero CTA uses the `Button` primitive which already wires
  `accessibilityRole="button"` and `accessibilityState`.
- Error retry uses the `Button` primitive (same).
- Body text never drops below 14 pt; metadata captions at 12 pt are
  used only for non-essential dates/locations that are also exposed via
  the parent card's `accessibilityLabel`.
- Contrast: `text-fg (#F5F5F5)` and `text-fg-secondary (#C9C9CD)` on
  `bg-bg (#0A0A0A)` and `bg-surface (#141414)` clear WCAG AA. Brand red
  CTA uses `text-fg-inverse (#0A0A0A)` for AAA on `#E10600`.
- `accessibilityLiveRegion="polite"` on the hero slot wrapper so screen
  readers announce when loading flips to populated/error.

## Deliberately left out (and why)

- **Active-ticket badge + "Ver QR" shortcut on hero.** Brief disallows
  new API calls and `useAuth().user` (PublicUser) carries no ticket
  data. State documented; component is ready to wire once
  `/me/tickets` is folded into auth bootstrap or a `useMyTickets` hook
  is introduced.
- **Premium badge + membership status line.** Same reason — no
  membership flag in `PublicUser`. Membership feature itself (F8) is
  later in the roadmap; surfacing it here would be a forward
  reference, not a real signal.
- **Hero countdown timer.** Tempting for "premium scene access" energy
  but adds re-render churn and a custom primitive. Defer to a future
  pass once `mono` countdown component lives in `@jdm/ui`.
- **Vote / category nav entry.** Voting (F6) is event-scoped, not
  global; belongs in event detail, not the home shell.
- **Notification bell / inbox.** Push delivery exists but there is no
  in-app inbox endpoint yet. Don't fake an empty bell.
- **Pull-to-refresh.** `useFocusEffect` already re-fetches on every
  focus. Adding an explicit RefreshControl on top of that would
  duplicate behaviour.
