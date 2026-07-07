-- store_v1
-- Rollback path before deploy: restore the pre-migration database snapshot, then mark
-- this migration rolled back with:
--   pnpm --filter @jdm/db exec prisma migrate resolve --rolled-back 20260507143000_store_v1
-- Enum value removal is not safely reversible in-place on PostgreSQL, so snapshot restore
-- is the only supported rollback for this migration.

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "FulfillmentMethod" AS ENUM ('ship', 'pickup');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM (
    'unfulfilled',
    'packed',
    'shipped',
    'delivered',
    'pickup_ready',
    'picked_up',
    'cancelled'
);

-- CreateEnum
CREATE TYPE "OrderItemKind" AS ENUM ('ticket', 'product', 'extras');

-- Rebuild enums so the new values are safe inside the same transaction/shadow DB run.
ALTER TYPE "CartItemKind" RENAME TO "CartItemKind_old";
CREATE TYPE "CartItemKind" AS ENUM ('ticket', 'extras_only', 'product');
ALTER TABLE "CartItem" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "CartItem"
    ALTER COLUMN "kind" TYPE "CartItemKind"
    USING ("kind"::TEXT::"CartItemKind");
ALTER TABLE "CartItem" ALTER COLUMN "kind" SET DEFAULT 'ticket';
DROP TYPE "CartItemKind_old";

ALTER TYPE "OrderKind" RENAME TO "OrderKind_old";
CREATE TYPE "OrderKind" AS ENUM ('ticket', 'extras_only', 'product', 'mixed');
ALTER TABLE "Order" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "Order"
    ALTER COLUMN "kind" TYPE "OrderKind"
    USING ("kind"::TEXT::"OrderKind");
ALTER TABLE "Order" ALTER COLUMN "kind" SET DEFAULT 'ticket';
DROP TYPE "OrderKind_old";

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "title" VARCHAR(140) NOT NULL,
    "description" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "shippingFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPhoto" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "objectKey" VARCHAR(300) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "sku" VARCHAR(80),
    "priceCents" INTEGER NOT NULL,
    "quantityTotal" INTEGER NOT NULL,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "attributes" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCollection" (
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId","collectionId")
);

-- CreateTable
CREATE TABLE "ShippingAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientName" VARCHAR(140) NOT NULL,
    "line1" VARCHAR(140) NOT NULL,
    "line2" VARCHAR(140),
    "number" VARCHAR(20) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "postalCode" VARCHAR(9) NOT NULL,
    "phone" VARCHAR(20),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL,
    "defaultShippingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "pickupDisplayLabel" VARCHAR(140),
    "supportPhone" VARCHAR(20),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderItemKind" NOT NULL,
    "variantId" TEXT,
    "tierId" TEXT,
    "extraId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CartItem"
    ADD COLUMN "variantId" TEXT,
    ALTER COLUMN "eventId" DROP NOT NULL,
    ALTER COLUMN "tierId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order"
    ADD COLUMN "shippingAddressId" TEXT,
    ADD COLUMN "shippingCents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'unfulfilled',
    ADD COLUMN "fulfillmentMethod" "FulfillmentMethod" NOT NULL DEFAULT 'pickup',
    ADD COLUMN "notes" TEXT,
    ALTER COLUMN "eventId" DROP NOT NULL,
    ALTER COLUMN "tierId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_name_key" ON "ProductType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_status_createdAt_idx" ON "Product"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Product_productTypeId_status_idx" ON "Product"("productTypeId", "status");

-- CreateIndex
CREATE INDEX "ProductPhoto_productId_sortOrder_idx" ON "ProductPhoto"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

-- CreateIndex
CREATE INDEX "Variant_productId_active_idx" ON "Variant"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_key" ON "Collection"("slug");

-- CreateIndex
CREATE INDEX "ProductCollection_collectionId_idx" ON "ProductCollection"("collectionId");

