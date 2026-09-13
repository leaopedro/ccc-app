import type { Prisma } from '@prisma/client';

export type BadgeCode = string;

/**
 * Conquistas da superfície de FOTO de carro, avaliadas depois que um
 * `CarPhoto` acabou de ser criado. O caller é dono da transação.
 *
 * Codes:
 *   - CAR-004 — "Álbum da Garagem" : count(carros do membro COM pelo menos
 *                                    uma foto) >= 3
 *
 * Conta CARROS retratados, não fotos. Uma foto por carro é o limite que a
 * rota impõe (`car_photo_limit_reached`, mais um unique no banco), então
 * contar fotos daria exatamente o mesmo número por um caminho que mente
 * sobre o que a conquista mede.
 */
export const checkEligibility = async (
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<BadgeCode[]> => {
  const codes: BadgeCode[] = [];

  const photographed = await tx.car.count({
    where: { userId, photos: { some: {} } },
  });
  if (photographed >= 3) codes.push('CAR-004');

  return codes;
};
