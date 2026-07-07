# JDMA-260 — AbacatePay refund API path confirmation

Date: 2026-05-05
Owner: CTO
Scope: Confirm whether AbacatePay exposes a public refund-write API endpoint for F4b manual refund automation.

## Conclusion

There is currently **no public AbacatePay API endpoint documented for creating a refund** (no `POST /.../refund`, no refund operation in `openapi.yaml`, no refund command in CLI docs, no refund method in the official Node SDK).

So for F4b we should treat refunds as:

- **state observed by webhook/polling** (`checkout.refunded`, `transparent.refunded`, `status=REFUNDED`), and
- **refund initiation performed outside our API integration** (AbacatePay dashboard / support workflow).

## Evidence checked (official/public)

1. Docs OpenAPI spec (`documentation/openapi.yaml`)

- Paths include checkouts/transparents/pix/payouts/subscriptions/webhooks.
- No refund creation path is present.

2. Docs index (`https://docs.abacatepay.com/llms.txt`)

- No refund-write page listed.

3. Webhook docs

- `checkout.refunded` and `transparent.refunded` events exist, proving refund status/events are exposed.

4. Auth permission matrix (`pages/authentication.mdx`)

- Lists `CHECKOUT:CREATE`, `CHECKOUT:READ`, `CHECKOUT:DELETE`.
- No documented endpoint maps to refund-write behavior.

5. Official SDK/CLI surface

- `AbacatePay/abacatepay-nodejs-sdk`: no refund method in exported client.
- CLI payments docs cover create/check/simulate only.

## F4b implementation impact

1. Do not block Pix settlement flow on refund automation endpoint discovery.
2. When ticket issuance fails after Pix payment confirmation, mark order for manual refund action and alert ops/admin.
3. Consume `checkout.refunded` / `transparent.refunded` webhook events to reconcile order state to `refunded`.
4. Open a follow-up with AbacatePay support asking for a public refund-write endpoint (or private contract) before implementing API-driven automatic refunds.

## Risk

- Operational overhead remains for manual refunds until AbacatePay publishes a stable refund-write API contract.
