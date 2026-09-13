-- Adiciona o texto de "como ganhar" ao catalogo de conquistas.
-- DEFAULT '' porque a tabela ja esta populada em ambientes de dev; a migration
-- de seed logo em seguida preenche toda linha que cair no default.
ALTER TABLE "Badge" ADD COLUMN "criteria" VARCHAR(240) NOT NULL DEFAULT '';
