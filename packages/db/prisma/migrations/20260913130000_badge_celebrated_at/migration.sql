-- DDL apenas, de propósito. ADD COLUMN pega ACCESS EXCLUSIVE e segura até o
-- commit; o Prisma roda o arquivo inteiro numa transação. Um UPDATE de tabela
-- inteira aqui faria a reescrita toda dentro do lock, e check-in e
-- POST /me/cars (Serializable, timeout 15s, 3 tentativas) bloqueariam na fila
-- de lock até estourar. Coluna anulável sem default é metadata-only no PG 11+,
-- então este lock é instantâneo. Os backfills vivem na migration seguinte.

-- AlterTable
ALTER TABLE "GarageBadge" ADD COLUMN     "celebratedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GarageBadge_garageId_celebratedAt_idx" ON "GarageBadge"("garageId", "celebratedAt");
