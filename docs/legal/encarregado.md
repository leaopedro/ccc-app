# Encarregado de Proteção de Dados — Appointment Record

> **Status:** Draft — pending board confirmation (JDMA-641 / LGPD T06).
> **Legal basis:** LGPD Art. 41; ANPD Resolução CD/ANPD nº 18/2024.
> **Owner of this document:** CEO.
> **Last updated:** 2026-05-14.

This document records the formal designation of the _Encarregado pelo Tratamento
de Dados Pessoais_ (Data Protection Officer / DPO) for **JDM Experience** as
required by Brazilian LGPD (Lei nº 13.709/2018) Art. 41 and ANPD Resolução
nº 18/2024 (publication and identification of the Encarregado).

---

## 1. Designation

| Field                               | Value                                                                                                                                                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller (Controlador)            | **JDM Experience** _(legal-entity name and CNPJ to be filled by CEO at signature)_                                                                                                                                                                                          |
| Encarregado (DPO) — primary         | **Pedro Leão**, CEO and founder                                                                                                                                                                                                                                             |
| Modality                            | Interim, in-house. JDM Experience operates as a _agente de tratamento de pequeno porte_ (Lei Complementar 182/2021 + ANPD Res. nº 2/2022, pending formal classification), so a single in-house Encarregado is permitted while the team is below the small-agent thresholds. |
| Effective date                      | Date of signature below (target: within 7 days of LGPD T06 closure).                                                                                                                                                                                                        |
| Term                                | Indefinite until replaced by board resolution or formal external-DPO contract.                                                                                                                                                                                              |
| Compensation/independence statement | Encarregado may escalate any LGPD matter directly to the board without retaliation, may engage outside counsel at company expense for legal review, and is not penalised for advice that conflicts with commercial priorities.                                              |

### Fallback / coverage rule

| Scenario                                                          | Acting Encarregado                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary unavailable < 5 business days (vacation, illness, travel) | **Operations / engineering lead on call** (currently the CTO agent on rotation) routes inbound mail and acknowledges receipt within 2 business days; substantive replies wait for primary or are escalated to external counsel. |
| Primary unavailable ≥ 5 business days                             | Board designates an acting Encarregado by written resolution; ANPD register is updated within 15 days per Res. 18/2024 Art. 6.                                                                                                  |
| Permanent departure                                               | Board appoints a successor by written resolution within 15 days; ANPD register and all published surfaces (footer, privacy notice, signup, settings) are updated in the same release.                                           |
| Major incident (LGPD Art. 48)                                     | Primary plus external counsel co-handle ANPD/titular notifications.                                                                                                                                                             |

External-counsel escalation contact and dedicated outside-DPO contract are
**not yet in place**; engaging counsel is tracked as a separate program item.

---

## 2. Public contact channel

| Channel                 | Value                                                                                                | Notes                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Primary mailbox         | **`privacidade@jdmexperience.com.br`** _(proposed — confirm domain at signature)_                    | Monitored by the Encarregado. Auto-acknowledgement within 2 business days; substantive response within 15 days per LGPD Art. 19 § 1º. |
| Alternate (operational) | `dpo@jdmexperience.com.br` _(alias of the primary mailbox)_                                          | Provided for completeness; both addresses route to the same inbox.                                                                    |
| Postal address          | _(to be filled by CEO at signature — operational address of JDM Experience)_                         | Required by ANPD Res. 18/2024 Art. 4 III when there is no Brazilian establishment, optional otherwise but recommended.                |
| Public web reference    | Privacy notice, mobile signup screen, admin login footer, `/privacidade` page on the marketing site. | Surfaces are wired by downstream LGPD tickets (see §4).                                                                               |

The mailbox must be **operational before this appointment is filed with ANPD**.
Engineering must provision the mailbox and a shared inbox / ticketing rule that
forwards to the Encarregado.

---

## 3. Responsibilities (per LGPD Art. 41 § 2º)

The Encarregado is responsible for, at minimum:

1. Receiving and responding to communications from data subjects (_titulares_),
   including LGPD Art. 18 rights requests (access, correction, anonymisation,
   portability, deletion, information about sharing, revocation of consent,
   review of automated decisions).
2. Receiving communications from the **ANPD** and adopting the actions it
   requests.
3. Guiding employees and contractors on LGPD compliance and data-protection
   best practices.
4. Performing other duties determined by the controller or set in supplementary
   rules — including signing off on Records of Processing (ROPA), reviewing
   DPIA/RIPDs for high-risk processing, and approving DPAs with operators.
5. Coordinating the **breach-notification runbook** (ANPD Res. nº 15/2024)
   within the small-agent doubled timeline (6 business days to ANPD; 6 business
   days to affected titulares unless otherwise determined).

---

## 4. Downstream surfaces that must reference this contact

The following tickets/surfaces must cite the values in §2 verbatim once this
appointment is confirmed and signed:

- **Privacy notice / `política de privacidade`** — published on mobile, admin,
  and the marketing site.
- **Cookie notice / banner** — admin app.
- **Footer of admin app and marketing site** — "Encarregado:" line plus
  mailbox.
- **Mobile signup consent screen** — replace the existing placeholder links
  with the privacy notice that contains this contact.
- **Account-deletion and data-export flows** — confirmation screens cite the
  contact for follow-up.
- **ANPD public register** (Encarregado publication, when ANPD opens the
  centralised registry; until then, publication on the controller's website
  satisfies Art. 41 § 1º per ANPD Res. 18/2024 Art. 5).

Downstream LGPD tickets (T07–T1x in the program backlog) own wiring these
surfaces; this document is the single source of truth for the contact string.

---

## 5. Signature block

This appointment becomes effective on the date the CEO countersigns this
document. The signed version (PDF or e-signature record) is stored in the
company's legal archive and a hash/link is added below.

```
Signed by:    Pedro Leão (CEO and Encarregado)
Date:         __________________________
Signature:    __________________________

Witnessed / acknowledged by board:
              __________________________
Date:         __________________________
```

Evidence of signature (link to PDF, e-signature provider transaction ID, or
git-tracked signed-commit hash) must be appended here once executed.

---

## 6. Change log

| Date       | Change                                            | Author           |
| ---------- | ------------------------------------------------- | ---------------- |
| 2026-05-14 | Initial draft prepared under JDMA-641 (LGPD T06). | CEO (this agent) |
