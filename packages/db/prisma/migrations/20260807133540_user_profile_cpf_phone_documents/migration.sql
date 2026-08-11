-- CreateEnum
CREATE TYPE "UserDocumentType" AS ENUM ('cnh', 'rg');

-- CreateEnum
CREATE TYPE "UserDocumentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cpf" VARCHAR(200),
ADD COLUMN     "phone" VARCHAR(20);

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserDocumentType" NOT NULL,
    "objectKey" VARCHAR(500) NOT NULL,
    "status" "UserDocumentStatus" NOT NULL DEFAULT 'pending',
    "rejectionReason" VARCHAR(200),
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "fileDeletedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDocument_userId_sentAt_idx" ON "UserDocument"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "UserDocument_status_sentAt_idx" ON "UserDocument"("status", "sentAt");

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
