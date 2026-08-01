# Manual testing process

**Audience:** QA engineer, implementing engineers, CTO.

This document covers how a change gets manually verified after
implementation but before merge — the gap that automated tests don't
cover (real device behavior, real payment flow, real push delivery, real
QR scan).

## 1. When manual testing is required

| Change type                                 | Manual smoke required?                       |
| ------------------------------------------- | -------------------------------------------- |
| API-only with integration tests             | No (rely on tests)                           |
| New mobile screen or flow                   | Yes — device or simulator                    |
| New admin screen or flow                    | Yes — Vercel preview                         |
| Payment flow (Stripe / AbacatePay)          | Yes — sandbox end-to-end                     |
| Webhook handler                             | Yes — replay + dedupe smoke                  |
| Push notification                           | Yes — real device                            |
| QR scan / check-in                          | Yes — admin web on a phone                   |
| LGPD endpoints (`/me/delete`, `/me/export`) | Yes — confirm purge / export                 |
| Schema migration on Order/Ticket/Membership | Yes — staging migration + rollback rehearsal |
| Internal refactor with no behavior change   | No (tests + review)                          |

When in doubt, require a smoke. Skipping a smoke that should have happened
costs more than running one that didn't strictly need to.

## 2. Authoring a manual smoke

The PR description must include a **Manual smoke test** section. Write it
so a QA agent (or any engineer) can run it cold without context.

```markdown
## Manual smoke test

### Pre-requisites

- <accounts, env vars, sandbox keys, branch deployed to where>

### Steps

1. <action> — expect <observable result>
2. <action> — expect <observable result>
   …

### Pass criteria

- All "expect" results match.
- No regressions in <adjacent flow> (one paragraph, "I also clicked X and confirmed Y still works").

### Evidence to attach

- Screenshot of <screen>.
- Server log excerpt showing <event>.
- DB query output if relevant (e.g. `SELECT status FROM "Order" WHERE id=...`).
```

Keep steps numbered and atomic ("tap X" + "see Y"), not "do the auth flow."
A QA agent who can't reproduce the steps cold has been given an
insufficient smoke.

The F4 Stripe ticketing smoke in §3.1 is a good reference for the steps and pass criteria.

## 3. Existing smoke playbooks

Living references; update these as features land.

- **F4 Stripe ticketing** — §3.1 below (signup → buy → QR).
  Sandbox keys + Stripe CLI `stripe listen`.
- **Mobile web local branch smoke** — `docs/mobile-web.md` local-dev
  section. Use for navigation / IA checks that can run on Expo web before
  a native-device pass.
- **Cart redesign checkout parity** — §3.3 below (hosted checkout return,
  webhook settlement, card + Pix compatibility matrix).
- **Loja admin — collections + catalog visibility** — §3.5 below
  (admin produto/coleção CRUD, disable-collection visibility gate,
  storefront wire check).
- **Loja admin — Estoque (low-stock) page** — §3.6 below
  (threshold-aware visibility, quick inventory edits, status filters).
- **iOS native splash travado** — §3.7 below
  (captura de logs no device, repro local em simulator/release build).
- **F6 Push notifications** — `docs/test-push.md` + the F6 manual smoke at
  the bottom of `handoff.md`. Requires an EAS dev build, not Expo Go.
- **F10 Marketing push preference opt-out** — §3.8 below
  (mobile toggle persistence + admin dry-run exclusion).
- **Finance dashboard** — §3.2 below (permission, filters, KPIs, export).
- **X.6 Accessibility** — Section 10 below.

Future playbooks to author as features land:

- F4b Pix / AbacatePay sandbox flow.
- F5 admin scanner happy + reject flows.
- v0.1 end-to-end (signup → ticket → push → QR → check-in) — the gating
  test for `[x]`-flipping the v0.1 phase.
- F8b Annual-vs-monthly upgrade mid-cycle (future).
- LGPD `/me/delete` purge timing test.

### 3.1 F4 Stripe ticketing

Covers signup → buy → QR; also tests failure, idempotency, and refund-on-duplicate paths.

**Prerequisites (one-time)**

- Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
- Log in: `stripe login` (opens browser, pairs CLI to your test account)
- Grab Secret key (test mode) and Publishable key (test mode) from the Stripe dashboard

**Step 1 — Set secrets locally**

Edit `apps/api/.env`:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...    # filled in at step 3
TICKET_CODE_SECRET=<openssl rand -hex 32>
STRIPE_PUBLISHABLE_KEY=pk_test_... # optional
```

Edit `apps/mobile/.env.local` (create if missing):

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

**Step 2 — Bring up Postgres, apply migration, seed**

```bash
docker compose up -d
pnpm --filter @ccc/db prisma migrate deploy
pnpm --filter @ccc/db db:seed
```

**Step 3 — Start Stripe CLI listener (terminal A)**

```bash
stripe listen --forward-to localhost:4000/stripe/webhook
```

It prints `> Ready! Your webhook signing secret is whsec_XXXX` — copy that into `STRIPE_WEBHOOK_SECRET` in `apps/api/.env` and restart the API. Leave this terminal running.

**Step 4 — Start the API (terminal B)**

```bash
pnpm --filter @ccc/api dev
```

Wait for `server listening on :4000`.

**Step 5 — Start the iOS dev client (terminal C)**

```bash
pnpm --filter @ccc/mobile ios
```

First run builds the native project (~5 min). Subsequent runs are fast.

**Step 6 — Happy path: successful purchase**

1. Sign up a new account; verify email (dev shortcut: set `emailVerifiedAt` via Prisma Studio).
2. Open the seeded event from the Eventos list.
3. Tap a tier (e.g. "Geral") — border highlights.
4. Tap **Confirmar compra**.
5. Payment Sheet opens; enter test card:
   - Number: `4242 4242 4242 4242` / Expiry: any future / CVC: any 3 digits / ZIP: any 5 digits
6. Tap **Pay**.

Expected:

- Payment Sheet closes; "Ingresso confirmado!" alert shows.
- Terminal A prints `payment_intent.succeeded forwarded → [200 OK]`.
- Tap "Ver ingresso" → Ingressos tab → tap card → QR renders, screen stays awake.
- DB: `SELECT status FROM "Order" WHERE user_id = ...` is `paid`; one `Ticket` row with `status='valid'`.

**Step 7 — Failure path: declined card releases reservation**

1. Log in as a different user (previous user now has a valid ticket and is blocked).
2. Pick the same tier; note remaining count.
3. Pay with decline card `4000 0000 0000 9995`.

Expected:

- Payment Sheet shows a decline error.
- Terminal A prints `payment_intent.payment_failed → [200 OK]`.
- DB: order `status='failed'`; `ticketTier.quantitySold` back to pre-attempt value.

**Step 8 — Idempotency: replay a delivered event**

1. Copy the event id from Terminal A output (`evt_...`).
2. Run: `stripe events resend <evt_id>`
3. Watch the API logs.

Expected: webhook returns `200` with `deduped: true`; no second `Ticket` row created.

**Step 9 — Refund-on-duplicate (optional edge case)**

1. Pick a user with no ticket for event X.
2. In Prisma Studio, manually insert a `Ticket` row: `userId=<user>`, `eventId=<X>`, `tierId=<any>`, `source=comp`, `status=valid`.
3. Trigger `payment_intent.succeeded` for that user via Stripe CLI.

Expected: webhook returns `200 refunded:true`; `stripe listen` shows a refund event shortly after.

**Step 10 — Sanity checks before flipping roadmap [x]**

- Apple Pay button visible on Payment Sheet (requires real iPhone or properly configured simulator).
- Force-quit mid-payment; confirm no orphan `paid` row appears.
- `GET /me/tickets` (Ingressos tab) shows upcoming first, past last.

**Common failures**

| Symptom                                                  | Fix                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `webhook signature verification failed`                  | `STRIPE_WEBHOOK_SECRET` doesn't match `stripe listen` output. Re-copy and restart API.     |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set` in Metro | `.env.local` missing or Metro cache stale — run `pnpm --filter @ccc/mobile expo start -c`. |
| "Merchant identifier is invalid" on Apple Pay            | Expected on simulator without provisioning profile; card path still works.                 |

