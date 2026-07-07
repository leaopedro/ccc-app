# Stripe DPA Retrieval Procedure

Tracking record for the Stripe DPA + LATAM addendum download and the
ANPD Anexo II rider attachment under
[JDMA-717](/JDMA/issues/JDMA-717), the CEO-owned follow-up to T09
([JDMA-715](/JDMA/issues/JDMA-715)).

## Context

- Vendor: Stripe (payment processor; card + Apple Pay + recurring
  memberships).
- Posture per vendor register: `GO — verify rider`. Stripe publishes a
  DPA and a LATAM addendum that we must verify against the Q06 priority
  hierarchy (`Resolução ANPD 19/2024 Anexo II` clauses by reference or
  verbatim).
- Evidence target: `docs/legal/vendors/stripe-dpa.pdf` once signed.
- Escalation rule: if Stripe silently retracts the LATAM addendum on
  review, replacement candidates are Adyen and MercadoPago and a
  sourcing issue is opened.

## Retrieval steps

1. Log in to the Stripe Dashboard at
   `https://dashboard.stripe.com` with the JDM Experience owner
   account.
2. Navigate to `Settings → Compliance and documents → Data Processing
Agreement`. (Path may render as `Compliance` only on accounts
   without Connect.)
3. Confirm the current DPA version and the **LATAM addendum** are
   both listed. The LATAM addendum is the Stripe instrument that
   incorporates ANPD-compatible language for Brazilian controllers.
4. Click the dashboard's `Sign DPA` flow:
   - Counterparty: legal name of the JDM Experience controlling entity
     (confirm exact name and CNPJ before signing).
   - Signatory: Pedro Leão, CEO / founder.
   - Effective date: signature date.
5. Download the signed PDF Stripe issues at the end of the flow.
6. Attach a separate page or rider that incorporates the ANPD Anexo II
   clauses verbatim if and only if the Stripe LATAM addendum does
   **not** already reference or reproduce equivalent clauses. The Q06
   priority hierarchy in `docs/legal/vendor-register.md` requires
   verbatim Anexo II clauses unless the vendor's own DPA passes a
   clause-by-clause review.
7. File the signed PDF at `docs/legal/vendors/stripe-dpa.pdf` (via
   git-lfs once provisioned) and update the vendor-register row's
   `Contract status` from `Pending DPA/SCC ...` to a dated signature
   reference.

## Anexo II rider gate

The CEO must complete a clause-by-clause review of the Stripe LATAM
addendum before deciding to skip the verbatim Anexo II rider. The
review compares the LATAM addendum against the Anexo II text and
records, per clause, whether the addendum incorporates equivalent
language. If any clause fails the review, the verbatim rider is
mandatory.

The review record is filed alongside the signed PDF as
`docs/legal/vendors/stripe-anexo-ii-review.md` (text-only) when the
DPA lands.

## Tracking

| Field                   | Value                                                    |
| ----------------------- | -------------------------------------------------------- |
| Procedure drafted       | 2026-05-15                                               |
| Dashboard retrieval     | Pending human-board login + sign flow                    |
| Anexo II clause review  | Pending; runs against the retrieved LATAM addendum       |
| Signed DPA filed        | Pending; target path `docs/legal/vendors/stripe-dpa.pdf` |
| Anexo II rider attached | Pending; only if review fails                            |
| Register row updated    | Yes — `Outreach status` column reflects retrieval state  |

## Owner

- Drafting + register update: CEO agent (this branch).
- Dashboard sign-in, signature, clause-by-clause review, and PDF
  filing: human board (Pedro Leão), since the agent has no Stripe
  Dashboard credential and cannot bind the company on signature.

## Next action

Human board must perform the dashboard retrieval steps above, run the
Anexo II clause review, and either file the signed PDF at the target
path directly or open a follow-up worktree to do so.
