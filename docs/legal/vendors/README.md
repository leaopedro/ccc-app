# Vendor DPA Evidence Directory

This directory holds executed Data Processing Agreements, ANPD Anexo II
riders, and vendor confirmation artifacts referenced by
`docs/legal/vendor-register.md`.

## Storage rules

- Binary PDFs land at `<vendor>-dpa.pdf` (e.g. `stripe-dpa.pdf`) via
  git-lfs once the LFS path is provisioned. Until then, only tracked-text
  artifacts (outreach drafts, retrieval procedures, confirmation
  transcripts) live here.
- Each tracked-text artifact has a stable filename and is referenced from
  the matching `Evidence path` cell in the vendor register's per-vendor
  disposition table.
- A binary artifact must not be replaced silently. Supersede via a new
  filename (`<vendor>-dpa-vYYYYMMDD.pdf`) and update the register row
  with the new path plus a change-log line.

## Current contents

- `abacatepay-dpa-outreach.md` — outreach email draft for AbacatePay DPA
  signature request (JDMA-717).
- `stripe-dpa-retrieval.md` — retrieval procedure for the Stripe DPA +
  LATAM addendum + ANPD Anexo II rider attachment (JDMA-717).

## Pending binary artifacts

The following PDFs are referenced by the vendor register but have not
yet been filed:

- `stripe-dpa.pdf`
- `abacatepay-dpa.pdf`
- `cloudflare-r2-dpa.pdf`
- `sentry-dpa.pdf`
- `resend-dpa.pdf`
- `expo-dpa.pdf`
- `railway-dpa.pdf`
- `vercel-dpa.pdf`
- `microsoft-dpa.pdf`

The matching `Contract status` cell in the vendor register stays
`Pending` until the artifact lands at the listed path.