### 3.2 Finance dashboard (`/financeiro`)

Covers permission gating, filter behavior, KPI/table/trend consistency,
expandable-row details, CSV export, and responsive layout.

**Prerequisites**

- Local API running (`pnpm --filter @ccc/api dev`) with seeded orders
  in paid/refunded states across multiple events, providers, and methods.
- Admin app running (`pnpm --filter @ccc/admin dev`).
- Three browser sessions: one organizer, one admin, one staff account.

**Step 1 — Permission gating (admin vs staff)**

1. Log in as `staff` role — navigate to `/financeiro`.
   Expect: redirect to `/check-in`. The page never renders.
2. Manually visit `/financeiro` by URL while logged in as staff.
   Expect: redirect to `/check-in` (middleware layer).
3. Log in as `admin` role — navigate to `/financeiro`.
   Expect: dashboard loads with KPI tiles, trend chart, revenue table, payment mix.
4. Log in as `organizer` role — navigate to `/financeiro`.
   Expect: same as admin; dashboard renders fully.

**Step 2 — Filter combinations + URL deep-link/back behavior**

1. Set a date range (e.g. `from=2026-04-01` to `to=2026-04-30`).
   Expect: URL updates with `?from=...&to=...`. All sections reload with filtered data.
2. Add a provider filter (click "Stripe" chip).
   Expect: `&provider=stripe` appended to URL. Data reflects only Stripe orders.
3. Add a method filter (click "Pix" chip).
   Expect: `&method=pix` appended. Data reflects Stripe + Pix intersection.
4. Copy the full URL, open in a new tab.
   Expect: same filter state restored from URL params. Same data shown.
5. Click browser Back.
   Expect: previous filter state restored.
6. Click "Limpar filtros".
   Expect: URL resets to `/financeiro`. All filters cleared. Full dataset shown.
7. Toggle a chip off by clicking it again.
   Expect: that param removed from URL. Data updates.

### 3.7 iOS app stuck on native splash

Use this when an installed iPhone build never gets past the native splash.

**Goal**

- Confirm whether the app is crashing before React mounts.
- Capture native and JS logs from the affected device.
- Reproduce with the closest local build before changing code.

**Step 1 — Read device logs from macOS Console**

1. Plug the iPhone into the Mac by cable.
2. Open `Console.app`.
3. In the left sidebar, select the iPhone under **Devices**.
4. Filter by the bundle id in use:
   - Preview: `com.jdmexperience.app.preview`
   - Production: `com.jdmexperience.app`
5. Launch the app and watch for:
   - `EXC_CRASH`
   - `Termination Reason`
   - `No bundle URL present`
   - `Unhandled JS Exception`
   - `expo-updates`
   - `StripeProvider`
   - `SecureStore`

Pass:

- You captured the first fatal line or confirmed there was no crash line.

Expected new breadcrumbs from the current app build:

- `[boot] root-layout.module-evaluated`
- `[boot] sentry.init-complete`
- `[boot] auth.boot.start`
- `[boot] auth.boot.no-session` or `[boot] auth.boot.authenticated`
- `[boot] boot.ready`

If you never see `root-layout.module-evaluated`, the app likely failed before
the JS bundle executed. Treat that as a native startup failure, not a React one.

If you see the early boot breadcrumbs but never `boot.ready`, look for the
paired `[mobile-error] ...` line in the same log window. That is the exact
startup exception context emitted by the app.

**Step 2 — Read simulator logs for a local repro**

```bash
xcrun simctl list devices
xcrun simctl boot "<simulator name>"
xcrun simctl spawn booted log stream --level debug --predicate 'processImagePath CONTAINS "JDM Experience"'
```

In another terminal:

```bash
APP_VARIANT=development pnpm --filter @ccc/mobile ios
```

Pass:

- Local boot either succeeds or prints the failing native/JS exception.

**Step 3 — Reproduce a release-like JS bundle locally**

```bash
APP_VARIANT=preview pnpm --filter @ccc/mobile exec expo start --no-dev --minify --clear
```

Then open the dev client or simulator build against that bundle.

Why:

- This is the closest fast repro for issues that only appear with minified production JS.

**Step 4 — Validate the embedded build config**

```bash
APP_VARIANT=preview pnpm --filter @ccc/mobile exec expo config --type public
```

Confirm:

- `ios.bundleIdentifier` matches the installed app.
- `extra.apiBaseUrl` points at Railway for `preview`.
- `updates.url` is present.
- `extra.eas.projectId` is present in the EAS build environment.

**Step 5 — Common root causes in this repo**

- Boot-time auth storage failure can leave auth in `loading`.
- A render-time exception in `app/_layout.tsx` can look like a stuck splash.
- Missing or wrong EAS project config can break update/bootstrap behavior.
- Native module version skew can break startup before UI renders.

**Current known diagnostics**

- `npx expo-doctor` currently reports a duplicate native dependency tree for React:
  `react@19.1.0` and nested `react@19.2.4`.
- The mobile boot path now captures auth boot exceptions and root-layout render
  failures so the next failing build should expose a visible fallback or a Sentry event.

### 3.8 F10 marketing push preference opt-out

Covers the mobile marketing toggle, persisted consent, and the guarantee
that opted-out users are excluded from future broadcast sends.

**Prerequisites**

- Backend with JDMA-518 and JDMA-520 merged.
- Mobile dev build or simulator logged in as a test user.
- Admin access to the broadcast composer or API.
- At least one device token already registered for the test user.

**Steps**

1. Open `Perfil` -> `Notificações de marketing`.
   Expect the screen to show one marketing toggle, one save button, and a
   note that transactional pushes stay separate.
2. Turn the toggle off and tap `Salvar preferência`.
   Expect a success banner confirming marketing push was disabled.
3. Fully close and reopen the app, then revisit the same screen.
   Expect the toggle to remain off.
