# Migration Rollback — Cart Redesign Checkout Path

Covers checkout/cart-related schema changes introduced for hosted checkout
settlement compatibility and multi-ticket behavior:

1. `20260503130809_add_order_kind_enum` (`Order.kind`)
2. `20260503163318_multi_ticket_per_order` (`Ticket_orderId_key` -> non-unique idx)
3. `20260503163319_drop_ticket_user_event_unique` (drops partial unique valid-ticket index)

Apply rollback in reverse order. Do not skip preflight checks.

## Preflight safety checks

These checks detect data patterns that violate the old constraints.

```sql
-- 1) extras-only orders were impossible before Order.kind
SELECT COUNT(*) AS extras_only_orders
FROM "Order"
WHERE "kind" = 'extras_only';

-- 2) old model expected at most one ticket per order
SELECT COUNT(*) AS multi_ticket_orders
FROM (
  SELECT "orderId"
  FROM "Ticket"
  WHERE "orderId" IS NOT NULL
  GROUP BY "orderId"
  HAVING COUNT(*) > 1
) t;

-- 3) old model expected one valid ticket per (user,event)
SELECT COUNT(*) AS duplicate_valid_ticket_pairs
FROM (
  SELECT "userId", "eventId"
  FROM "Ticket"
  WHERE "status" = 'valid'
  GROUP BY "userId", "eventId"
  HAVING COUNT(*) > 1
) t;
```

If any count is non-zero, stop and resolve data first (refund/cancel or
normalize rows) before attempting rollback.

## Rollback SQL (reverse apply order)

### Migration 3: `drop_ticket_user_event_unique`

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_userId_eventId_valid_key"
ON "Ticket"("userId", "eventId")
WHERE "status" = 'valid';

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260503163319_drop_ticket_user_event_unique';
```

### Migration 2: `multi_ticket_per_order`

```sql
DROP INDEX IF EXISTS "Ticket_orderId_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_orderId_key"
ON "Ticket"("orderId");

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260503163318_multi_ticket_per_order';
```

### Migration 1: `add_order_kind_enum`

```sql
ALTER TABLE "Order" DROP COLUMN IF EXISTS "kind";
DROP TYPE IF EXISTS "OrderKind";

DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260503130809_add_order_kind_enum';
```

## Post-rollback checks

```sql
-- Should return zero rows
SELECT "userId", "eventId", COUNT(*)
FROM "Ticket"
WHERE "status" = 'valid'
GROUP BY "userId", "eventId"
HAVING COUNT(*) > 1;

SELECT "orderId", COUNT(*)
FROM "Ticket"
WHERE "orderId" IS NOT NULL
GROUP BY "orderId"
HAVING COUNT(*) > 1;
```

- Revert schema/client code in the same deploy (remove `Order.kind` usage,
  restore pre-cart constraints in Prisma).
- Run `pnpm --filter @jdm/db prisma generate`.
- Run focused checkout/webhook smoke before reopening checkout traffic.
