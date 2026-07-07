# Subagent prompts — per-screen redesign

Use these prompts when dispatching coding subagents to implement the
redesigned mobile screens captured in `docs/design/screenshots/`.

Each subagent gets the universal template plus the per-screen filled-in
parameters. Spawn fresh sessions; do not reuse context. Verify output
in the main thread with `pnpm --filter @jdm/mobile typecheck` and
`pnpm --filter @jdm/mobile lint` before merging.

---

## Slug → route mapping

| #   | Slug                  | Target route                                           | Status        | Notes                                                                                  |
| --- | --------------------- | ------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------- |
| 01  | `01-welcome`          | `apps/mobile/app/welcome.tsx`                          | shipped       | reference only                                                                         |
| 02  | `02-login`            | `apps/mobile/app/(auth)/login.tsx`                     | shipped       | reference only                                                                         |
| 03  | `03-signup`           | `apps/mobile/app/(auth)/signup.tsx`                    | redesign      | uses `signupSchema` + `useAuth().signup`                                               |
| 04  | `04-forgot-password`  | `apps/mobile/app/(auth)/forgot.tsx`                    | redesign      | uses `forgotPassword` API                                                              |
| 05  | `05-verify-email`     | `apps/mobile/app/verify-email-pending.tsx`             | redesign      | uses `resendVerification` API                                                          |
| 06  | `06-home`             | `apps/mobile/app/welcome.tsx`                          | covered       | matches shipped welcome                                                                |
| 07  | `07-events-list`      | `apps/mobile/app/(app)/events/index.tsx`               | shipped       | reference only                                                                         |
| 08  | `08-event-detail`     | `apps/mobile/app/(app)/events/[slug].tsx`              | redesign      | uses `getEventBySlug`                                                                  |
| 09  | `09-nearby-empty`     | covered by `events/index.tsx`                          | n/a           | state of events list                                                                   |
| 10  | `10-tickets`          | `apps/mobile/app/(app)/tickets/index.tsx`              | redesign      | uses `listMyTickets`                                                                   |
| 11  | `11-ticket-qr`        | `apps/mobile/app/(app)/tickets/[ticketId].tsx`         | redesign      | uses `getTicket` + `react-native-qrcode-svg`                                           |
| 12  | `12-purchase-sheet`   | NEW `apps/mobile/app/(app)/events/[slug]/purchase.tsx` | new           | Stripe payment sheet entry; agent must check existing Stripe wiring                    |
| 13  | `13-purchase-success` | NEW `apps/mobile/app/(app)/events/[slug]/success.tsx`  | new           | post-payment confirmation                                                              |
| 14  | `14-garage-list`      | `apps/mobile/app/(app)/garage/index.tsx`               | redesign      | uses `listMyCars`                                                                      |
| 15  | `15-garage-detail`    | `apps/mobile/app/(app)/garage/[id].tsx`                | redesign      | uses `getCar`                                                                          |
| 16  | `16-garage-new`       | `apps/mobile/app/(app)/garage/new.tsx`                 | redesign      | uses `createCar` + R2 upload                                                           |
| 17  | `17-garage-edit`      | NEW `apps/mobile/app/(app)/garage/[id]/edit.tsx`       | new           | uses `updateCar` + `deleteCar`                                                         |
| 18  | `18-profile`          | `apps/mobile/app/(app)/profile.tsx`                    | redesign      | uses `getProfile`                                                                      |
| 19  | `19-edit-profile`     | NEW `apps/mobile/app/(app)/profile/edit.tsx`           | new           | uses `updateProfile`                                                                   |
| 20  | `20-premium`          | NEW `apps/mobile/app/(app)/premium.tsx`                | new (Phase 2) | Stripe Subscription; can scaffold UI without backend                                   |
| 21  | `21-settings`         | NEW `apps/mobile/app/(app)/settings.tsx`               | new           | LGPD endpoints (`exportData`, `deleteAccount`) — gate behind feature flag if not ready |
| 22  | `22-reset-password`   | `apps/mobile/app/reset-password.tsx`                   | redesign      | uses `resetPassword` API                                                               |
| 23  | `23-error`            | NEW `apps/mobile/app/+not-found.tsx`                   | new           | generic error route (expo-router 404)                                                  |

---