4. As an admin, run a broadcast dry-run that would normally include the
   same user.
   Expect the estimated audience to exclude that opted-out user.
5. Re-enable the toggle and save again.
   Expect the success banner for enabled state and a subsequent dry-run to
   count the user again.

**Pass criteria**

- The marketing preference persists across app relaunch.
- Transactional messaging copy remains explicit on screen.
- Dry-run counts reflect the opt-out immediately after save.

**Evidence to attach**

- Screenshot of the mobile preference screen in the off state.
- API or admin evidence showing the dry-run count before and after
  re-enabling.

**Step 3 — KPI/table/trend consistency for the same recut**

1. Apply a specific filter combination (e.g. Stripe + card + date range).
2. Note KPI "Receita total" value.
3. Sum the "Receita" column in the revenue table.
   Expect: matches KPI total (both draw from same `buildWhere`).
4. Hover over trend chart points and mentally sum daily values.
   Expect: rough match with KPI total.
5. Check payment mix percentages sum to 100% (within rounding).
6. Verify "Pedidos" KPI matches sum of order counts in revenue table.
7. Verify "Reembolsado" KPI matches sum of refunded values in expandable rows.

**Step 4 — Expandable-row payment mix details**

1. Click any event row in the revenue table.
   Expect: row expands showing "Reembolsado" and "Receita liquida".
2. Verify "Receita liquida" = revenue minus refunded for that event.
3. Click the same row again.
   Expect: row collapses.
4. Click a different row.
   Expect: previous row stays collapsed; new row expands (one at a time).

**Step 5 — CSV export consistency with on-screen totals**

1. With filters applied, click "Exportar CSV agregado".
   Expect: file downloads as `financeiro-YYYY-MM-DD.csv`.
2. Open the CSV. Verify header row:
   `event,city,state,currency,method,provider,status,kind,product_or_collection,order_count,total_amount_cents,total_quantity,first_order_at,last_order_at`
3. Confirm the screen copy states the export is aggregate-only and that cohorts with fewer than 5 pedidos are hidden.
4. Count data rows. Compare them with the visible aggregate cuts implied by the filters.
   Expect: only cohorts with at least 5 matching orders appear. Smaller cuts are omitted entirely.
5. Sum `total_amount_cents` for `status=paid` rows.
   Expect: matches the visible finance slice for the same filters, allowing for suppressed small cohorts to be absent from the CSV.
6. Verify CSV fields with commas or quotes are properly escaped (double-quoted).
7. Apply a narrow filter that should leave fewer than 5 matching orders in one cohort.
   Expect: header-only CSV, no user-level rows, and no direct identifiers anywhere in the file.

**Step 6 — Loading/empty/error/no-permission states**

1. Throttle network (DevTools > Network > Slow 3G) and reload `/financeiro`.
   Expect: skeleton pulse animation shows for KPIs, chart, and table.
2. Apply a filter that matches zero orders (e.g. absurd date range).
   Expect: "Sem dados financeiros" empty state.
3. Kill the API server, then reload the page.
   Expect: error state with message, "Tentar novamente" button, and copyable error ID.
4. Click "Copiar ID: ..." button.
   Expect: error ID copied to clipboard.
5. Restart API and click "Tentar novamente".
   Expect: page reloads and data appears.

**Step 7 — Mobile responsive behavior**

1. Resize browser to mobile width (< 640px) or use DevTools device emulation.
2. Filter bar: verify "Filtros" toggle button appears instead of inline bar.
   Tap it — filter panel opens. Tap again — closes.
3. KPI tiles: verify 2-column grid on mobile (not 6-column).
4. Revenue table: verify card layout replaces the desktop table.
   Each card shows event title, date, city, revenue, orders, tickets.
5. Tap a card — expandable section shows refunded + net revenue.
6. Trend chart: verify it scales to fit narrow viewport via `ResponsiveContainer`.
7. Payment mix: verify progress bars and labels remain readable.
8. "Exportar CSV" button: verify it remains accessible and functional.

**Pass criteria**

- All "expect" results match across steps 1-7.
- No console errors or React warnings during the flow.
- KPI totals, table sums, and CSV totals are internally consistent.

**Evidence to attach**

- Screenshot of dashboard with data and filters applied.
- Screenshot of staff role redirect.
- Screenshot of mobile layout (revenue cards + collapsed filters).
- Screenshot of empty state.
- Screenshot of error state with error ID.
- Exported CSV file snippet showing header + sample rows.

**Common failures**

| Symptom                                    | Fix                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Filters don't persist on page reload       | Check `useSearchParams` is reading from URL, not local state.                              |
| KPI and table totals mismatch              | Verify both use `buildWhere` with same filter params; check paid-only vs all-status math.  |
| CSV export empty despite on-screen data    | Server action may not forward auth cookie; check `finance-actions.ts` cookie forwarding.   |
| Mobile cards don't show expandable section | Verify `onClick` handler on the card div, not just the desktop `<tr>`.                     |
| Trend chart doesn't render                 | Check `recharts` is installed and `ResponsiveContainer` has a parent with explicit height. |

### 3.3 Cart redesign checkout parity matrix (JDMA-253)

Use this matrix for the redesigned purchase flow rollout. The objective is
to prove parity across provider behaviors at the settlement boundary:
verified webhook marks state, duplicate delivery is idempotent, and stock
release happens on failed/expired checkout.

**Pre-requisites**

- Run §3.1 steps 1–5 (API up, Stripe listener up, seeded DB).
- Prepare a test event with at least one tier and one optional extra.
- Keep one test user with no ticket for the event and one with a valid
  ticket (for extras-only branch).

| ID  | Provider              | Scenario                         | Trigger                                                                                                                                           | Expected result                                                                                                                                                                            |
| --- | --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Stripe (card)         | Hosted checkout happy path       | `POST /orders/checkout` from mobile web checkout, complete payment in Stripe-hosted page                                                          | Return URL includes `orderId`; webhook `checkout.session.completed` or `payment_intent.succeeded` settles order; `Order.status='paid'`; one `Ticket` (or `order.quantity` tickets) issued. |
| C2  | Stripe (card)         | Session expired/cancelled        | Start checkout but abandon until `checkout.session.expired` (or trigger event replay for `checkout.session.expired`)                              | `Order.status='failed'`; reserved tier capacity and extras stock are released; no ticket issued.                                                                                           |
| C3  | Stripe (card)         | Idempotent replay                | Replay the exact delivered Stripe event (`stripe events resend <evt_id>`)                                                                         | API returns `200` with `deduped: true`; no duplicate ticket or stock mutation.                                                                                                             |
| C4  | Stripe (card)         | Cross-provider isolation         | Create a pending Pix order (`provider='abacatepay'`) with `providerRef` that matches a Stripe PI; send `checkout.session.completed` using that PI | Stripe handler returns `ignored`; Pix order remains `pending`; no ticket issued.                                                                                                           |
| P1  | AbacatePay (Pix)      | Signature enforcement            | Send `/abacatepay/webhook` without or with invalid `x-webhook-signature`                                                                          | `401 Unauthorized`; no `PaymentWebhookEvent` row written.                                                                                                                                  |
| P2  | AbacatePay (Pix)      | Idempotent replay                | Send the same valid AbacatePay event id twice                                                                                                     | First call `200 { ok: true }`; second call `200 { ok: true, deduped: true }`; exactly one `PaymentWebhookEvent` row for `(provider='abacatepay', eventId)`.                                |
| C5  | Cart extras-only path | Existing ticket buys extras only | Existing ticket holder runs extras-only checkout flow                                                                                             | `Order.kind='extras_only'`; tier `quantitySold` unchanged; extras stock decremented and reconciled by webhook outcome.                                                                     |

