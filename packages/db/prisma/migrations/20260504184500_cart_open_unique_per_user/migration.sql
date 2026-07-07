-- Enforce one open cart per user at the database level.
-- Prisma does not support partial unique indexes natively.
CREATE UNIQUE INDEX "Cart_userId_open_unique"
  ON "Cart" ("userId")
  WHERE "status" = 'open';
