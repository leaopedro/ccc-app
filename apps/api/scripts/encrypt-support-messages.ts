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
  const failed: string[] = [];

  for (;;) {
    const batch = await prisma.supportTicket.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, message: true },
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      // isEncrypted() checks format only (prefix + hex shape). A plaintext value
      // could match that shape. To be safe, attempt actual decryption: if it
      // succeeds the row is genuinely encrypted; if it fails it is plaintext
      // that happens to look like ciphertext and must be encrypted.
      if (isEncrypted(row.message)) {
        const probe = decryptField(row.message, FIELD_ENCRYPTION_KEY!);
        if (probe !== null) {
          skipped++;
          continue;
        }
        // decryptField returned null => format match but not real ciphertext.
        // Fall through to encrypt it.
      }
      try {
        await prisma.supportTicket.update({
          where: { id: row.id },
          data: { message: encryptField(row.message, FIELD_ENCRYPTION_KEY!) },
        });
        encrypted++;
      } catch (err) {
        console.error(`Failed to encrypt row ${row.id}:`, err);
        failed.push(row.id);
      }
    }

    cursor = batch[batch.length - 1]!.id;
    console.log(
      `Processed ${encrypted + skipped + failed.length} rows (${encrypted} encrypted, ${skipped} already encrypted, ${failed.length} failed)`,
    );
  }

  console.log(`Done. Encrypted: ${encrypted}, Skipped: ${skipped}, Failed: ${failed.length}`);
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
