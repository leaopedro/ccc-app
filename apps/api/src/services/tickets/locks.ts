type TicketLockTx = {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

// Serialize ticket writes per (user,event) across purchase and comp flows.
export const lockTicketTuple = async (
  tx: TicketLockTx,
  userId: string,
  eventId: string,
): Promise<void> => {
  await tx.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
    userId,
    eventId,
  );
};