**UX evidence requirements for QA handoff (mandatory)**

- Screen recording from tier selection to hosted checkout redirect and return
  to app/web with `orderId` visible in URL/query.
- Screenshot of cart/review total before checkout and success/failure state
  after return.
- API log excerpt with webhook `event.id`, event type, and `deduped`/`ignored`
  result for the same order.
- DB evidence for each matrix row:
  - `SELECT id,status,provider,method,kind,quantity FROM "Order" WHERE id='<orderId>';`
  - `SELECT id,order_id,status FROM "Ticket" WHERE order_id='<orderId>';`
  - `SELECT id,quantity_sold FROM "TicketTier" WHERE id='<tierId>';`
  - if extras used: `SELECT extra_id,quantity FROM "OrderExtra" WHERE order_id='<orderId>';`

### 3.4 Cart rollout and rollback playbook (JDMA-253)

Run this playbook when shipping cart-redesign checkout changes.

**Rollout**

1. Deploy API first (webhook + checkout handlers), then admin/mobile.
2. Run matrix rows `C1`, `C3`, and `C4` immediately in staging/preview.
3. If Pix is in scope for the release, also run `P1` and `P2` before
   promoting to production.
4. Promote only after evidence for all required rows is attached to the
   Paperclip issue.

**Rollback trigger conditions**

- Duplicate ticket issuance for one paid order.
- `Order.status` stuck `pending` after verified webhook delivery.
- Tier/extras stock drift (`quantitySold` not released on failed/expired).
- Cross-provider contamination (Stripe webhook mutates Pix order, or vice
  versa).

**Rollback path**

1. Pause new checkouts at the app edge (hide buy CTA or maintenance gate).
2. Revert API commit(s) that introduced checkout/cart behavior changes.
3. Apply DB rollback steps from
   `docs/migration-rollback-cart-redesign.md`.
4. Replay one Stripe and one AbacatePay webhook in staging to verify
   idempotency and isolation before reopening checkout.

### 3.5 Loja admin — collections + catalog visibility (JDMA-369)

Covers the admin store CRUD surface and the storefront visibility gate.
Primary objective: prove that disabling a `Collection` removes it from the
public storefront within one refresh, while products still ship via their
own `Product.status`.

The smoke runs entirely against local infra (Postgres + API + admin web).
Mobile storefront UI is not yet shipped, so storefront verification reads
the public `/store/*` API directly — that is the wire mobile will consume.

**Pre-requisites**

- Postgres up via `docker compose up -d`.
- Migrations applied + seed loaded:

  ```bash
  pnpm --filter @ccc/db prisma migrate deploy
  pnpm --filter @ccc/db db:seed
  ```

- API running: `pnpm --filter @ccc/api dev` (port 4000).
- Admin running: `pnpm --filter @ccc/admin dev` (port 3000).
- An admin user. The seed does not create one; sign up via the
  mobile/admin flow, then promote via Prisma Studio (or directly in
  Postgres):

  ```sql
  UPDATE "User" SET role = 'admin', email_verified_at = NOW()
  WHERE email = '<your-email>';
  ```

- `curl` and `jq` for the wire checks.

The seed already provisions one `ProductType`
(`Vestuário e Acessórios`), one `Collection` (`colecao-jdm-2026`),
plus the `StoreSettings` singleton and at least two seeded products
attached to that collection. Reuse them for steps 1–6 and create
fresh entities only when exercising create flows.

**Step 1 — Login + nav (admin browser)**

1. Open `http://localhost:3000/login`. Sign in as the admin user.
2. Open `/loja/produtos`.
   Expect: list renders with the seeded products, columns
   `título`, `tipo`, `status`, `variantes`, `vendidos`, `preço`.
3. Open `/loja/colecoes`.
   Expect: `colecao-jdm-2026` appears with the `Ativa` toggle on and
   the seeded product count.
4. Open `/configuracoes` (store settings — admin-only, not nested
   under `/loja`).
   Expect: singleton form renders with `defaultShippingFeeCents`,
   `lowStockThreshold`, `pickupDisplayLabel`, `supportPhone` filled
   from `StoreSettings`.

**Step 2 — Create a Coleção**

1. From `/loja/colecoes` click `Nova coleção`.
2. Fill: `slug=qa-2026`, `nome=QA 2026`, `descrição=Teste QA`,
   `ordem=99`, leave `Ativa` checked.
3. Submit.
   Expect: redirect to `/loja/colecoes/<id>`. Editor renders empty
   `Produtos` block.

**Step 3 — Attach two products to the new Coleção**

1. In the editor, use the `Adicionar produto:` select to add one
   `active` product. Wait for the `Salvando…` indicator to clear.
   Expect: product appears in the assigned list with order index `1`.
2. Add a second `active` product.
   Expect: list now shows two products, indices `1` and `2`.
3. Drag-equivalent: click the `↓` button on the first row.
   Expect: order swaps. Refresh the page.
   Expect: persisted order matches what was visible before refresh
   (server is the source of truth).

**Step 4 — Confirm storefront sees the new Coleção**

Run from a second terminal (uses the same API origin the mobile app
will hit):

```bash
curl -s http://localhost:4000/store/collections | jq '.items[] | {slug, name, productCount}'
```

Expect: `qa-2026` row present with `productCount: 2`.

```bash
curl -s 'http://localhost:4000/store/products?collectionSlug=qa-2026' \
  | jq '.items | length, [.[] | .slug]'
```

Expect: length `2`; both attached product slugs returned.

**Step 5 — Disable the Coleção (the gate)**

1. Back in the admin editor at `/loja/colecoes/<id>`, uncheck `Ativa`
   and click `Salvar`.
   Expect: form persists, `Salvando…` toggles, page returns to its
   normal state without an error toast.
2. **One refresh later**, re-run the two `curl` checks from Step 4.
   - `/store/collections`: `qa-2026` MUST be absent. Other active
     collections that still have an active product remain present.
   - `/store/products?collectionSlug=qa-2026`: response items array
     MUST be empty (`[]`). The endpoint stops surfacing any product
     scoped through the disabled collection slug.
3. The two products themselves remain visible via `/store/products`
   (no collection filter) because their `Product.status` is still
   `active`. This is the intended behavior — disabling a collection
   hides the _collection-scoped_ surface, not the products.