## Universal subagent prompt template

Copy-paste, fill the `{{ }}` placeholders.

```
DO NOT RETURN UNTIL ALL DELIVERABLES ARE WRITTEN AND `pnpm --filter @jdm/mobile typecheck` IS GREEN. You are forbidden from returning a "I'll continue" or "Reading files in parallel" message — those are not acceptable outputs. Only return when work is complete.

## Mission

Implement the JDM Experience mobile screen `{{SLUG}}` in code, matching the design mockup pixel-for-pixel within RN/NativeWind constraints.

The design system foundation is already in place. NativeWind v4 is wired into the app. `@jdm/design` (tokens + Tailwind preset) and `@jdm/ui` (Button, Text, Card, Badge primitives) are installed and importable from the mobile app. Three sibling screens are already shipped and serve as style reference: `app/welcome.tsx`, `app/(auth)/login.tsx`, `app/(app)/events/index.tsx`.

## Visual source of truth

Read this PNG first — it is the design contract:
`/Users/pedro/Projects/jdm-experience/docs/design/screenshots/{{SLUG}}.png`

Cross-reference with the mockup React component (rendered without RN constraints, but the layout, copy, and visual hierarchy are correct):
`/Users/pedro/Projects/jdm-experience/design/screens.jsx` (find the `{{COMPONENT_NAME}}` export)
`/Users/pedro/Projects/jdm-experience/design/data.js` (mock data shapes)
`/Users/pedro/Projects/jdm-experience/design/primitives.jsx` (mockup primitives — DO NOT import these into RN; they're HTML)

The PNG wins on any conflict.

## Required reads (in this order, with explicit offset+limit if a hook truncates)

1. `/Users/pedro/Projects/jdm-experience/packages/design/brand.md`
2. `/Users/pedro/Projects/jdm-experience/packages/design/src/tokens.ts`
3. `/Users/pedro/Projects/jdm-experience/docs/design/system.md`
4. `/Users/pedro/Projects/jdm-experience/packages/ui/src/Button.tsx`
5. `/Users/pedro/Projects/jdm-experience/packages/ui/src/Text.tsx`
6. `/Users/pedro/Projects/jdm-experience/packages/ui/src/Card.tsx`
7. `/Users/pedro/Projects/jdm-experience/packages/ui/src/Badge.tsx`
8. `/Users/pedro/Projects/jdm-experience/packages/design/tailwind-preset.cjs`
9. `/Users/pedro/Projects/jdm-experience/apps/mobile/app/welcome.tsx` (RN sibling reference)
10. `/Users/pedro/Projects/jdm-experience/apps/mobile/app/(auth)/login.tsx` (RN sibling reference)
11. `/Users/pedro/Projects/jdm-experience/apps/mobile/app/(app)/events/index.tsx` (RN sibling reference)
12. `/Users/pedro/Projects/jdm-experience/apps/mobile/src/components/TextField.tsx` (input primitive)
13. The design mockup PNG and the matching component in `design/screens.jsx`
14. {{ANY_TARGET_FILE_THAT_EXISTS}} (current implementation to replace, if any)
15. {{API_CLIENT_FILES}} (e.g. `apps/mobile/src/api/{{module}}.ts`)
16. {{COPY_FILE}} (e.g. `apps/mobile/src/copy/{{module}}.ts`)
17. `apps/mobile/src/auth/context.tsx` (only if user data is consumed)

## Implementation rules

- Use NativeWind `className=""` only. No `StyleSheet.create`. Inline `style` only for image dimensions, font-family overrides, and gradient props.
- Import primitives: `import { Button, Text, Card, Badge } from '@jdm/ui'`.
- Use `TextField` from `~/components/TextField` for any text input.
- Logo: `<Image source={require('@jdm/design/assets/logo-wordmark.webp')} style={{ width: <px>, height: <px>, resizeMode: 'contain' }} />`.
- Use `SafeAreaView` from `react-native-safe-area-context` on full-screen surfaces.
- Use `KeyboardAvoidingView` + `ScrollView` on any screen with form inputs.
- Use `expo-linear-gradient` `LinearGradient` for cover bottom-fades.
- Use `lucide-react-native` icons. Default stroke 1.75, size 24, color `#F5F5F5`.
- Touch targets ≥ 44 pt, body text ≥ 14 pt, contrast WCAG AA on dark bg.
- All copy in PT-BR. Add new strings to {{COPY_FILE}}; do not hard-code in the screen.
- No new dependencies. Use only what's already in `apps/mobile/package.json`.
- No `console.log`. No comments unless the WHY is non-obvious.
- Follow the brand red rule: ONE primary brand surface per screen.