-- CreateIndex
CREATE INDEX "ShippingAddress_userId_idx" ON "ShippingAddress"("userId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "CartItem_variantId_idx" ON "CartItem"("variantId");

-- CreateIndex
CREATE INDEX "Order_fulfillmentStatus_paidAt_idx" ON "Order"("fulfillmentStatus", "paidAt");

-- CreateIndex
CREATE INDEX "Order_shippingAddressId_idx" ON "Order"("shippingAddressId");

-- Add check constraint for the generalized cart line shape.
ALTER TABLE "CartItem"
    ADD CONSTRAINT "CartItem_kind_shape_check"
    CHECK (
        (
            "kind" = 'product'
            AND "variantId" IS NOT NULL
            AND "eventId" IS NULL
            AND "tierId" IS NULL
        )
        OR (
            "kind" IN ('ticket', 'extras_only')
            AND "variantId" IS NULL
            AND "eventId" IS NOT NULL
            AND "tierId" IS NOT NULL
        )
    );

-- One default shipping address per user.
CREATE UNIQUE INDEX "ShippingAddress_default_per_user_idx"
    ON "ShippingAddress"("userId")
    WHERE "isDefault" = true;

-- AddForeignKey
ALTER TABLE "Product"
    ADD CONSTRAINT "Product_productTypeId_fkey"
    FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPhoto"
    ADD CONSTRAINT "ProductPhoto_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant"
    ADD CONSTRAINT "Variant_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollection"
    ADD CONSTRAINT "ProductCollection_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollection"
    ADD CONSTRAINT "ProductCollection_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "Collection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShippingAddress"
    ADD CONSTRAINT "ShippingAddress_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "Variant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "TicketTier"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_extraId_fkey"
    FOREIGN KEY ("extraId") REFERENCES "TicketExtra"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem"
    ADD CONSTRAINT "CartItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "Variant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order"
    ADD CONSTRAINT "Order_shippingAddressId_fkey"
    FOREIGN KEY ("shippingAddressId") REFERENCES "ShippingAddress"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the singleton row so admin settings has a target immediately.
INSERT INTO "StoreSettings" (
    "id",
    "defaultShippingFeeCents",
    "lowStockThreshold",
    "createdAt",
    "updatedAt"
)
VALUES (
    'store_default',
    0,
    5,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;

-- Abort if any ticket order would require fractional unit prices in the backfill.
DO $$
BEGIN
    IF EXISTS (
        WITH "extrasSubtotal" AS (
            SELECT
                oe."orderId",
                SUM(te."priceCents" * oe."quantity")::INTEGER AS "subtotalCents"
            FROM "OrderExtra" oe
            INNER JOIN "TicketExtra" te ON te."id" = oe."extraId"
            GROUP BY oe."orderId"
        )
        SELECT 1
        FROM "Order" o
        LEFT JOIN "extrasSubtotal" es ON es."orderId" = o."id"
        WHERE o."status" IN ('paid', 'refunded')
          AND o."kind" = 'ticket'
          AND (
              o."quantity" <= 0
              OR ((o."amountCents" - COALESCE(es."subtotalCents", 0)) % o."quantity") <> 0
          )
    ) THEN
        RAISE EXCEPTION 'store_v1 backfill aborted: historical OrderItem unitPriceCents is not exactly divisible';
    END IF;
END $$;

-- Backfill extras lines first so historical line-item sums keep matching order totals.
INSERT INTO "OrderItem" (
    "id",
    "orderId",
    "kind",
    "extraId",
    "quantity",
    "unitPriceCents",
    "subtotalCents",
    "createdAt"
)
SELECT
    md5('order-item-extra:' || o."id" || ':' || oe."extraId"),
    o."id",
    'extras'::"OrderItemKind",
    oe."extraId",
    oe."quantity",
    te."priceCents",
    te."priceCents" * oe."quantity",
    o."createdAt"
FROM "Order" o
INNER JOIN "OrderExtra" oe ON oe."orderId" = o."id"
INNER JOIN "TicketExtra" te ON te."id" = oe."extraId"
WHERE o."status" IN ('paid', 'refunded');

-- Backfill one synthetic ticket line for historical ticket orders.
INSERT INTO "OrderItem" (
    "id",
    "orderId",
    "kind",
    "tierId",
    "quantity",
    "unitPriceCents",
    "subtotalCents",
    "createdAt"
)
SELECT
    md5('order-item-ticket:' || o."id"),
    o."id",
    'ticket'::"OrderItemKind",
    o."tierId",
    o."quantity",
    (o."amountCents" - COALESCE(es."subtotalCents", 0)) / o."quantity",
    o."amountCents" - COALESCE(es."subtotalCents", 0),
    o."createdAt"
FROM "Order" o
LEFT JOIN (
    SELECT
        oe."orderId",
        SUM(te."priceCents" * oe."quantity")::INTEGER AS "subtotalCents"
    FROM "OrderExtra" oe
    INNER JOIN "TicketExtra" te ON te."id" = oe."extraId"
    GROUP BY oe."orderId"
) es ON es."orderId" = o."id"
WHERE o."status" IN ('paid', 'refunded')
  AND o."kind" = 'ticket';
