import { PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '@ccc/db';

import type { Env } from '../env.js';

const EXPORT_EXPIRY_DAYS = 7;
const EXPORT_EXPIRY_MS = EXPORT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export type DataExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ExportManifestEntity = {
  entity: string;
  count: number;
};

export type ExportManifest = {
  version: '1.0';
  exportedAt: string;
  userId: string;
  expiresAt: string;
  entities: ExportManifestEntity[];
};

export type ExportBundle = {
  manifest: ExportManifest;
  data: Record<string, unknown[]>;
};

export type ExportJobSummary = {
  id: string;
  status: DataExportJobStatus;
  expiresAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type ExportJobDetail = ExportJobSummary & {
  objectKey: string | null;
  errorMessage: string | null;
};

const collectUserData = async (userId: string): Promise<ExportBundle> => {
  const [
    user,
    garage,
    garageBadges,
    cars,
    tickets,
    orders,
    shippingAddresses,
    supportTickets,
    feedPosts,
    feedComments,
    feedReactions,
    deviceTokens,
    consents,
    notifications,
    xpEvents,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        bio: true,
        city: true,
        stateCode: true,
        pushPrefs: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    // Spec §4.3 + §6.3: include Garage row in DSR export. Exclude id + userId
    // (re-derivable from the user row + 1:1 invariant). Canon §14 (chunk 28):
    // include the XP surface counters (xp, likesReceived) so the DSR export
    // reflects the user's progression state.
    prisma.garage.findUnique({
      where: { userId },
      select: {
        name: true,
        slug: true,
        description: true,
        isPublic: true,
        premiumTier: true,
        premiumUntil: true,
        xp: true,
        likesReceived: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    // Chunk 18 §C17: earned Conquistas badges are user activity — the user
    // has a right to see them in the DSR export. Project the wire-relevant
    // columns (badgeCode + earnedAt + pin state + the awarder's sourceRef);
    // drop the surrogate id + garageId since both are re-derivable.
    prisma.garageBadge.findMany({
      where: { garage: { userId } },
      select: {
        badgeCode: true,
        earnedAt: true,
        pinned: true,
        pinnedAt: true,
        sourceRef: true,
      },
      orderBy: { earnedAt: 'asc' },
    }),
    prisma.car.findMany({
      where: { userId },
      include: { photos: { select: { id: true, objectKey: true, sortOrder: true } } },
    }),
    prisma.ticket.findMany({
      where: { userId },
      select: {
        id: true,
        eventId: true,
        tierId: true,
        carId: true,
        licensePlate: true,
        nickname: true,
        source: true,
        status: true,
        usedAt: true,
        createdAt: true,
      },
    }),
    prisma.order.findMany({
      where: { userId },
      include: {
        orderExtras: { select: { id: true, extraId: true, quantity: true } },
        items: {
          select: {
            id: true,
            kind: true,
            variantId: true,
            tierId: true,
            extraId: true,
            eventId: true,
            quantity: true,
            unitPriceCents: true,
            subtotalCents: true,
          },
        },
      },
    }),
    prisma.shippingAddress.findMany({ where: { userId } }),
    prisma.supportTicket.findMany({
      where: { userId },
      select: {
        id: true,
        phone: true,
        message: true,
        status: true,
        internalStatus: true,
        createdAt: true,
        closedAt: true,
      },
    }),
    prisma.feedPost.findMany({
      where: { authorUserId: userId },
      select: {
        id: true,
        eventId: true,
        carId: true,
        body: true,
        status: true,
        createdAt: true,
        photos: { select: { id: true, objectKey: true, sortOrder: true } },
      },
    }),
    prisma.feedComment.findMany({
      where: { authorUserId: userId },
      select: {
        id: true,
        postId: true,
        carId: true,
        body: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.feedReaction.findMany({
      where: { userId },
      select: { id: true, postId: true, kind: true, createdAt: true },
    }),
    prisma.deviceToken.findMany({
      where: { userId },
      select: {
        id: true,
        expoPushToken: true,
        platform: true,
        lastSeenAt: true,
        createdAt: true,
      },
    }),
    prisma.consent.findMany({
      where: { userId },
      select: {
        id: true,
        purpose: true,
        version: true,
        givenAt: true,
        withdrawnAt: true,
        channel: true,
      },
    }),
    prisma.notification.findMany({
      where: { userId },
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        data: true,
        sentAt: true,
        readAt: true,
        createdAt: true,
      },
    }),
    // Canon §14 (chunk 28): the user's XP ledger rows. Project the wire-
    // relevant columns; drop the surrogate id + garageId (re-derivable from
    // the garage row + 1:1 user-garage invariant).
    prisma.xpEvent.findMany({
      where: { garage: { userId } },
      select: { delta: true, reason: true, sourceRef: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPORT_EXPIRY_MS);

  const data: Record<string, unknown[]> = {
    user: user ? [user] : [],
    garage: garage ? [garage] : [],
    garageBadges,
    cars,
    tickets,
    orders,
    shippingAddresses,
    supportTickets,
    feedPosts,
    feedComments,
    feedReactions,
    deviceTokens,
    consents,
    notifications,
    xpEvents,
  };

  const entities: ExportManifestEntity[] = Object.entries(data).map(([entity, rows]) => ({
    entity,
    count: rows.length,
  }));

  return {
    manifest: {
      version: '1.0',
      exportedAt: now.toISOString(),
      userId,
      expiresAt: expiresAt.toISOString(),
      entities,
    },
    data,
  };
};

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const buildR2Client = (config: R2Config) =>
  new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

const uploadBundle = async (
  client: S3Client,
  bucket: string,
  userId: string,
  jobId: string,
  bundle: ExportBundle,
): Promise<string> => {
  const objectKey = `data-export/${userId}/${jobId}.json`;
  const body = JSON.stringify(bundle, null, 2);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: 'application/json',
      ContentDisposition: `attachment; filename="ccc-data-export-${jobId}.json"`,
    }),
  );

  return objectKey;
};

export const buildSignedDownloadUrl = async (
  config: R2Config,
  objectKey: string,
  maxExpiresIn?: number,
): Promise<string> => {
  const client = buildR2Client(config);
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: objectKey });
  const defaultExpiry = EXPORT_EXPIRY_DAYS * 24 * 60 * 60;
  const expiresIn =
    maxExpiresIn !== undefined ? Math.min(defaultExpiry, Math.max(1, maxExpiresIn)) : defaultExpiry;
  return getSignedUrl(client, command, { expiresIn });
};

export const getR2ConfigFromEnv = (env: Env): R2Config | null => {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    return null;
  }
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
  };
};

export type ProcessExportResult = 'completed' | 'failed' | 'skipped';

export const processExportJob = async (jobId: string, env: Env): Promise<ProcessExportResult> => {
  // Atomic claim: only one worker can transition pending->processing
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const { count } = (await (prisma as any).dataExportJob.updateMany({
    where: { id: jobId, status: 'pending' },
    data: { status: 'processing', startedAt: new Date() },
  })) as { count: number };
  if (count === 0) return 'skipped';

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const job = (await (prisma as any).dataExportJob.findUnique({ where: { id: jobId } })) as {
    id: string;
    userId: string;
    status: DataExportJobStatus;
  } | null;
  if (!job) return 'skipped';

  try {
    const bundle = await collectUserData(job.userId);
    const r2Config = getR2ConfigFromEnv(env);

    let objectKey: string;
    if (r2Config) {
      const client = buildR2Client(r2Config);
      objectKey = await uploadBundle(client, r2Config.bucket, job.userId, jobId, bundle);
    } else {
      objectKey = `data-export/${job.userId}/${jobId}.json`;
    }

    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_MS);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    await (prisma as any).dataExportJob.update({
      where: { id: jobId },
      data: { status: 'completed', objectKey, expiresAt, completedAt: new Date() },
    });
    return 'completed';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    await (prisma as any).dataExportJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: message.slice(0, 500),
        completedAt: new Date(),
      },
    });
    return 'failed';
  }
};

