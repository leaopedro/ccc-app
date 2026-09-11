# Rollback — gamification_copy

## Reverter só o código

Seguro sem tocar no banco. Nenhum caminho de API escreve `Badge`, e as colunas
novas de `GeneralSettings` são nuláveis ou têm default, então a versão anterior
da API roda com o schema novo sem alteração.

## Reverter o schema

```sql
ALTER TABLE "Badge" DROP COLUMN "title", DROP COLUMN "description";
ALTER TABLE "GeneralSettings" DROP COLUMN "rankNames", DROP COLUMN "gamificationCopyVersion";
```

Destrutivo: apaga toda copy editada pelo admin. Exportar antes com
`SELECT code, title, description FROM "Badge" ORDER BY code;`.

## Se o `SET NOT NULL` abortar o deploy

O `preDeployCommand` do Railway roda `prisma migrate deploy`. Uma falha deixa a
migration marcada como `failed` em `_prisma_migrations`, e toda release seguinte
re-tenta e re-falha. Para destravar:

1. `prisma migrate resolve --rolled-back <nome_da_migration>` contra prod.
2. Achar a linha culpada: `SELECT code FROM "Badge" WHERE title IS NULL;`
3. Corrigir o backfill e reaplicar.
