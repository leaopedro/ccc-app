-- Seed do catálogo de conquistas.
--
-- `pnpm seed` nunca rodou em produção, então a tabela Badge está vazia lá: o
-- app mostra 0/0 e o awarder não tem FK para gravar. Este INSERT é o único
-- caminho pelo qual o catálogo chega a qualquer ambiente sem ação manual.
--
-- ON CONFLICT DO UPDATE ... WHERE criteria = '': re-rodar não duplica nem
-- sobrescreve copy editada pelo admin, e preenche o critério de linhas antigas
-- que ficaram no default vazio da migration anterior.
--
-- Ids literais e não cuid(): o default de Badge.id é gerado pelo Prisma, não
-- pelo banco, e um id fixo mantém a migration determinística.
--
-- UM statement só. O teste de integração executa este arquivo inteiro via
-- $executeRawUnsafe, que usa o protocolo estendido do Postgres e recusa
-- múltiplos statements.
INSERT INTO "Badge" ("id", "code", "title", "description", "criteria", "category", "rarity", "premiumExclusive", "icon")
VALUES
  ('badge_seed_evt001', 'EVT-001', 'Primeira Largada',
   'Seu primeiro check-in confirmado em um encontro CCC.',
   'Faça check-in em qualquer evento.',
   'eventos'::"BadgeCategory", 'common'::"BadgeRarity", false, 'flag'),
  ('badge_seed_evt002', 'EVT-002', 'Sequência de Três',
   'Três eventos consecutivos sem perder nenhum.',
   'Faça check-in nos três últimos eventos para os quais você tem ingresso, sem faltar a nenhum.',
   'eventos'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'streak'),
  ('badge_seed_evt003', 'EVT-003', 'Veterano de Pista',
   'Dez eventos CCC na sua trajetória.',
   'Faça check-in em 10 eventos diferentes.',
   'eventos'::"BadgeCategory", 'legendary'::"BadgeRarity", false, 'medal'),
  ('badge_seed_evt004', 'EVT-004', 'Maratona',
   'Três encontros em trinta dias.',
   'Faça check-in em 3 eventos diferentes num intervalo de 30 dias.',
   'eventos'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'calendar'),
  ('badge_seed_evt005', 'EVT-005', 'Fiel de Carteirinha',
   'Vinte e cinco encontros CCC no seu histórico.',
   'Faça check-in em 25 eventos diferentes.',
   'eventos'::"BadgeCategory", 'legendary'::"BadgeRarity", false, 'trophy'),
  ('badge_seed_car001', 'CAR-001', 'Garagem Aberta',
   'O primeiro carro estacionado na sua garagem.',
   'Adicione um carro à sua garagem.',
   'carros'::"BadgeCategory", 'common'::"BadgeRarity", false, 'car'),
  ('badge_seed_car002', 'CAR-002', 'Garagem Cheia',
   'Todas as suas vagas gratuitas ocupadas.',
   'Preencha com carros todas as vagas gratuitas da sua garagem.',
   'carros'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'garageFull'),
  ('badge_seed_car003', 'CAR-003', 'Curador CCC',
   'Cinco carros na coleção da sua garagem.',
   'Tenha 5 carros na garagem ao mesmo tempo.',
   'carros'::"BadgeCategory", 'legendary'::"BadgeRarity", false, 'curator'),
  ('badge_seed_com001', 'COM-001', 'Primeira Postagem',
   'Sua estreia no feed de um evento.',
   'Publique uma postagem no feed.',
   'comunidade'::"BadgeCategory", 'common'::"BadgeRarity", false, 'post'),
  ('badge_seed_com008', 'COM-008', 'Fotógrafo do Rolê',
   'Vinte fotos suas no feed dos encontros.',
   'Publique 20 fotos em postagens do feed.',
   'comunidade'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'camera'),
  ('badge_seed_ccc001', 'CCC-001', 'Curitibano de Coração',
   'Presença confirmada num encontro em Curitiba.',
   'Faça check-in em um evento realizado em Curitiba.',
   'ccc'::"BadgeCategory", 'common'::"BadgeRarity", false, 'pin'),
  ('badge_seed_ccc002', 'CCC-002', 'Drift King',
   'Presença confirmada num evento de drift.',
   'Faça check-in em um evento do tipo drift.',
   'ccc'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'flagCheck'),
  ('badge_seed_ccc003', 'CCC-003', 'Fundador',
   'Você entrou antes de a comunidade decolar.',
   'Ter criado a conta antes de 01/06/2026.',
   'ccc'::"BadgeCategory", 'legendary'::"BadgeRarity", false, 'founder')
ON CONFLICT ("code") DO UPDATE
  SET "criteria" = EXCLUDED."criteria"
  WHERE "Badge"."criteria" = '';
