-- CreateEnum
CREATE TYPE "DsrType" AS ENUM ('access', 'deletion', 'rectification', 'portability', 'objection');

-- CreateEnum
CREATE TYPE "DsrStatus" AS ENUM ('pending_identity', 'open', 'in_progress', 'completed', 'denied');

-- CreateEnum
CREATE TYPE "DsrIdentityStatus" AS ENUM ('not_requested', 'requested', 'verified', 'failed');

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DsrType" NOT NULL,
    "status" "DsrStatus" NOT NULL DEFAULT 'pending_identity',
    "identityStatus" "DsrIdentityStatus" NOT NULL DEFAULT 'not_requested',
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "identityProofKey" VARCHAR(300),
    "evidenceKey" VARCHAR(300),
    "resolverId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "denialReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsrAction" (
    "id" TEXT NOT NULL,
    "dsrId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DsrAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataSubjectRequest_userId_idx" ON "DataSubjectRequest"("userId");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_dueDate_idx" ON "DataSubjectRequest"("status", "dueDate");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_dueDate_idx" ON "DataSubjectRequest"("dueDate");

-- CreateIndex
CREATE INDEX "DsrAction_dsrId_createdAt_idx" ON "DsrAction"("dsrId", "createdAt");

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_resolverId_fkey" FOREIGN KEY ("resolverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsrAction" ADD CONSTRAINT "DsrAction_dsrId_fkey" FOREIGN KEY ("dsrId") REFERENCES "DataSubjectRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
