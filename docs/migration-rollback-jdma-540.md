# Migration Rollback — JDMA-540 (PickupVoucher)

Migration: `20260513110000_add_pickup_vouchers`

## What the migration adds

- Enum `PickupVoucherStatus` (valid / used / revoked)
- Table `PickupVoucher` with FKs to `Order` (CASCADE), `OrderItem` (CASCADE), `Ticket` (CASCADE), `Event` (RESTRICT), and nullable `Variant` (SET NULL). `usedByUserId` is a plain `TEXT` column with no FK.
- Unique index on `code` (claim lookup)
- Unique index on `(orderItemId, unitIndex)` (idempotent-mint guard)
- Non-unique indexes on `orderId`, `ticketId`, and `(eventId, status)`

## Forward safety

The migration is additive only — no existing column or table is altered. Running it against a live database carries no data loss risk.

## Rollback plan

### Before any data is minted (safe window)

If the PR is reverted before any pickup order is settled with the new code:

```sql
-- Run against the target database:
DROP TABLE "PickupVoucher";
DROP TYPE "PickupVoucherStatus";
```

Then mark the migration rolled back:

```bash
npx prisma migrate resolve --rolled-back 20260513110000_add_pickup_vouchers
```

### After vouchers have been minted

The table contains live state. Rolling back the code without preserving the table causes data loss.

**Step 1:** Pin the API to a prior image before deploying a rollback build.  
**Step 2:** Keep the `PickupVoucher` table intact (do NOT drop it).  
**Step 3:** Deploy the rolled-back API — the old code ignores the table; no runtime error.  
**Step 4:** If the table must be removed later, drain all `valid`/`used` rows to a backup table first, then drop.

### API / mobile compatibility

The new endpoint `POST /admin/store/pickup/voucher/claim` is additive. Rolling back removes it, but no client calls it in production until the mobile release that surfaces the voucher QR cards ships. There is a safe gap to roll back without client impact.

## Contact

Schema changes: escalate to CTO before any drop in production.