4. Open `/loja/colecoes` in the admin.
   Expect: `qa-2026` row still listed for admins (admin list ignores
   the active flag) and the toggle visibly reflects `inativa`.

**Step 6 — Re-enable + verify recovery**

1. Re-check `Ativa` and save.
2. Re-run the two `curl` checks.
   Expect: `qa-2026` and its two products are visible again.

**Step 7 — Tipos and Configurações sanity**

1. `/store/tipos`: create `QA Bonés`. Expect: appears in the list.
2. Try to delete a type that has products attached.
   Expect: server returns the existing PT-BR error message; row stays.
3. `/configuracoes`: change `lowStockThreshold` from `5` to `3`,
   save, refresh. Expect: persisted value is `3`. Restore to `5`
   afterward.

**Step 8 — Audit trail**

After the run, inspect `AdminAudit` for the actions you performed:

```bash
psql "$DATABASE_URL" -c \
  "SELECT entity_type, action, entity_id, created_at \
   FROM \"AdminAudit\" ORDER BY created_at DESC LIMIT 20;"
```

Expect one row per mutation across steps 2, 3, 5, 6, 7 with the
right `actorUserId` and entity types (`store_collection`,
`store_settings`, `product_type`). Product↔collection assignment
edits emit `action = store.collection.update` rather than a separate
entity row — that is intentional.

**Pass criteria**

- Steps 1–8 produce the expected results.
- The disable-collection gate (Step 5) shows the storefront wire
  hiding both the collection and all collection-scoped products on
  the very next request after save.
- Admin list still shows the disabled collection so an admin can
  re-enable it without database access.
- No console errors in the admin browser session and no `5xx` log
  lines in the API terminal.

**Evidence to attach**

- Screenshot of `/loja/colecoes` after Step 2 (new coleção visible).
- Screenshot of the editor at Step 3 with two products assigned.
- Terminal capture of the four `curl` commands in Steps 4 and 5
  showing the `length: 2` → `length: 0` transition for the same
  `collectionSlug`.
- Screenshot of `/loja/colecoes` after disable (Step 5.4) showing
  `qa-2026` still present with the toggle off.
- DB query output from Step 8.

**Until QA is hired**

The implementing engineer (or PR reviewer) runs steps 1–8 against
their local stack and attaches the evidence above to the PR + the
parent QA issue. Wire-level coverage of the disable gate is also
asserted by `apps/api/test/store/catalog.test.ts` (cases
`returns only active collections that contain at least one active product`
and `filters by collectionSlug and ignores disabled collections`),
which lets the smoke be reproduced headlessly when the admin UI
cannot be exercised in the heartbeat.

**Common failures**

| Symptom                                                 | Fix                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/store/collections` still lists the disabled coleção   | Check `apps/api/src/routes/store.ts` keeps `where: { active: true, products: { some: ... } }`. |
| Disabled coleção still surfaces products via slug query | Check `where.collections.some.collection.active = true` is still enforced on the public route. |
| Admin list hides disabled coleções                      | Admin route must NOT inherit the active filter; otherwise admins cannot re-enable.             |
| `AdminAudit` row missing after a mutation               | Verify the route still calls `recordAdminAudit` with the expected `entityType` + `action`.     |

### 3.6 Loja admin — Estoque (low-stock) page (JDMA-363)

Covers the Estoque admin surface that surfaces low and zero-stock
variants and offers in-place inventory edits. Drives off
`StoreSettings.lowStockThreshold` and the existing variant PATCH
route.

**Pre-requisites**

- Same local stack as §3.5 (Postgres, API on `:4000`, admin on
  `:3000`, an admin/organizer user).
- At least one `Product` with `status != archived` and three
  variants seeded for the threshold matrix below. Use Prisma Studio
  or psql to set the variants directly:

  ```sql
  -- example: threshold = 5
  -- v_ok      → quantityTotal=20, quantitySold=0   (available 20 → ok)
  -- v_low     → quantityTotal=4,  quantitySold=0   (available 4  → low)
  -- v_zero    → quantityTotal=2,  quantitySold=2   (available 0  → zero)
  ```

**Step 1 — Threshold + filters**

1. Open `/loja/estoque` (via the `Estoque` tab in the Loja section).
   Expect: header reads `Limite de estoque baixo: 5` (or whatever
   the singleton holds) with an `ajustar` link to
   `/loja/configuracoes`. Filter chips show `Todos (N)`, `Estoque
