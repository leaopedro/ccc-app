# Migration Rollback — `Order.livemode` / `PremiumMembershipInvoice.livemode`

Cobre `20260831205831_order_livemode`, que adiciona a coluna booleana de corte
pré-cutover em `Order` e em `PremiumMembershipInvoice`, mais dois índices.

A migração é puramente aditiva e tem default `true`, então aplicá-la não muda
número nenhum no admin. O que muda os números é
`apps/api/src/scripts/mark-pre-cutover-orders.ts`, que roda depois e é
reversível separadamente.

## Por que o default é `true`

Rodar a migração sozinha não pode mudar nenhum número já reportado. Se o
default fosse `false`, toda ordem e fatura já existentes — incluindo receita
real já cobrada antes do cutover — sairiam do relatório de receita no
instante em que a coluna aparecesse, sem nenhum script ter rodado ainda. Isso
é pior que o inverso: com default `true`, o pior caso é dinheiro de teste
contado como receita até alguém rodar o backfill deliberadamente, o que é
reversível e visível (a contagem do script mostra exatamente quanto). Com
default `false`, o pior caso seria dinheiro real desaparecer do relatório
sem nenhuma ação, o que é silencioso e mais fácil de não notar.

## Preflight

```sql
-- Quantas linhas o script já marcou. Se for zero, o rollback é trivial:
-- ninguém consumiu o corte ainda.
SELECT COUNT(*) AS marked_orders FROM "Order" WHERE "livemode" = false;
SELECT COUNT(*) AS marked_invoices FROM "PremiumMembershipInvoice" WHERE "livemode" = false;
```

Se as contagens forem maiores que zero, **anote-as antes de continuar**. Dropar
a coluna apaga o corte, e reconstruí-lo exige rodar o script de novo com
exatamente o mesmo `--created-before`. Registre o instante usado junto das
contagens.

## Desfazer só o backfill, mantendo a coluna

Preferir isto quando o problema for o instante de corte escolhido, não o schema.

```sql
UPDATE "Order" SET "livemode" = true WHERE "livemode" = false;
UPDATE "PremiumMembershipInvoice" SET "livemode" = true WHERE "livemode" = false;
```

Depois rodar o script de novo com o instante correto.

## Rollback da migração

```sql
DROP INDEX IF EXISTS "Order_livemode_status_paidAt_idx";
DROP INDEX IF EXISTS "PremiumMembershipInvoice_livemode_paidAt_idx";

ALTER TABLE "Order" DROP COLUMN IF EXISTS "livemode";
ALTER TABLE "PremiumMembershipInvoice" DROP COLUMN IF EXISTS "livemode";
```

Depois, marcar a migration como revertida (convenção do repo — não usar
`DELETE FROM "_prisma_migrations"` a mão):

```bash
npx prisma migrate resolve --rolled-back 20260831205831_order_livemode
```

Reverter o código junto. A partir da Task 4, `routes/admin/finance.ts` passa a
filtrar por `livemode` e quebra contra um banco sem a coluna.

## Contact

Schema changes: escalate to CTO before any drop in production.
