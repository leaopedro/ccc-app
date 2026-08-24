-- CreateEnum
CREATE TYPE "HomeHighlightKind" AS ENUM ('event', 'day_use', 'experience', 'partner');

-- CreateTable
CREATE TABLE "HomeContent" (
    "id" TEXT NOT NULL,
    "heroTitle" VARCHAR(120) NOT NULL DEFAULT 'DIRIGIR. CONECTAR. PERTENCER.',
    "heroSubtitle" VARCHAR(200),
    "heroBannerObjectKey" VARCHAR(300),
    "institutionalTitle" VARCHAR(120) NOT NULL DEFAULT 'A Casa',
    "institutionalBody" VARCHAR(1000) NOT NULL DEFAULT 'Um clubhouse automotivo privado em Curitiba, feito para quem dirige, conecta e pertence.',
    "institutionalImageObjectKey" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeBenefit" (
    "id" TEXT NOT NULL,
    "icon" VARCHAR(40) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeHighlight" (
    "id" TEXT NOT NULL,
    "kind" "HomeHighlightKind" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "subtitle" VARCHAR(140),
    "imageObjectKey" VARCHAR(300),
    "linkPath" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeBenefit_active_sortOrder_idx" ON "HomeBenefit"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "HomeHighlight_active_sortOrder_idx" ON "HomeHighlight"("active", "sortOrder");

-- AlterTable
ALTER TABLE "PremiumPlan" ADD COLUMN "homeFeatured" BOOLEAN NOT NULL DEFAULT true;
