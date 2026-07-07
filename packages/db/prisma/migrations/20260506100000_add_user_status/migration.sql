-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('partial', 'active', 'disabled');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active';