baixo (N)`, `Esgotados (N)` with non-zero counts matching the
   seeded matrix.
2. Click `Estoque baixo`.
   Expect: only `v_low` is listed. URL becomes
   `/loja/estoque?status=low`.
3. Click `Esgotados`.
   Expect: only `v_zero` is listed.
4. Click `Todos`.
   Expect: the three seeded variants appear, sorted by
   `available` ascending (zero, low, ok).

**Step 2 — Status badges and visual cues**

1. Confirm each row's badge matches the available column:
   `Esgotado` (red) for `v_zero`, `Baixo` (amber) for `v_low`,
   `OK` (green) for `v_ok`.
2. Inactive or non-active products still appear when not archived;
   verify via a `draft` product seeded with `available <= threshold`
   that it shows up under `Estoque baixo` with a `draft` chip in the
   product subtitle.

**Step 3 — Quick inventory edit (happy path)**

1. In the `v_low` row, change `Estoque total` from `4` to `12` and
   click `Salvar`.
   Expect: the form action settles and the row's `Disponível`
   updates to `12 - quantitySold`. Refreshing the page persists the
   change.
2. Filter to `Estoque baixo`.
   Expect: `v_low` is gone (now classified `ok`). Counts in the
   chip header decrement accordingly.

**Step 4 — Guard rail: cannot drop below `quantitySold`**

1. Pick a variant with `quantitySold > 0` (seed sales by issuing a
   paid `Order` against it, or set `quantitySold` directly via
   psql for the smoke).
2. Try setting `Estoque total` below the variant's `quantitySold`.
   Expect: the input's `min` already prevents most submissions; if
   forced via devtools, the API returns `409 Conflict` and the
   row shows a PT-BR error message
   (`quantityTotal cannot drop below quantitySold`).

**Step 5 — Threshold awareness**

1. Open `/loja/configuracoes`, change `lowStockThreshold` from `5`
   to `10`, save.
2. Return to `/loja/estoque` (one refresh).
   Expect: variants previously labelled `OK` whose `available`
   now sits within `[1, 10]` switch to the amber `Baixo` badge and
   migrate into the `Estoque baixo (N)` filter count.
3. Restore the threshold to `5` after the smoke.

**Step 6 — Auth gates**

1. Log in as a `staff` user.
   Expect: the Loja section (and its Estoque tab) is not present in
   the admin nav and a direct hit on `/loja/estoque` returns the
   layout's role gate (or 403 if you `curl`
   `/admin/store/inventory`).
2. Curl `/admin/store/inventory` without a token.
   Expect: `401`.

**Pass criteria**

- Filter chips reflect threshold-aware counts and switch the table
  contents on click.
- Quick edits persist via the existing variant PATCH route and the
  row revalidates without a full reload.
- The `quantityTotal < quantitySold` guard surfaces the PT-BR
  conflict message rather than silently accepting the change.
- Threshold changes propagate within one refresh.

**Evidence to attach**

- Screenshot of `/loja/estoque?status=low` with the seeded matrix.
- Screenshot of a successful inventory edit (before/after).
- Terminal capture of the `409 Conflict` from the guard rail step.
- DB query showing `Variant.quantityTotal` mirrors the admin edit.

**Until QA is hired**

The implementing engineer runs steps 1–6 locally and attaches the
evidence above to the PR. Wire-level coverage of the threshold and
status filters is asserted by
`apps/api/test/admin/store-inventory.test.ts`.

### 3.9 F8 Premium subscription smoke

Covers Stripe test-mode and RevenueCat sandbox billing flows end-to-end.
Run after all 19 F8 chunks have merged and before flipping
`GROWTH_PREMIUM_BILLING_ENABLED` in Railway.

**Prerequisites (all required)**

- All 19 F8 chunks merged to `main` and deployed to the Railway preview environment.
- `GROWTH_PREMIUM_BILLING_ENABLED=true` set in the **preview** Railway service
  (NOT production yet — the flag stays `false` in production until this smoke passes).
- Stripe CLI installed: `brew install stripe/stripe-cli/stripe`.
- Stripe CLI logged in: `stripe login`.
- Stripe test-mode secret key (`sk_test_...`) and billing webhook secret
  (`whsec_...`) set in the preview API environment.
- RC sandbox Apple ID registered (App Store Connect → Users → Sandbox Testers).
- TestFlight preview build installed on an iPhone (from `eas build --profile preview`).
- An organizer admin account with at least one published future event that has a
  `TicketTier.isPremiumGrantable = true` tier.
- Stripe Billing Portal enabled (see `docs/stripe.md §3`).

**Step 1 — Start the Stripe CLI billing listener (terminal A)**

```bash
stripe listen --forward-to https://<preview-api>/webhooks/stripe-billing
```

Leave this running. Copy the printed `whsec_...` into the preview Railway
`STRIPE_BILLING_WEBHOOK_SECRET` variable if not already set. Redeploy.

**Step 2 — Stripe: monthly subscribe (web / Android path)**

1. Open `https://<preview-admin>/premium` while signed in as a test user.
2. Click **Assinar Gold** (monthly card).
3. In the Stripe Checkout page, enter test card `4242 4242 4242 4242` /
   future expiry / any CVC / any zip.
4. Complete the payment.

Expected:

- Browser redirects back to `/me/billing` (or the configured `successUrl`).
- Terminal A prints: `invoice.paid → forwarded → 200 OK`.
- In the Railway preview API logs:
  `billing_event.applied { kind: "subscription.activated", provider: "stripe" }`.
- DB (Railway → Postgres → Prisma Studio or `psql`):
  `SELECT status, tier, cadence FROM "PremiumMembership" WHERE "garageId" = '<id>'`
  → `active | gold | monthly`.
- `SELECT "premiumTier", "premiumUntil" FROM "Garage" WHERE id = '<id>'`
  → `gold | <now + 1 month>`.
- Admin `/financeiro`: "Membros Ativos" KPI increments by 1. Invoice appears
  in `/financeiro/membros`.
- XP: `SELECT delta, reason FROM "XpEvent" WHERE "garageId" = '<id>'`
  → one row with `reason = 'premium_activation'`, `delta = 200`.

**Step 3 — Stripe: verify backfill**

After activation, the post-commit backfill worker should have run.

Expected:

- `SELECT * FROM "Ticket" WHERE "userId" = '<uid>' AND source = 'premium_grant'`
  → one row per published future event that has a grantable tier.
- If an event has no grantable tier: Railway API logs contain
  `premium_grant.no_tier { eventId: '<id>' }`.

**Step 4 — Stripe: annual subscribe (web path)**

Repeat step 2 with the **annual** card selected. Use a second test user.

Expected: same as step 2 but `cadence = annual`. `currentPeriodEnd` is ~1 year out.
Admin `/financeiro` MRR tile: `Math.round(gross/12)` added (not full gross).

**Step 5 — Stripe: cancel at period end**

1. Signed in as the monthly subscriber from step 2, open `/me/billing`.
2. Click **Gerenciar assinatura** → Stripe Billing Portal opens.
3. In the portal, click **Cancel plan** → confirm.
4. Close the portal tab.

Expected:

- Terminal A prints: `customer.subscription.updated → forwarded → 200 OK`.
- Railway API logs: `billing_event.applied { kind: "subscription.cancelled" }`.
- DB: `PremiumMembership.status = 'cancel_scheduled'`,
  `cancelAtPeriodEnd = true`, `cancelledAt` set.
- `Garage.premiumTier` and `premiumUntil` unchanged (entitlement persists
  through current period).
- Admin `/financeiro/membros`: row shows `cancel_scheduled` status.

**Step 6 — Stripe: refund flow**

1. In Stripe Dashboard → Payments → find the latest charge for the monthly
   subscriber.
2. Click **Refund** → full refund.
3. Observe Terminal A: `charge.refunded → forwarded → 200 OK`.

Expected:

- DB: `PremiumMembershipInvoice.status = 'refunded'`, `refundedAt` set.
- `PremiumMembership.status` unchanged (still `cancel_scheduled`).
- Entitlement persists through `currentPeriodEnd` (canon §F8.10).

**Step 7 — RevenueCat sandbox: iOS subscribe via TestFlight**

1. On the iPhone with the TestFlight build, sign in as the RC sandbox test user.
2. Open **Settings → Premium** in the app.
3. Tap **Assinar Gold** (monthly or annual).
4. The native StoreKit sheet appears. Confirm with the sandbox Apple ID.

Expected:

- RC Dashboard → Customers → find by garageId: entitlement `premium_gold` shows
  `active`.
- Railway API logs (or Railway log stream): `billing_event.applied { kind:
"subscription.activated", provider: "apple_revenuecat" }`.
- DB:
  - `SELECT status, provider FROM "PremiumMembership"` → `active | apple_revenuecat`.
  - `SELECT "devFeePercent" FROM "PremiumMembershipInvoice"` → `0` (Apple/RC path
    always sets devFeePercent = 0 per canon §F8.1).
  - `Garage.premiumTier = 'gold'`.
- Ticket backfill runs as in step 3.

**Step 8 — RevenueCat sandbox: expiration triggers reconciliation**

Sandbox subscriptions renew at accelerated cadence (~5 minutes for a monthly plan).
Wait for one renewal to confirm the `invoice.renewed` DB row appears. Then:

1. Cancel the subscription via **Settings → Apple ID → Subscriptions** on the iPhone.
2. Expected: `CANCELLATION` RC webhook fires →
   `PremiumMembership.status = 'cancel_scheduled'`.
