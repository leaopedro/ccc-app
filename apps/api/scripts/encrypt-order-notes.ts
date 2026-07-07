import { prisma } from '@jdm/db';

import {
  decryptField,
  encryptField,
  isEncrypted,
} from '../src/services/crypto/field-encryption.js';

const FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY;
if (!FIELD_ENCRYPTION_KEY || FIELD_ENCRYPTION_KEY.length !== 64) {
  console.error('FIELD_ENCRYPTION_KEY must be set (64 hex chars)');
  process.exit(1);
}

const BATCH_SIZE = 100;

async function main() {
  let cursor: string | undefined;
  let encrypted = 0;
  let skipped = 0;
  let backfilled = 0;
  const failed: string[] = [];

  for (;;) {
    const batch = await prisma.order.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: { notes: { not: null } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        notes: true,
        pickupEventId: true,
        pickupTicketId: true,
      },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      // Backfill pickupEventId/pickupTicketId from notes JSON before encryption
      // makes the field opaque. This ensures the DB columns have the data so
      // queries no longer need to parse notes.
      try {
        const plaintext = isEncrypted(row.notes!)
          ? (decryptField(row.notes, FIELD_ENCRYPTION_KEY!) ?? row.notes!)
          : row.notes!;

        if (plaintext) {
          const parsed = JSON.parse(plaintext) as Record<string, unknown>;
          const updates: Record<string, string> = {};
          if (!row.pickupEventId && typeof parsed.pickupEventId === 'string') {
            updates.pickupEventId = parsed.pickupEventId;
          }
          if (!row.pickupTicketId && typeof parsed.pickupTicketId === 'string') {
            updates.pickupTicketId = parsed.pickupTicketId;
          }
          if (Object.keys(updates).length > 0) {
            await prisma.order.update({
              where: { id: row.id },
              data: updates,
            });
            backfilled++;
          }
        }
      } catch {
        // notes not valid JSON - skip backfill, still encrypt
      }

      if (isEncrypted(row.notes!)) {
        const probe = decryptField(row.notes, FIELD_ENCRYPTION_KEY!);
        if (probe !== null) {
          skipped++;
          continue;
        }
        // Encrypted shape but decryption failed: key mismatch or corruption.
        // Fail closed — do NOT re-encrypt, as that would double-encrypt.
        console.error(
          `Row ${row.id}: encrypted format detected but decryption failed (key mismatch or corruption)`,
        );
        failed.push(row.id);
        continue;
      }
      try {
        await prisma.order.update({
          where: { id: row.id },
          data: { notes: encryptField(row.notes!, FIELD_ENCRYPTION_KEY!) },
        });
        encrypted++;
      } catch (err) {
        console.error(`Failed to encrypt row ${row.id}:`, err);
        failed.push(row.id);
      }
    }

    cursor = batch[batch.length - 1]!.id;
    console.log(
      `Processed ${encrypted + skipped + failed.length} rows (${encrypted} encrypted, ${skipped} already encrypted, ${backfilled} backfilled, ${failed.length} failed)`,
    );
  }

  console.log(
    `Done. Encrypted: ${encrypted}, Skipped: ${skipped}, Backfilled: ${backfilled}, Failed: ${failed.length}`,
  );
  if (failed.length > 0) {
    console.error('Failed row IDs:', failed.join(', '));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
