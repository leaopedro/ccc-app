/**
 * Seleção e serialização de um post do feed.
 *
 * Mora fora de routes/feed.ts porque GET /api/home-feed precisa do MESMO
 * payload, cross-evento. Duplicar POST_SELECT garantiria divergência: o lado
 * esquecido perde isPremiumActive no carro ou a ordenação das fotos, e a
 * diferença só aparece em produção.
 */

import { computeIsPremiumActive } from '../garage/index.js';

export const CAR_SELECT = {
  id: true,
  make: true,
  model: true,
  year: true,
  nickname: true,
  modifications: true,
  // `id` entra por causa do desempate em serializeCarProfile.
  photos: {
    select: { id: true, objectKey: true, width: true, height: true, sortOrder: true },
  },
  // Needed to compute isPremiumActive on the public car profile. The badge
  // tone is per-Garage (one badge per car owner), so we pull premiumTier +
  // premiumUntil and feed them through computeIsPremiumActive at serialize
  // time. Never expose the raw timestamp publicly.
  user: { select: { garage: { select: { premiumTier: true, premiumUntil: true } } } },
} as const;

export const POST_SELECT = {
  id: true,
  eventId: true,
  body: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  authorUserId: true,
  car: { select: CAR_SELECT },
  photos: { select: { id: true, objectKey: true, width: true, height: true, sortOrder: true } },
  _count: {
    select: { reactions: { where: { kind: 'like' } }, comments: { where: { status: 'visible' } } },
  },
} as const;

export type CarSelect = {
  id: string;
  make: string;
  model: string;
  year: number;
  // NOT NULL no schema (schema.prisma:900, VarChar(20) e @@unique). O tipo
  // antigo em routes/feed.ts dizia `string | null`, o que fazia todo call
  // site carregar um fallback morto.
  nickname: string;
  modifications: string[];
  photos: {
    id: string;
    objectKey: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }[];
  user: {
    garage: {
      premiumTier: 'bronze' | 'silver' | 'gold' | null;
      premiumUntil: Date | null;
    } | null;
  } | null;
};

export type FeedPostRow = {
  id: string;
  eventId: string;
  body: string;
  status: 'visible' | 'hidden' | 'removed';
  createdAt: Date;
  updatedAt: Date;
  authorUserId: string | null;
  car: CarSelect | null;
  photos: {
    id: string;
    objectKey: string;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }[];
  _count: { reactions: number; comments: number };
};

export const serializeCarProfile = (car: CarSelect | null, buildUrl: (key: string) => string) => {
  if (!car) return null;
  // Desempate defensivo, não correção de um bug observável: CarPhoto tem
  // @@unique([carId]) (schema.prisma:928), então hoje um carro tem no máximo
  // UMA foto e não existe empate para desfazer. O caso real desta classe de
  // bug é o das fotos do POST, mais abaixo neste arquivo: FeedPostPhoto não
  // tem unique por postId, sortOrder tem @default(0) e sem ORDER BY total a
  // ordem de retorno do Postgres não é garantida. Mantemos o sort aqui para o
  // dia em que o unique cair.
  const primary =
    [...car.photos].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))[0] ??
    null;
  const garage = car.user?.garage ?? null;
  const isPremiumActive =
    garage === null ? false : computeIsPremiumActive(garage.premiumTier, garage.premiumUntil);
  return {
    id: car.id,
    make: car.make,
    model: car.model,
    year: car.year,
    nickname: car.nickname,
    modifications: car.modifications,
    photo: primary
      ? { url: buildUrl(primary.objectKey), width: primary.width, height: primary.height }
      : null,
    isPremiumActive,
  };
};

/**
 * `authorUserId` está em FeedPostRow só porque a query o seleciona, e NUNCA
 * sai no retorno. Ver a nota em feedPostResponseSchema: nenhum identificador
 * novo de usuário pode entrar num payload que leitor anônimo recebe. Por isso
 * `isOwn` é parâmetro, calculado por quem chama.
 */
export const serializeFeedPost = (
  row: FeedPostRow,
  ctx: {
    isOwn: boolean;
    myReactions: Map<string, string>;
    buildUrl: (key: string) => string;
  },
) => ({
  id: row.id,
  eventId: row.eventId,
  isOwn: ctx.isOwn,
  car: serializeCarProfile(row.car, ctx.buildUrl),
  body: row.body,
  status: row.status,
  photos: [...row.photos]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((ph) => ({
      id: ph.id,
      url: ctx.buildUrl(ph.objectKey),
      width: ph.width,
      height: ph.height,
      sortOrder: ph.sortOrder,
    })),
  reactions: { likes: row._count.reactions, mine: ctx.myReactions.get(row.id) === 'like' },
  commentCount: row._count.comments,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
