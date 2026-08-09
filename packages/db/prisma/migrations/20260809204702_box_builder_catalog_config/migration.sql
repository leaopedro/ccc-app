-- AlterTable
ALTER TABLE "PremiumPlan" ADD COLUMN     "monthlyBoxBudgetCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BoxCatalogItem" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "category" VARCHAR(60) NOT NULL,
    "imageObjectKey" VARCHAR(300),
    "stockPerCycle" INTEGER,
    "maxPerCycle" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoxCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "logoObjectKey" VARCHAR(300),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerModule" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "priceCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "imageObjectKey" VARCHAR(300),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoxSettings" (
    "id" TEXT NOT NULL,
    "boxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cutoffDaysBeforeRenewal" INTEGER NOT NULL DEFAULT 5,
    "headerTitle" VARCHAR(140),
    "headerSubtitle" VARCHAR(240),
    "freeShippingCepRanges" JSONB NOT NULL DEFAULT '[]',
    "shippingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoxSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoxCatalogItem_slug_key" ON "BoxCatalogItem"("slug");

-- CreateIndex
CREATE INDEX "BoxCatalogItem_active_sortOrder_idx" ON "BoxCatalogItem"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "BoxCatalogItem_category_active_idx" ON "BoxCatalogItem"("category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_slug_key" ON "Partner"("slug");

-- CreateIndex
CREATE INDEX "Partner_active_sortOrder_idx" ON "Partner"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "PartnerModule_partnerId_active_sortOrder_idx" ON "PartnerModule"("partnerId", "active", "sortOrder");

-- AddForeignKey
ALTER TABLE "PartnerModule" ADD CONSTRAINT "PartnerModule_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