export const createExportJob = async (
  userId: string,
): Promise<{ id: string; status: DataExportJobStatus }> => {
  const MAX_RETRIES = 5;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
          const recent = (await (tx as any).dataExportJob.findFirst({
            where: {
              userId,
              status: { in: ['pending', 'processing'] },
            },
            orderBy: { createdAt: 'desc' },
          })) as { id: string; status: DataExportJobStatus } | null;
          if (recent) return { id: recent.id, status: recent.status };

          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
          const job = (await (tx as any).dataExportJob.create({
            data: { userId },
          })) as { id: string; status: DataExportJobStatus };
          return { id: job.id, status: job.status };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      // Postgres serialization failure under Serializable isolation surfaces as
      // Prisma P2034 ("write conflict or a deadlock"). Match on the code first,
      // falling back to the message for older client versions.
      const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
      const isSerializationError =
        code === 'P2034' || (err instanceof Error && err.message.includes('write conflict'));
      if (!isSerializationError || attempt >= MAX_RETRIES) throw err;
      // Small incremental backoff: let the winning transaction commit and avoid
      // an immediate retry stampede between the losing concurrent transactions.
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
};

export const getExportJob = async (
  jobId: string,
  userId: string,
): Promise<ExportJobDetail | null> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const row = (await (prisma as any).dataExportJob.findFirst({
    where: { id: jobId, userId },
    select: {
      id: true,
      status: true,
      objectKey: true,
      expiresAt: true,
      createdAt: true,
      completedAt: true,
      errorMessage: true,
    },
  })) as ExportJobDetail | null;
  return row;
};

export const listExportJobs = async (userId: string): Promise<ExportJobSummary[]> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  const rows = (await (prisma as any).dataExportJob.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      completedAt: true,
    },
  })) as ExportJobSummary[];
  return rows;
};

export { collectUserData as _collectUserDataForTest };
