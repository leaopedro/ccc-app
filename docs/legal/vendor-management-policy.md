# Vendor Management and Annual Review Policy

> **Status:** Draft — ready for CTO review under JDMA-662 / LGPD T28.
> **Legal basis:** `L13` — operator governance and instructions must be documented; `L20` — new vendors can create new transfer obligations.
> **Owner of this document:** CTO.
> **Last updated:** 2026-05-14.

This policy defines the minimum vendor-onboarding and recurring-review process
for **JDM Experience**. It exists to keep third-party adoption lightweight,
reviewable, and enforceable before any new SDK, SaaS provider, processor, or
infrastructure dependency lands in production or preview environments.

---

## 1. Scope

This policy applies to any net-new third party that can access company data,
customer data, employee data, production credentials, telemetry, payment
flows, messaging flows, or hosted application traffic.

Examples in scope:

- payment providers and processors
- analytics, CRM, email, SMS, push, and support vendors
- infrastructure, observability, auth, storage, and CDN vendors
- client or server SDKs that send data to an outside service
- contractors or service providers acting as operators/processors

If a tool is in scope and no approved vendor-register row exists, onboarding is
blocked.

---

## 2. Hard onboarding gate

Before any engineer adds a new vendor, SDK, package, API integration, or
service account, the team must complete a vendor-register row in
`docs/legal/vendor-register.md` and obtain the required sign-off in §4.

No merge, deploy, or production credential exchange may proceed when:

- the vendor-register file does not exist
- the proposed vendor has no row
- the row exists but any required field is blank
- the required sign-off has not been recorded

This is a release gate, not a best-effort checklist.

---

## 3. Required vendor-register fields

Each vendor-register row must include, at minimum:

| Field                  | Required content                                                         |
| ---------------------- | ------------------------------------------------------------------------ |
| Vendor name            | Legal or trade name of the vendor                                        |
| Service category       | What the vendor does for JDM Experience                                  |
| Product or SDK in use  | Exact service, SDK, package, or integration surface                      |
| Internal owner         | Named JDM owner responsible for the relationship                         |
| Data involved          | High-level categories of data sent, stored, or accessed                  |
| Transfer role          | Controller, operator/processor, subprocessor, or mixed                   |
| Environments           | Local, preview, production, mobile, admin, API, or shared packages       |
| Access level           | Secrets held, webhook access, database access, user-data access, or none |
| Contract status        | Whether terms, DPA, or other legal terms were reviewed                   |
| Security review status | Whether auth, secrets, webhook, storage, or SDK risks were reviewed      |
| Lawful basis note      | Why the transfer or processing is necessary                              |
| Onboarding date        | Date the vendor was first approved                                       |
| Last review date       | Most recent completed annual or trigger review                           |
| Next review due        | Scheduled review deadline, normally 12 months later                      |
| Exit path              | How the vendor can be removed or replaced                                |
| Notes                  | Material caveats, limitations, or follow-up obligations                  |

If the vendor changes scope later, the existing row must be updated before the
expanded use ships.

---

## 4. Sign-off path

The minimum sign-off path is:

1. Engineering owner completes or updates the vendor-register row.
2. CTO reviews the technical fit, integration surface, and rollback path.
3. CEO or delegated legal owner confirms the contractual and transfer posture
   when the vendor receives personal data, payment data, or other regulated
   information.

For low-risk tools that do not receive customer or employee personal data, CTO
approval is still required and CEO/legal sign-off may be noted as "not
required".

For high-risk vendors, sign-off must happen before:

- production credentials are created
- webhooks are enabled
- customer data is exported or synced
- mobile or web SDKs are bundled into a release

---

## 5. Annual review cadence

Every approved vendor must be reviewed at least once every 12 months.

The review owner is the **CTO**, who may delegate evidence gathering but not
ownership of the final review result. The vendor-register row must be updated
with:

- `Last review date`
- `Next review due`
- any scope changes since the last review
- whether the vendor still satisfies business need, security posture, and data
  minimization expectations
- any required remediation or offboarding follow-up

Outside the annual cycle, a new review is also required when any of these
triggers happen:

- the vendor starts receiving new categories of personal data
- the vendor adds a new SDK, webhook, or integration surface
- a security incident, outage, or material contract change occurs
- the team expands the vendor from one environment or product surface to another
- a regulator, customer, or internal reviewer questions the transfer posture

---

## 6. Engineering enforcement point

Engineering must check this policy and the vendor register during issue
implementation review, before merge, whenever a change introduces:

- a new external dependency or SDK
- a new outbound API integration
- a new webhook consumer or producer
- a new vendor-held secret or service account
- a new transfer of customer, organizer, attendee, or employee data

The expected engineering check lives in two places:

1. The implementation issue comment or PR description must name the matching
   vendor-register row.
2. Reviewer notes must confirm the row is complete and signed off before
   approving the change.

If no matching row exists, the engineer must stop and route the vendor work
through the register plus sign-off flow before continuing.

---

## 7. Lightweight review checklist

The onboarding or annual review does not need a long memo. It must answer these
questions clearly:

- What job is the vendor doing?
- What data or secrets does the vendor touch?
- Why is this vendor needed instead of an existing approved tool?
- What is the rollback or exit path if the tool is removed?
- Does the planned use expand transfer obligations or require legal follow-up?

Short answers in the vendor register are acceptable if they are specific.

---

## 8. Canonical references

- `docs/legal/vendor-register.md` — prerequisite register artifact
- `docs/engineering-workflow.md` — engineering review flow
- `docs/secrets.md` — secret-handling baseline for vendor credentials

---

## 9. Change log

| Date       | Change                                          | Author |
| ---------- | ----------------------------------------------- | ------ |
| 2026-05-14 | Initial draft prepared for JDMA-662 / LGPD T28. | Atlas  |