## Logic to preserve EXACTLY

{{LOGIC_TO_PRESERVE}}

## Deferred / out of scope

{{DEFERRED}}

## Deliverables (write these files in order)

1. `/Users/pedro/Projects/jdm-experience/docs/design/screens/{{SLUG}}.md` — spec doc:
   - Purpose (1 paragraph)
   - Layout sketch (component tree)
   - All copy strings (PT-BR), grouped
   - Component breakdown referencing `@jdm/ui` primitives
   - States: loading / empty / error / populated / pressed (and any screen-specific states)
   - Accessibility notes (touch targets, labels, live regions, contrast)
   - Deliberately deferred items
2. {{TARGET_FILE_PATH}} — the implemented screen.
3. {{ADDITIONAL_FILES}} — only if the brief above instructed (new copy file entries, new components, etc.).

## Verification gate

Run from repo root: `pnpm --filter @jdm/mobile typecheck`. If it fails, read the error, fix, re-run. Loop until green.

Then run: `pnpm --filter @jdm/mobile lint`. New code must add zero new lint errors. Pre-existing warnings can stay.

Only after both gates pass, return your summary.

## Required final return

After all files exist AND typecheck + lint are clean, return a 6–10 line summary:
- File list
- Key design decisions (1–3 bullets)
- Typecheck + lint status
- Anything the main thread should know (missing data, blockers, deferred features)

