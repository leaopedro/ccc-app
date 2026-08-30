# Migration Rollback — PremiumSubscriptionAttempt

Migration: `20260829120000_premium_subscription_attempt`

Cobre a tabela de tentativa pre-pagamento da guarda de duplicidade de
assinatura (Decisao 4).

## What the migration adds

- Enum `PremiumSubscriptionAttemptStatus` (pending / succeeded / abandoned / failed)
- Table `PremiumSubscriptionAttempt` with an FK to `Garage` (CASCADE)
- Partial unique index `PremiumSubscriptionAttempt_garageId_pending_unique` on
  `("garageId") WHERE status = 'pending'` (raw SQL — Prisma cannot express
  partial unique indexes natively)
- Three plain indexes: `(status, createdAt)`, `(garageId, status)`,
  `(providerSubRef)`

## Forward safety

Puramente aditiva — nenhuma coluna ou tabela existente foi alterada. `PremiumMembership`
nao foi tocada de proposito (ver "Safety Notes" abaixo). Rodar esta migration
contra um banco vivo nao tem risco de perda de dado.

## Rollback plan

### Before any attempt is minted (safe window)

Se o PR for revertido antes de qualquer checkout nativo abrir uma tentativa:

```sql
DROP INDEX IF EXISTS "PremiumSubscriptionAttempt_garageId_pending_unique";
DROP TABLE IF EXISTS "PremiumSubscriptionAttempt";
DROP TYPE IF EXISTS "PremiumSubscriptionAttemptStatus";
```

Depois, marcar a migration como revertida (convencao do repo — nao usar
`DELETE FROM "_prisma_migrations"` a mao):

```bash
npx prisma migrate resolve --rolled-back 20260829120000_premium_subscription_attempt
```

### After attempts have been minted

A tabela contem estado vivo. Derrubar sem preservar perde o unico registro
local de assinaturas Stripe que podem ja ter sido criadas.

**Passo 1:** Conferir tentativas em voo antes de qualquer coisa:

```sql
SELECT COUNT(*) FROM "PremiumSubscriptionAttempt" WHERE status = 'pending';
```

Cada linha pendente representa uma `subscriptions.create` que a Stripe pode
ter aceito. Conferir cada `providerSubRef` no dashboard da Stripe antes de
prosseguir.

**Passo 2:** Fixar a API numa imagem anterior antes de fazer deploy do rollback.
**Passo 3:** Manter a tabela `PremiumSubscriptionAttempt` intacta (NAO dropar).
**Passo 4:** Fazer deploy da API revertida — o codigo antigo ignora a tabela; sem erro em runtime.
**Passo 5:** Se a tabela precisar ser removida depois, drenar as linhas `pending`/`succeeded` para uma tabela de backup antes de dropar.

## Safety Notes

- Nenhuma membership e perdida no rollback. `PremiumMembership` continua sendo
  escrita so pelo webhook `invoice.paid`, que nao depende desta tabela.

- Depois do SQL, reverter o modelo e a back-relation em `Garage` no
  `schema.prisma` e rodar `pnpm --filter @ccc/db db:generate`.

- O endpoint de assinatura nativa **para de funcionar** sem esta tabela. Reverter
  o codigo da rota junto, ou desligar o gate de plataforma para nativo antes.

- **Dependencia com a Task 11:** um crash entre `subscriptions.create` e a
  troca de status deixa uma linha presa em `pending` para sempre; por causa do
  indice parcial, a garagem correspondente fica IMPOSSIBILITADA de abrir nova
  tentativa ate essa linha sair de `pending`. A Task 11 (TTL reaper) e quem
  limpa essas linhas travadas. Nao fazer deploy das Tasks 8-10 em producao sem
  a Task 11 — sem o reaper, o `pending` travado e permanente para aquela
  garagem.

## Contact

Schema changes: escalate to CTO before any drop in production.
