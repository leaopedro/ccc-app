# JDM Experience — Brand Guide

Living document. Source of truth for voice, color, type, and photography
across mobile, admin, and any future surface. Update only with CEO sign-off.

## Brand essence

JDM Experience is a Brazilian car-culture events brand. Modified-car meetings,
drift events, premium scene access. The audience is community-shaped and
high-affinity — not a generic ticketing audience.

The brand should feel: **insider, premium, racing-adjacent, high-energy.**
Never corporate, never sanitized, never stock-photography-coded.

## Logotype

The wordmark uses bold italic serif letters "JDM" overlaid on a red
Japanese-flag rising-sun pattern, with "EXPERIENCE" as a red caps box below.

Files in this package:

- `assets/logo-wordmark.webp` — full color, primary use
- `assets/sponsor-deck-reference.png` — visual reference for layout/voice

Minimum size: 32 px tall on mobile, 24 px on dense UI. Always preserve the
red-flag bleed; do not crop tighter than the EXPERIENCE box.

## Color

| Token           | Hex                | Use                                           |
| --------------- | ------------------ | --------------------------------------------- |
| `bg`            | #0A0A0A            | App background, default surface               |
| `surface`       | #141414            | Raised cards, sheets                          |
| `surfaceAlt`    | #1F1F1F            | Input backgrounds, disabled buttons           |
| `border`        | #2A2A2A            | Hairline dividers, default borders            |
| `borderStrong`  | #3A3A3A            | Hover/focus borders                           |
| `brand`         | #E10600            | Primary CTA, brand accents, key data callouts |
| `brandDeep`     | #A30400            | Pressed state on brand surfaces               |
| `brandSoft`     | #FF1A0D            | Glow / highlight (small surfaces only)        |
| `brandTint`     | rgba(225,6,0,0.12) | Background tint behind brand text             |
| `textPrimary`   | #F5F5F5            | Body text, headlines on dark                  |
| `textSecondary` | #C9C9CD            | Sub-headlines, supporting copy                |
| `textMuted`     | #8A8A93            | Hints, disabled text, metadata                |
| `textInverse`   | #FFFFFF            | Text on red brand surfaces                    |
| `success`       | #22C55E            | Confirmations, paid states                    |
| `warning`       | #F59E0B            | Pre-deadlines, low-stock                      |
| `danger`        | #EF4444            | Errors, destructive actions                   |

Contrast: every text/bg pair must clear WCAG AA (4.5:1 body, 3:1 large).
On `brand` surfaces use `textInverse`, never `textPrimary`.

## Typography

- **Display** — `Anton` (free, Google Fonts). Bold condensed. Use for
  large headlines, hero titles, event names. Always uppercase or sentence case.
- **Sans** — `Inter` (free, Google Fonts). Variable family. Body, UI, forms.
- **Mono** — `JetBrains Mono` (free, Google Fonts). Ticket codes, IDs, timers.

Scale (px):

```
xs  12   metadata, captions
sm  14   body small, helper text
base 16  body default
lg  18   list titles
xl  20   section titles
2xl 24   page titles
3xl 32   hero subtitles
4xl 44   hero titles
5xl 60   landing display only
```

Tracking:

- Body: normal
- Display headlines: tight (-0.025em)
- All-caps labels (BADGES, METADATA): widest (0.16em)

## Voice (PT-BR primary)

- Direct, second-person singular ("você"). No "prezado", no "atenciosamente".
- Active voice. Imperative for CTAs ("Comprar ingresso", "Ver evento").
- Use scene vocabulary: "rolê", "encontro", "track day", "drift", "premium",
  "membro". Avoid translating English jargon that the community already uses.
- Key info uppercase + brand red ("ESGOTADO", "PREMIUM", "CHECK-IN", "AO VIVO").
- Numbers and prices in Brazilian format ("R$ 49,90", "12/05").

Microcopy patterns:

- Empty state: 1 line, no apology. e.g. "Nenhum evento por aqui ainda."
- Error: 1 line + retry. e.g. "Não rolou carregar. Tentar de novo."
- Success: short and energetic. e.g. "Ingresso garantido. Te vemos no rolê."

## Photography

- **Subject:** modified cars + crowd. Action over portrait.
- **Light:** golden hour, low-light/neon, dramatic shadows. Never flat daylight.
- **Mood:** belonging, scene density, motion, anticipation.
- **Treatment:** high contrast, slight desaturation outside reds, deep blacks.
- **Avoid:** stock cars, white backgrounds, posed studio shots, drone-only.

Cover crops: 16:9 list cards, 4:5 hero, 1:1 thumbnails. Always allow
~15% safe area at the bottom for overlay text gradient.

## Iconography

- Use `lucide-react-native` (or equivalent stroke icons).
- Stroke width 1.75 default; 2 for primary actions.
- 24 px default size; 20 px in dense lists; 32 px hero icons.
- Icons inherit `textPrimary` by default; brand red only for active states.

## Components — high-level rules

- Touch targets ≥ 44 × 44 pt. Buttons ≥ 48 high.
- Default radius `lg` (12 px). Cards `xl` (20 px). Pills `full`.
- Default shadow on raised cards: `card`. Brand glow only on the primary CTA.
- Never use system blue. Hyperlinks in `brand` red, underlined on focus.

## Motion

- Duration `fast` (120 ms) for micro-feedback (press, toggle).
- Duration `base` (200 ms) for transitions.
- Duration `slow` (320 ms) for sheet/modal slide-ins.
- Easing: standard cubic-bezier(0.2, 0, 0, 1) for everything default.

## Do / Don't

- ✅ Use brand red sparingly — one per screen as primary CTA.
- ❌ Don't tint photos red. The flag does that already.
- ✅ Use Anton for one or two words max — long lines kill it.
- ❌ Don't combine Anton + ALL CAPS + tight tracking on small sizes.
- ✅ Keep dark surfaces uniform. Avoid more than 3 surface levels.
- ❌ Don't use gradients except subtle bottom-fade on photo overlays.
