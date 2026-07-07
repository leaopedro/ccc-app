# Garage cover presets — source artwork

Source bitmaps for the garage cover system (Phase 1 chunks 01, 07, 09). Engineer uploads these to Cloudflare R2 at chunk 09 implementation time. Filename slug matches the `GARAGE_COVER_PRESETS` catalog in `packages/shared/src/garage-covers.ts`.

## Catalog (10 total)

| Slug            | File                   | Tier    | Resolution | Status |
| --------------- | ---------------------- | ------- | ---------- | ------ |
| `default-door`  | `default-door@2x.png`  | free    | 3392×1248  | ready  |
| `tokyo-wangan`  | `tokyo-wangan@2x.png`  | premium | 3392×1248  | ready  |
| `kanjo-loop`    | `kanjo-loop@2x.png`    | premium | 3392×1248  | ready  |
| `touge-pass`    | `touge-pass@2x.png`    | premium | 3392×1248  | ready  |
| `tsukuba-dawn`  | `tsukuba-dawn@2x.png`  | premium | 3392×1248  | ready  |
| `drift-smoke`   | `drift-smoke@2x.png`   | premium | 3392×1248  | ready  |
| `workshop`      | `workshop@2x.png`      | premium | 3392×1248  | ready  |
| `autobahn-blue` | `autobahn-blue@2x.png` | premium | 1696×624   | ready  |
| `vintage-meet`  | `vintage-meet@2x.png`  | premium | 1696×624   | ready  |
| `monaco-marble` | `monaco-marble@2x.png` | premium | 1696×624   | ready  |

## Specs (target)

- Aspect ratio: 8:3 (current actual 3392:1248 or 1696:624 ≈ 2.72:1 — close enough; design tolerance allows)
- Source resolution target: 3840×1440 (@2x retina). 3 covers (`autobahn-blue`, `vintage-meet`, `monaco-marble`) ship at 1696×624 — below target but above effective display needs (mobile hero full-width ≈ 1290 px at DPR3). Re-regen at 3840×1440 + re-upload if a quality A/B against the 7 high-res presets shows a visible gap.
- Mobile hero: 168pt × full-width; thumb in picker: 80pt; lower 40% covered by identity card overlay
- Export format: JPEG primary (quality 85), WebP fallback
- Storage path: R2 `garage-cover-presets/<slug>@2x.{jpg,webp}`

## Pre-upload conversion

Source files here are PNG. Before R2 upload, convert all to JPEG (primary) + WebP (fallback):

```bash
mkdir -p /tmp/garage-covers-export
for f in docs/assets/garage-covers/*@2x.png; do
  slug=$(basename "$f" @2x.png)
  sips -s format jpeg -s formatOptions 85 "$f" --out "/tmp/garage-covers-export/$slug@2x.jpg"
  cwebp -q 80 "$f" -o "/tmp/garage-covers-export/$slug@2x.webp"
done
# Then upload /tmp/garage-covers-export/*@2x.{jpg,webp} to R2 under garage-cover-presets/
```

## Visual previews

(see individual `<slug>@2x.png` files in this folder)

## Negative space check

Bottom 40% of every cover is covered by the `IdentityCard` (cover hero is 168pt, IdentityCard sits with `margin-top: -44px`). Do NOT place focal subject in the lower 40% — it'll be hidden behind the card.

## Trademark / legal

Generated images use generic silhouettes per the AI prompts. Spot-check each before R2 upload:

- No readable license plates
- No readable badges / emblems / brand text
- No identifiable real-model car (regenerate if too close)
- No human faces in focus
- No copyrighted signage with readable words

## Naming convention

`<slug>@<density>.{png,jpg,webp}` where density is `2x` for retina source. Files used by `GarageCover` component are referenced by slug only; the component constructs the URL via `app.uploads.buildPublicUrl(garage-cover-presets/<slug>@2x.jpg)`.