3. Wait for the sandbox subscription to expire (~5 minutes after cancellation).
4. Expected: `EXPIRATION` RC webhook fires →
   `PremiumMembership.status = 'expired'` → `Garage.premiumTier = null`,
   `Garage.premiumUntil = null`.

If the webhook is delayed: the hourly reconciliation sweep
(`billing-reconcile.ts`) catches the drift. In the smoke environment you can
trigger it manually via the worker cron or a direct API call (if a debug trigger
endpoint is wired for the sweep).

**Step 9 — Non-BR storefront filter check**

Send a synthetic RC event with `country_code != 'BR'` to the preview webhook
endpoint. You can do this with `curl`:

```bash
curl -s -X POST \
  -H "Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH_HEADER>" \
  -H "Content-Type: application/json" \
  https://<preview-api>/webhooks/revenuecat \
  -d '{
    "event": {
      "type": "INITIAL_PURCHASE",
      "id": "test-non-br-01",
      "app_user_id": "garage-smoke-001",
      "country_code": "US",
      "product_id": "com.jdmexperience.app.premium.monthly",
      "currency": "USD",
      "price_in_purchased_currency": 9.99,
      "period_type": "NORMAL"
    }
  }'
```

Expected: `200 OK`. No `PremiumMembership` row created.
Railway API logs contain `premium_rc.non_br_storefront { providerEventId: "test-non-br-01", country_code: "US" }` (canon §F8.9).

**Step 10 — `checkout-precheck` cross-platform dup guard**

With the iOS-subscribed user from step 7 also logged in on a web session:

1. Open `https://<preview-admin>/premium` in the browser.
2. Attempt to start a Stripe checkout (click "Assinar").
3. The client calls `GET /api/me/premium/checkout-precheck` first.

Expected: API returns `409 { error: 'AlreadySubscribed', provider: 'apple_revenuecat', manageUrl: ... }`.
The web UI shows a "Você já tem o Premium Gold ativo" message with a link to manage
via App Store Settings.

**Pass criteria**

All "Expected" results in steps 1–10 must match. Do not flip the production flag
until all 10 steps pass and evidence is attached.

**Evidence to attach**

- Screenshot of admin `/financeiro` with "Membros Ativos" KPI after step 2.
- DB query output for `PremiumMembership` + `Garage` after steps 2, 4, 5, 7.
- Railway log excerpt showing `billing_event.applied` for each provider.
- RC Dashboard screenshot of entitlement `premium_gold` active (step 7).
- Terminal A Stripe CLI output for steps 2–6.
- DB evidence of `PremiumMembershipInvoice.devFeePercent = 0` for RC path (step 7).
- DB evidence of `PremiumMembershipInvoice.status = 'refunded'` after step 6.
- Screenshot of 409 response for the dup-subscribe guard (step 10).

**Production flag flip — deploy ordering**

Only after all 10 steps pass and evidence is attached to the Paperclip F8.19 issue:

1. Railway → Production API service → Variables:
   - Change `GROWTH_PREMIUM_BILLING_ENABLED` from `false` to `true`
   - (or remove the override entirely — the code default is now `true`)
2. Railway auto-redeploys. Verify `/health` returns 200.
3. Verify the Stripe live-mode webhook is registered and delivering.
4. Verify RC production app is pointing at `https://api.jdm-experience.com/webhooks/revenuecat`.
5. Do a single live-mode monthly subscribe on the web as a final sanity check
   (use a real card; refund it immediately via the Billing Portal).

**Common failures**

