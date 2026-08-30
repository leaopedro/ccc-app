# Migration Rollback — PremiumSubscriptionAttempt

Cobre `20260829120000_premium_subscription_attempt`, a tabela de tentativa
pre-pagamento da guarda de duplicidade de assinatura (Decisao 4).

Puramente aditiva. Nenhuma coluna existente foi alterada, e
`PremiumMembership` nao foi tocada de proposito.

## Rollback SQL

```sql
DROP INDEX IF EXISTS "PremiumSubscriptionAttempt_garageId_pending_unique";
DROP TABLE IF EXISTS "PremiumSubscriptionAttempt";
DROP TYPE IF EXISTS "PremiumSubscriptionAttemptStatus";

DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260829120000_premium_subscription_attempt';
```

## Safety Notes

- Conferir se ha tentativa em voo antes de derrubar:

  ```sql
  SELECT COUNT(*) FROM "PremiumSubscriptionAttempt" WHERE status = 'pending';
  ```

  Cada linha pendente representa uma `subscriptions.create` que a Stripe pode
  ter aceito. Derrubar a tabela com linhas pendentes remove o unico registro
  local dessas assinaturas incompletas. Conferir cada uma no dashboard da
  Stripe pelo `providerSubRef` antes.

- Nenhuma membership e perdida no rollback. `PremiumMembership` continua sendo
  escrita so pelo webhook `invoice.paid`, que nao depende desta tabela.

- Depois do SQL, reverter o modelo e a back-relation em `Garage` no
  `schema.prisma` e rodar `pnpm --filter @ccc/db db:generate`.

- O endpoint de assinatura nativa **para de funcionar** sem esta tabela. Reverter
  o codigo da rota junto, ou desligar o gate de plataforma para nativo antes.
