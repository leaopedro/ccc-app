-- DropIndex: remove unique constraint so re-grant after withdrawal creates a new row
-- preserving the full LGPD audit trail (grant → withdraw → re-grant = 3 records)
DROP INDEX "Consent_userId_purpose_version_key";

-- CreateIndex: add covering index for active-consent lookups
CREATE INDEX "Consent_userId_purpose_withdrawnAt_idx" ON "Consent"("userId", "purpose", "withdrawnAt");
