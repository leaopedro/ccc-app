-- Remove COM-002 e COM-003 do catálogo.
--
-- Nenhuma regra de elegibilidade jamais concedeu esses dois códigos: a
-- superfície de comentários e a de sequência engajada nunca foram
-- implementadas. Com a tela passando a mostrar as conquistas bloqueadas e o
-- que fazer para ganhá-las, uma conquista impossível vira promessa falsa.
--
-- As conquistas de comunidade novas começam em COM-004 justamente para que
-- nenhum código seja reaproveitado com significado diferente.
--
-- O NOT EXISTS protege o deploy: GarageBadge referencia Badge com onDelete
-- Restrict, e um grant manual pelo admin pode ter posto uma dessas linhas na
-- garagem de alguém. Nesse caso a conquista fica no catálogo em vez de
-- derrubar a migration.
DELETE FROM "Badge" b
WHERE b."code" IN ('COM-002', 'COM-003')
  AND NOT EXISTS (SELECT 1 FROM "GarageBadge" gb WHERE gb."badgeCode" = b."code");
