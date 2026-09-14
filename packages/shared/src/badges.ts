import { z } from 'zod';

// Wire-format regex for a badge code (3 uppercase letters + dash + 3 digits).
// Source of truth for the catalog codes: EVT-001..EVT-003, CAR-001..CAR-003,
// COM-001..COM-003, CCC-001..CCC-003. Codes travel verbatim over the API and
// are referenced by GarageBadge.badgeCode (FK to Badge.code).
export const BADGE_CODE_RE = /^[A-Z]{3}-\d{3}$/;
export const badgeCodeSchema = z.string().regex(BADGE_CODE_RE);

export const badgeCategorySchema = z.enum(['eventos', 'carros', 'comunidade', 'ccc']);
export type BadgeCategory = z.infer<typeof badgeCategorySchema>;

export const badgeRaritySchema = z.enum(['common', 'rare', 'legendary']);
export type BadgeRarity = z.infer<typeof badgeRaritySchema>;

export const badgeCatalogEntrySchema = z.object({
  code: badgeCodeSchema,
  category: badgeCategorySchema,
  rarity: badgeRaritySchema,
  premiumExclusive: z.boolean(),
  icon: z.string().min(1).max(40),
  // Opcionais no wire mesmo sendo NOT NULL no banco. É o que dá o fallback do
  // bundle: um app novo contra uma API velha não recebe os campos e usa a copy
  // embutida, em vez de estourar no parse. O caminho inverso já era seguro,
  // porque este objeto não é .strict() e app velho descarta chave nova.
  title: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(240).optional(),
  // "Como ganhar". Opcional pelo mesmo motivo dos dois acima, mais um: a
  // coluna tem default vazio, e o serializador omite string vazia em vez de
  // mandar '' pro cliente ter de tratar.
  criteria: z.string().min(1).max(240).optional(),
});
export type BadgeCatalogEntry = z.infer<typeof badgeCatalogEntrySchema>;

// Owner-shape: includes locked + earned + lockedPremium states.
export const garageBadgeOwnerStateSchema = z.union([
  z.object({
    code: badgeCodeSchema,
    state: z.literal('earned'),
    earnedAt: z.string().datetime(),
    pinned: z.boolean(),
    pinnedAt: z.string().datetime().nullable(),
  }),
  z.object({ code: badgeCodeSchema, state: z.literal('locked') }),
  z.object({ code: badgeCodeSchema, state: z.literal('locked_premium') }),
]);
export type GarageBadgeOwnerState = z.infer<typeof garageBadgeOwnerStateSchema>;

// Public-shape: pinned earned only, ordered pinnedAt DESC NULLS LAST upstream.
export const garageBadgePublicSchema = z.object({
  code: badgeCodeSchema,
  earnedAt: z.string().datetime(),
});
export type GarageBadgePublic = z.infer<typeof garageBadgePublicSchema>;

export const garageBadgesPublicPayloadSchema = z.array(garageBadgePublicSchema);
export type GarageBadgesPublicPayload = z.infer<typeof garageBadgesPublicPayloadSchema>;

export const garageBadgesOwnerResponseSchema = z.object({
  enabled: z.boolean(),
  catalog: z.array(badgeCatalogEntrySchema),
  badges: z.array(garageBadgeOwnerStateSchema),
});
export type GarageBadgesOwnerResponse = z.infer<typeof garageBadgesOwnerResponseSchema>;

export const badgeCatalogResponseSchema = z.object({
  enabled: z.boolean(),
  catalog: z.array(badgeCatalogEntrySchema),
});
export type BadgeCatalogResponse = z.infer<typeof badgeCatalogResponseSchema>;

// Fila de celebração. `celebratedAt: null` no banco é a fila; o wire carrega
// só o código e quando foi ganha — título, descrição, raridade e ícone vêm do
// catálogo, que é editável pelo admin. Duplicar copy aqui criaria uma segunda
// fonte que sai de sincronia com /configuracoes/conquistas.
export const CELEBRATION_PAGE_SIZE = 10;

// Janela de skew de versão de app: a API entra antes do app, e um build antigo
// nunca chama o ack. Sem a janela, esse usuário atualiza semanas depois e
// recebe a fila histórica inteira de uma vez.
export const CELEBRATION_WINDOW_DAYS = 7;

export const badgeCelebrationSchema = z.object({
  code: badgeCodeSchema,
  earnedAt: z.string().datetime(),
});
export type BadgeCelebration = z.infer<typeof badgeCelebrationSchema>;

export const badgeCelebrationsResponseSchema = z.object({
  enabled: z.boolean(),
  pending: z.array(badgeCelebrationSchema),
});
export type BadgeCelebrationsResponse = z.infer<typeof badgeCelebrationsResponseSchema>;

export const badgeCelebrationsAckRequestSchema = z.object({
  codes: z.array(badgeCodeSchema).min(1).max(CELEBRATION_PAGE_SIZE),
});
export type BadgeCelebrationsAckRequest = z.infer<typeof badgeCelebrationsAckRequestSchema>;

export const badgeCelebrationsAckResponseSchema = z.object({
  acked: z.number().int().nonnegative(),
});
export type BadgeCelebrationsAckResponse = z.infer<typeof badgeCelebrationsAckResponseSchema>;
