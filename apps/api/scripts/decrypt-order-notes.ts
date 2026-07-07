import { prisma } from '@jdm/db';

import { decryptField, isEncrypted } from '../src/services/crypto/field-encryption.js';

const FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY;
if (!FIELD_ENCRYPTION_KEY || FIELD_ENCRYPTION_KEY.length !== 64) {
  console.error('FIELD_ENCRYPTION_KEY must be set (64 hex chars)');
  process.exit(1);
}

const BATCH_SIZE = 100;

async function main() {
  let cursor: string | undefined;
  let decrypted = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (;;) {
    const batch = await prisma.order.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: { notes: { not: null } },
      orderBy: { id: 'asc' },
      select: { id: true, notes: true },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      if (!row.notes || !isEncrypted(row.notes)) {
        skipped++;
        continue;
      }
      try {
        // Try actual decryption to confirm this is real ciphertext, not
        // plaintext that happens to match the isEncrypted() format check.
        const plain = decryptField(row.notes, FIELD_ENCRYPTION_KEY!);
        if (plain === null) {
          console.error(
            `Row ${row.id}: encrypted format detected but decryption failed (key mismatch or corruption)`,
          );
          failed.push(row.id);
          continue;
        }
        await prisma.order.update({
          where: { id: row.id },
          data: { notes: plain },
        });
        decrypted++;
      } catch (err) {
        console.error(`Failed to decrypt row ${row.id}:`, err);
        failed.push(row.id);
      }
    }

    cursor = batch[batch.length - 1]!.id;
    console.log(
      `Processed ${decrypted + skipped + failed.length} rows (${decrypted} decrypted, ${skipped} plaintext, ${failed.length} failed)`,
    );
  }

  console.log(`Done. Decrypted: ${decrypted}, Skipped: ${skipped}, Failed: ${failed.length}`);
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