If you cannot finish, describe the blocker explicitly and which file has the unresolved error. Do not return "I will continue".
```

---

## Per-screen filled-in dispatch examples

### Screen 03 — signup

```
{{SLUG}} = 03-signup
{{COMPONENT_NAME}} = SignupScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/(auth)/signup.tsx
{{API_CLIENT_FILES}} = apps/mobile/src/auth/context.tsx
{{COPY_FILE}} = apps/mobile/src/copy/auth.ts
{{LOGIC_TO_PRESERVE}} = Form must use react-hook-form + zodResolver(signupSchema) from @jdm/shared/auth. On success call useAuth().signup(values) and router.replace('/verify-email-pending'). Error mapping: 409 → setError email "E-mail já cadastrado", 422 → field errors from response, 429 → rateLimited, else → unknown. Preserve all existing copy keys in authCopy.
{{DEFERRED}} = Marketing-consent split (LGPD requirement) — render the toggle but no API call yet; persist locally via useState only. Spec'd as deferred.
```

### Screen 08 — event detail

```
{{SLUG}} = 08-event-detail
{{COMPONENT_NAME}} = EventDetailScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/(app)/events/[slug].tsx
{{API_CLIENT_FILES}} = apps/mobile/src/api/events.ts
{{COPY_FILE}} = apps/mobile/src/copy/events.ts
{{LOGIC_TO_PRESERVE}} = useFocusEffect to fetch via getEventBySlug(slug). Use existing formatEventDateRange. Sticky bottom CTA must router.push to a purchase route (placeholder: `/events/${slug}/purchase`); creating that route is screen 12, not your concern.
{{DEFERRED}} = Tier remaining-stock badge — EventSummary/Detail has no per-tier availability today; render the count placeholder gated by a `Number.isFinite(t.remaining)` check. ESGOTADO badge — same gate.
```

### Screen 10 — tickets list

```
{{SLUG}} = 10-tickets
{{COMPONENT_NAME}} = TicketsScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/(app)/tickets/index.tsx
{{API_CLIENT_FILES}} = apps/mobile/src/api/tickets.ts
{{COPY_FILE}} = apps/mobile/src/copy/tickets.ts (create if missing — add PT-BR strings)
{{LOGIC_TO_PRESERVE}} = Fetch via listMyTickets() on focus. Card press routes to `/tickets/${ticketId}`. Status mapping: VÁLIDO (paid + future), USADO (checked-in), EXPIRADO (past).
{{DEFERRED}} = Wallet pass download — out of scope; ticket QR detail handles it (screen 11).
```

### Screen 11 — ticket QR detail

```
{{SLUG}} = 11-ticket-qr
{{COMPONENT_NAME}} = TicketQRScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/(app)/tickets/[ticketId].tsx
{{API_CLIENT_FILES}} = apps/mobile/src/api/tickets.ts
{{COPY_FILE}} = apps/mobile/src/copy/tickets.ts
{{LOGIC_TO_PRESERVE}} = Fetch via getTicket(ticketId) on focus. Render QR with react-native-qrcode-svg using ticket.qrPayload (HMAC-signed string from API). Brand red corner accents are decorative.
{{DEFERRED}} = Add-to-Wallet (Apple/Google) — backend endpoint pending; render the button but disabled with a tooltip-equivalent caption "Em breve".
```

### Screen 14 — garage list

```
{{SLUG}} = 14-garage-list
{{COMPONENT_NAME}} = GarageListScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/(app)/garage/index.tsx
{{API_CLIENT_FILES}} = apps/mobile/src/api/garage.ts (or wherever listMyCars lives)
{{COPY_FILE}} = apps/mobile/src/copy/garage.ts (create if missing)
{{LOGIC_TO_PRESERVE}} = Fetch via listMyCars on focus. FAB routes to /garage/new. Card press routes to /garage/${id}.
{{DEFERRED}} = "Compartilhar na cena" share-sheet — defer to Phase 4 social feed.
```

### Screen 18 — profile

```
{{SLUG}} = 18-profile
{{COMPONENT_NAME}} = ProfileScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/(app)/profile.tsx
{{API_CLIENT_FILES}} = apps/mobile/src/api/profile.ts
{{COPY_FILE}} = apps/mobile/src/copy/profile.ts (create if missing)
{{LOGIC_TO_PRESERVE}} = Fetch via getProfile on focus. Edit button routes to /profile/edit. Logout button calls useAuth().logout() then router.replace('/login'). Existing logout flow must be preserved.
{{DEFERRED}} = Premium membership badge — gated behind `false` until membership data lands on PublicUser.
```

### Screen 22 — reset password

```
{{SLUG}} = 22-reset-password
{{COMPONENT_NAME}} = ResetPasswordScreen
{{TARGET_FILE_PATH}} = apps/mobile/app/reset-password.tsx
{{API_CLIENT_FILES}} = apps/mobile/src/auth/context.tsx (or src/api/auth.ts where resetPassword lives)
{{COPY_FILE}} = apps/mobile/src/copy/auth.ts
{{LOGIC_TO_PRESERVE}} = Token comes from useLocalSearchParams() — preserve current parsing. Form submits new password + confirm via resetPassword(token, password). On success router.replace('/login') with a success toast/banner.
{{DEFERRED}} = Password-strength meter — visual only, no zxcvbn. Use a 3-bar segmented indicator driven by length+character-class heuristics.
```

---

## Dispatch pattern

**Sequential per batch of 3** — single login agent flaked twice when batched in
parallel during the foundation pass. Safer pattern:

1. Send 3 prompts in one message (parallel via 3 `Agent` blocks).
2. Wait for all 3 to return.
3. Main thread runs full mobile typecheck + lint across the merged result.
4. If any agent short-circuits ("I'll continue"), respawn that one with a
   tighter "DO NOT RETURN EARLY" prompt — the v3 login pattern worked.
5. Move to next batch of 3.

**Worktree isolation** — for batches that touch potentially overlapping files
(e.g. multiple screens that all extend the same copy file), spawn each agent
with `isolation: "worktree"` so each works on a clean branch — main thread
merges manually.

**Recommended next batches (in priority order)**

- Batch A (auth completion): 03-signup, 04-forgot-password, 22-reset-password
- Batch B (core attendee loop): 08-event-detail, 10-tickets, 11-ticket-qr
- Batch C (garage): 14-garage-list, 15-garage-detail, 16-garage-new
- Batch D (profile + meta): 18-profile, 19-edit-profile, 21-settings
- Batch E (purchase + new flows): 12-purchase-sheet, 13-purchase-success, 20-premium
- Batch F (cleanup): 05-verify-email, 17-garage-edit, 23-error
