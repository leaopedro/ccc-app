# Migration Rollback — Extras Models + requiresCar

Covers two migrations applied together on JDMA-147:

1. `20260502235900_add_extras_models` — TicketExtra/OrderExtra/TicketExtraItem tables + enum
2. `20260502240000_add_tier_requires_car` — `requiresCar` column on `TicketTier`

Both are purely additive; no existing columns altered.

## Rollback SQL (reverse apply order)

### Migration 2: `add_tier_requires_car`

```sql
ALTER TABLE "TicketTier" DROP COLUMN IF EXISTS "requiresCar";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20260502240000_add_tier_requires_car';
```

### Migration 1: `add_extras_models`

```sql
-- Drop dependents first
DROP TABLE IF EXISTS "TicketExtraItem";
DROP TABLE IF EXISTS "OrderExtra";
DROP TABLE IF EXISTS "TicketExtra";

-- Drop enum
DROP TYPE IF EXISTS "TicketExtraItemStatus";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260502235900_add_extras_models';
```

## Safety Notes

- Verify tables are empty before dropping:
  ```sql
  SELECT COUNT(*) FROM "TicketExtraItem";
  SELECT COUNT(*) FROM "OrderExtra";
  SELECT COUNT(*) FROM "TicketExtra";
  ```
- After rollback SQL, revert `schema.prisma` to remove the models + back-relations on `Event`, `Order`, `Ticket`, and remove `requiresCar` from `TicketTier`.
- Run `prisma generate` after schema revert to rebuild the client.
