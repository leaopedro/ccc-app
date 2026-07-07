-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('privacy_notice', 'cookies_analytics', 'cookies_marketing', 'push_marketing', 'email_marketing', 'newsletter');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('web_admin', 'web_public', 'mobile', 'email');

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "purpose" "ConsentPurpose" NOT NULL,
    "version" VARCHAR(100) NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "channel" "ConsentChannel" NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "evidence" JSONB NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consent_userId_purpose_idx" ON "Consent"("userId", "purpose");

-- CreateIndex
CREATE INDEX "Consent_purpose_version_idx" ON "Consent"("purpose", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_userId_purpose_version_key" ON "Consent"("userId", "purpose", "version");

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
