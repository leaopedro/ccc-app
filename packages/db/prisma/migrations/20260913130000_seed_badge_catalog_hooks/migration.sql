-- Seed das 7 conquistas que dependiam de superfície de hook nova.
--
-- Ficaram de fora da migration anterior de propósito: catálogo antes da regra
-- de elegibilidade é conquista inalcançável, e foi por isso que COM-002 e
-- COM-003 foram removidas. Estas entram junto das suas regras.
--
-- Os códigos de comunidade recomeçam em COM-004. COM-002 e COM-003 não voltam
-- com significado diferente: alguém pode ter recebido um grant manual deles.
--
-- Mesmo contrato da migration de seed anterior: UM statement, ids literais,
-- e ON CONFLICT DO UPDATE só no critério vazio, para re-rodar sem duplicar e
-- sem pisar em copy editada pelo admin.
INSERT INTO "Badge" ("id", "code", "title", "description", "criteria", "category", "rarity", "premiumExclusive", "icon")
VALUES
  ('badge_seed_car004', 'CAR-004', 'Álbum da Garagem',
   'Três carros seus retratados.',
   'Tenha foto em 3 carros diferentes da sua garagem.',
   'carros'::"BadgeCategory", 'common'::"BadgeRarity", false, 'album'),
  ('badge_seed_com004', 'COM-004', 'Bom de Papo',
   'Seu primeiro comentário no feed.',
   'Comente em uma postagem do feed.',
   'comunidade'::"BadgeCategory", 'common'::"BadgeRarity", false, 'chat'),
  ('badge_seed_com005', 'COM-005', 'Voz da Comunidade',
   'Dez comentários seus nas conversas dos encontros.',
   'Publique 10 comentários no feed.',
   'comunidade'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'megaphone'),
  ('badge_seed_com006', 'COM-006', 'Em Chamas',
   'Cinquenta curtidas nas suas postagens.',
   'Receba 50 curtidas nas suas postagens do feed.',
   'comunidade'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'fire'),
  ('badge_seed_com007', 'COM-007', 'Ídolo da Garagem',
   'Duzentas e cinquenta curtidas nas suas postagens.',
   'Receba 250 curtidas nas suas postagens do feed.',
   'comunidade'::"BadgeCategory", 'legendary'::"BadgeRarity", false, 'star'),
  ('badge_seed_ccc004', 'CCC-004', 'Sócio CCC',
   'Assinatura Premium ativa.',
   'Ative uma assinatura Premium.',
   'ccc'::"BadgeCategory", 'rare'::"BadgeRarity", false, 'shield'),
  ('badge_seed_ccc005', 'CCC-005', 'Cliente da Casa',
   'Seu primeiro pedido pago na loja.',
   'Pague um pedido na loja.',
   'ccc'::"BadgeCategory", 'common'::"BadgeRarity", false, 'bag')
ON CONFLICT ("code") DO UPDATE
  SET "criteria" = EXCLUDED."criteria"
  WHERE "Badge"."criteria" = '';
