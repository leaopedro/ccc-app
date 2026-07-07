-- Enforce at most one active consent per (userId, purpose, version).
-- Withdrawn rows (withdrawnAt IS NOT NULL) are excluded so re-grants
-- after withdrawal create new rows, preserving the LGPD audit trail.
CREATE UNIQUE INDEX "Consent_userId_purpose_version_active_key"
  ON "Consent"("userId", "purpose", "version")
  WHERE "withdrawnAt" IS NULL;
