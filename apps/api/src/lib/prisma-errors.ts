import { Prisma } from '@prisma/client';

export const isUniqueConstraintError = (err: unknown): boolean => {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2002';
  }
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const candidate = err as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'P2002' ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('Unique constraint failed'))
  );
};

/**
 * Narrow P2002 to a specific field. Prisma surfaces the violated columns in
 * `err.meta.target` (a `string[]` on Postgres). Returns true only when the
 * error is a unique-constraint failure AND the target list includes `field`.
 * Used to distinguish e.g. a Garage.slug race (another user holds the slug)
 * from a Garage.userId race (concurrent ensure on the same user).
 */
export const isUniqueConstraintErrorOn = (err: unknown, field: string): boolean => {
  if (!isUniqueConstraintError(err)) return false;
  const meta = (err as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return false;
  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) {
    return target.some((t) => t === field);
  }
  if (typeof target === 'string') {
    // Some drivers/databases collapse the target to a single string.
    return target === field || target.split(',').includes(field);
  }
  return false;
};