| Symptom                                                     | Fix                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GROWTH_PREMIUM_BILLING_ENABLED` route returns 503          | Flag is `false` in this env. Set to `true` in Railway Variables and redeploy.                        |
| `invoice.paid` fires but no `PremiumMembership` row appears | Check `STRIPE_BILLING_WEBHOOK_SECRET` matches the Stripe CLI / Dashboard signing secret.             |
| RC webhook returns 401                                      | `REVENUECAT_WEBHOOK_AUTH_HEADER` in Railway does not match the token set in RC Dashboard.            |
| Backfill tickets not appearing (step 3)                     | Check the background worker is enabled (`WORKER_ENABLED=true`) and the job queue is running.         |
| XP not awarded after activation                             | Verify `sourceRef = 'garage:<garageId>'` in the XpEvent row. Prior admin grant may have consumed it. |
| Reconciliation not catching RC expiry                       | Check `REVENUECAT_REST_API_KEY` is set and has read-only access to the correct RC project.           |

## 4. Roles

### Engineer (implementor)

- Authors the "Manual smoke test" section in the PR.
- Self-runs it once before requesting QA. Fixes anything obviously broken.
- Hands the smoke to QA via Paperclip (assign issue to QA, status
  `in_review`, comment with PR link + smoke section).

### QA agent

- Runs the smoke cold. Does not improvise. If a step is ambiguous, asks
  the engineer to fix the smoke, not the engineer to clarify privately.
- Captures evidence (screenshots, log excerpts, DB queries) per the
  smoke's "Evidence to attach" list.
- Posts a single QA verdict comment with:
  - **Status:** `Pass` or `Fail` (no `Pass with caveats` — caveats are
    `Fail` with a clear list).
  - **Steps run:** numbered, with actual observed result next to expected.
  - **Evidence:** linked attachments.
  - **Findings (if `Fail`):** repro steps, severity (`blocker`,
    `major`, `minor`, `nit`).
- On `Fail`, reassigns the issue back to the engineer with concrete repro.
- On `Pass`, reassigns to the CTO for merge.

QA does **not** approve PRs. QA verifies behavior; the CTO (or peer
reviewer) approves the merge.

### CTO

- Owns the playbook library quality.
- Reviews smoke quality during code review — a vague smoke is a `blocking:`
  comment on the PR.
- Until QA is hired, runs smokes as part of the review (or hands to the
  CEO on user-facing changes for spot-checking).

## 5. Test data and accounts

- **Stripe:** test mode keys, card `4242 4242 4242 4242`, decline
  `4000 0000 0000 9995`. Webhook via `stripe listen --forward-to`.
- **AbacatePay:** sandbox keys.
  - Simulate Pix approval in dev mode with the checkout transparent id in
    the query string (not in JSON body):

    ```bash
    curl --request POST \
      --url "https://api.abacatepay.com/v2/transparents/simulate-payment?id=<pix_transparent_id>" \
      --header "Authorization: Bearer <ABACATEPAY_DEV_API_KEY>" \
      --header "Content-Type: application/json" \
      --data '{"metadata": {}}'
    ```

  - Use the same dev API key that created the charge and pass the provider
    id returned by `POST /v2/transparents/create` (for JDM this is
    `Order.providerRef`).

- **Test users:** seed at least one verified attendee, one organizer, one
  admin in `pnpm --filter @ccc/db db:seed`. Use throwaway email aliases
  per smoke (e.g. `qa+stripe-2026-04-29@jdm.example`).
- **Real devices:** keep one iOS + one Android dev build registered in
  EAS. Push smokes do not work on simulators reliably.
- **Production data:** never. Smokes always run against staging / preview
  / local. No exceptions.

## 6. Regression checklist (run before any v-release)

Before flipping a release version (v0.1 → TestFlight, v0.2 → public,
v0.3+):

- [ ] Signup → email verify → login on a fresh user.
- [ ] Browse events list, filter by city, open detail.
- [ ] Buy ticket via Stripe (card). QR renders.
- [ ] Buy ticket via Pix (from v0.2). QR + copy-paste, status flips on
      paid webhook.
- [ ] Receive "Ingresso confirmado" push within seconds.
- [ ] Receive T-24h reminder (when staged with a near-future event).
- [ ] Admin (organizer role) creates + publishes an event; tier counts
      respect direct-sale cap.
- [ ] Admin scans valid ticket — admit. Scans the same ticket again —
      reject (already used).
- [ ] (v0.3+) Subscribe to Premium → My Tickets backfilled.
- [ ] (v0.3+) Cancel Premium at period end → existing tickets remain.
- [ ] Finance dashboard (`/financeiro`): staff blocked, admin/organizer
      see KPIs. Filters reflect in URL. CSV export matches on-screen totals.
- [ ] LGPD: `POST /me/export` returns a download link; `POST /me/delete`
      schedules purge; verify purge job at T+30 days in staging.
- [ ] No Sentry errors during the regression run.

A failed regression item blocks the release until fixed. Do not "ship and
fix forward" on a regression for v0.1 / v0.2 / v0.3 — those are the
load-bearing releases.

## 7. Bug-bash before each store submission

Before TestFlight or Play submission:

- 30-minute group bug-bash with CEO + CTO + QA on a real device build.
- Each participant logs findings as Paperclip issues with clear repro,
  severity, and a screenshot. Triage immediately after.

## 8. Smoke test failures: severity

- **Blocker:** core flow does not complete (signup, buy, scan, push,
  premium grant). Stops the release.
- **Major:** secondary flow broken or major UX regression. Stops the
  release unless explicitly waived by CEO with a captured follow-up
  issue.
- **Minor:** edge case, cosmetic, slow. Captured as a follow-up issue;
  does not stop the release.
- **Nit:** style preference, copy nitpick. Out of scope unless it's a
  legal/PT-BR copy issue.

QA labels each finding with a severity. The CTO arbitrates ambiguous
calls.

## 9. Until QA is hired

The implementing engineer self-runs the smoke and attaches evidence
(screenshot, terminal capture, DB query output) to the Paperclip issue.
The CTO spot-checks during review. The "Manual smoke test" section in
the PR is still required — it is the contract that QA will execute when
hired, retroactively for any feature still on the bench.

A v0.1 release without a hired QA agent is acceptable for the TestFlight /
internal stage. v0.2 (public launch) should have QA in the loop because
the regression cost grows with the user base.

---

## 10. Accessibility playbook (X.6)

### Prerequisites

- iOS device or simulator with VoiceOver enabled (Settings → Accessibility → VoiceOver), or
- Android device/emulator with TalkBack enabled (Settings → Accessibility → TalkBack).
- App built and running (see §3.1 steps 1–5 for setup).

### Dynamic Type

1. On iOS go to Settings → Accessibility → Display & Text Size → Larger Text. Drag the slider to the largest size.
2. Open the app and walk through every screen listed below.
3. Verify text is not clipped, truncated, or overflowing containers.

Screens to check: Login, Signup, Forgot password, Events list, Event detail, Tickets list, Ticket QR, Profile, Garage list, Garage detail, New car.

### Color Contrast (WCAG AA)

All primary text uses `theme.colors.fg` (#FFFFFF or equivalent dark-mode contrast) against `theme.colors.bg`. Muted text uses `theme.colors.muted`. Confirm both meet 4.5:1 contrast ratio for body text and 3:1 for large text (18pt / 14pt bold).

Tool: use the Accessibility Inspector (Xcode) or Android's Accessibility Scanner to flag any failing pairs.

### VoiceOver / TalkBack — Signup → Buy Ticket → Show QR Flow

Run with a screen reader active. Expected behavior at each step:

**1. Welcome / Login screen**

- VoiceOver reads the title automatically on focus.
- "Esqueci minha senha" and "Ainda não tenho conta" links are announced as "link" with their label text.

**2. Signup screen**

- Each text field announces its label (e.g. "Nome", "E-mail", "Senha (mín. 10 caracteres)") when focused.
- Validation errors are appended to the field label (e.g. "Nome, error: Campo obrigatório").
- Submit button reads "Criar conta".
- "Já tenho conta" reads as a link.

**3. Email verification (verify-email-pending)**

- Screen title and body text are readable.
- Status message (resend confirmation) is announced via live region without requiring manual focus.
- Back-to-login link is announced as a link.

**4. Login screen**

- Email and password fields announce their labels.
- Submit button reads "Entrar".
- Password error on wrong credentials is read from the field label.

**5. Events list**

- Tab bar buttons announce "Upcoming", "Past", "Nearby" (or Portuguese equivalents) with `selected` state.
- Each event card announces the event title and date range; hint says "Opens event details".

**6. Event detail**

- Cover image is skipped (decorative).
- "Abrir no Maps" button is announced as a button with that label.
- Ticket tier rows announce name, price, and `selected`/`disabled` state. Sold-out tiers are announced as disabled.
- Buy button reads "Confirmar compra" or "Processando…".

**7. Tickets list**

- Each ticket card announces event title, tier name, and status (e.g. "válido").
- Hint says "Opens ticket QR code".

**8. Ticket QR screen**

- The QR box announces as an image: "QR code for [event title]".
- Status text (e.g. "válido") is readable below.

**9. Profile screen**

- Avatar button announces "Alterar foto" (or "Enviando foto…" while uploading) with `busy` state.
- All four text fields (name, bio, city, state) announce their labels.
- Save and logout buttons announce their labels.

**10. Garage**

- "Adicionar carro" button is announced.
- Each car card announces make/model/year and optional nickname as a link.
- In car detail: photo thumbnails announce "Car photo" with long-press hint.
- "Adicionar foto" button announces uploading state.
- All form fields (make, model, year, nickname) announce their labels.

**11. Reset password**

- Success confirmation text is announced via live region without requiring manual focus.

### Checklist

- [ ] Dynamic type: all screens legible at max font size.
- [ ] Contrast: all text passes WCAG AA via Accessibility Inspector / Scanner.
- [ ] VoiceOver/TalkBack can complete signup → buy ticket → show QR without visual assistance.
- [ ] All interactive elements have `accessibilityRole`, `accessibilityLabel`, and (where relevant) `accessibilityState`.
- [ ] Decorative images are marked `accessible={false}`.
- [ ] Error states are announced as part of the field label.
- [ ] Loading/busy states are announced via `accessibilityState={{ busy: true }}`.
- [ ] Dynamic status text (reset-password success, verify-email resend result) announced via `accessibilityLiveRegion="polite"`.
