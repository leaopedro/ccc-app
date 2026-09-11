-- Copy editável das conquistas. Passo 1: colunas nuláveis.
ALTER TABLE "Badge" ADD COLUMN "title" VARCHAR(80);
ALTER TABLE "Badge" ADD COLUMN "description" VARCHAR(240);

-- Passo 2: backfill dos 12 códigos do catálogo. Valores verbatim de
-- apps/mobile/src/copy/badges.ts — divergir aqui muda texto em produção
-- sem ninguém ter pedido.
UPDATE "Badge" SET "title" = 'Primeira Largada',  "description" = 'Seu primeiro check-in confirmado em um encontro CCC.'   WHERE "code" = 'EVT-001';
UPDATE "Badge" SET "title" = 'Sequência de Três', "description" = 'Três eventos consecutivos sem perder nenhum.'            WHERE "code" = 'EVT-002';
UPDATE "Badge" SET "title" = 'Veterano de Pista', "description" = 'Dez check-ins confirmados na sua trajetória CCC.'        WHERE "code" = 'EVT-003';
UPDATE "Badge" SET "title" = 'Garagem Aberta',    "description" = 'O primeiro carro estacionado na sua garagem.'            WHERE "code" = 'CAR-001';
UPDATE "Badge" SET "title" = 'Garagem Cheia',     "description" = 'Cinco carros ou mais ocupando suas vagas.'               WHERE "code" = 'CAR-002';
UPDATE "Badge" SET "title" = 'Curador CCC',       "description" = 'Dez carros ou mais na coleção da sua garagem.'           WHERE "code" = 'CAR-003';
UPDATE "Badge" SET "title" = 'Primeira Postagem', "description" = 'Sua estreia no feed de um evento.'                       WHERE "code" = 'COM-001';
UPDATE "Badge" SET "title" = 'Voz da Comunidade', "description" = 'Comentários ativos nas conversas dos encontros.'         WHERE "code" = 'COM-002';
UPDATE "Badge" SET "title" = 'Em Chamas',         "description" = 'Postagens engajadas em sequência na comunidade.'         WHERE "code" = 'COM-003';
UPDATE "Badge" SET "title" = 'Marco Fixado',      "description" = 'Primeiro local fixado no seu mapa CCC.'                  WHERE "code" = 'CCC-001';
UPDATE "Badge" SET "title" = 'Itinerário CCC',    "description" = 'Participação ativa na agenda nacional de eventos.'       WHERE "code" = 'CCC-002';
UPDATE "Badge" SET "title" = 'Fundador',          "description" = 'Você entrou antes de a comunidade decolar.'              WHERE "code" = 'CCC-003';

-- Sweep terminal. Badge.code só tem @unique, e o catálogo já foi reescrito em
-- produção uma vez (20260708000000_rebrand_badge_codes_ccc). Uma linha fora
-- dos 12 acima faria o SET NOT NULL abortar o preDeployCommand do Railway, e
-- Prisma marcaria a migration como failed: toda release seguinte falha até
-- alguém rodar `migrate resolve --rolled-back` contra prod. Fallback é o
-- próprio code, e não string vazia, porque os schemas Zod são min(1).
UPDATE "Badge"
   SET "title"       = COALESCE("title", "code"),
       "description" = COALESCE("description", "code")
 WHERE "title" IS NULL OR "description" IS NULL;

-- Passo 3: constraint.
ALTER TABLE "Badge" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "Badge" ALTER COLUMN "description" SET NOT NULL;

-- Nome de nível editável + token de versão do form de copy.
ALTER TABLE "GeneralSettings" ADD COLUMN "rankNames" JSONB;
ALTER TABLE "GeneralSettings" ADD COLUMN "gamificationCopyVersion" INTEGER NOT NULL DEFAULT 0;
