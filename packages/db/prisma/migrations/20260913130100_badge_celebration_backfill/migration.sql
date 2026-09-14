-- Dois backfills, fora do lock de DDL do arquivo anterior.
--
-- 1. Fecha a fila de celebração de todo mundo que já existe. Sem isso, todo
--    usuário com conquistas abre o app depois do deploy e recebe a fila
--    histórica inteira de uma vez.
--
-- 2. Fecha a fila de PUSH, que é o mesmo problema uma tabela adiante e é fácil
--    de esquecer. Toda linha `badge_awarded` já escrita tem sentAt = null de
--    propósito (services/garage/awarder.ts nunca carimbou), e a query do
--    worker não tem piso de createdAt. No primeiro tick depois de
--    `badge_awarded` entrar em DELIVERABLE_KINDS, toda linha histórica do
--    grant manual do admin viraria push de conquista ganha há meses — e o
--    backfill acima acabou de garantir que não haveria animação nenhuma ao
--    abrir o app. Mesmo remédio de 20260816000000_notification_delivery_state.
--
-- O `WHERE ... IS NULL` não é cosmético: torna os dois statements
-- re-executáveis se a migration falhar no meio.

UPDATE "GarageBadge" SET "celebratedAt" = "earnedAt" WHERE "celebratedAt" IS NULL;

UPDATE "Notification" SET "sentAt" = "createdAt"
WHERE "kind" = 'badge_awarded' AND "sentAt" IS NULL;
