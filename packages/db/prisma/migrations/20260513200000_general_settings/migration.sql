-- CreateEnum
CREATE TYPE "CapacityDisplayMode" AS ENUM ('absolute', 'percentage_threshold', 'hidden');

-- CreateTable
CREATE TABLE "GeneralSettings" (
    "id" TEXT NOT NULL,
    "ticketCapacityMode" "CapacityDisplayMode" NOT NULL DEFAULT 'absolute',
    "ticketCapacityThresholdPercent" INTEGER NOT NULL DEFAULT 15,
    "extraCapacityMode" "CapacityDisplayMode" NOT NULL DEFAULT 'absolute',
    "extraCapacityThresholdPercent" INTEGER NOT NULL DEFAULT 15,
    "productCapacityMode" "CapacityDisplayMode" NOT NULL DEFAULT 'absolute',
    "productCapacityThresholdPercent" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneralSettings_pkey" PRIMARY KEY ("id")
);
