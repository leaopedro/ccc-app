-- CreateTable
CREATE TABLE "DeletionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "steps" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,

    CONSTRAINT "DeletionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeletionLog_userId_key" ON "DeletionLog"("userId");

-- CreateIndex
CREATE INDEX "DeletionLog_completedAt_idx" ON "DeletionLog"("completedAt");

-- CreateIndex
CREATE INDEX "DeletionLog_requestedAt_idx" ON "DeletionLog"("requestedAt");

-- AddForeignKey
ALTER TABLE "DeletionLog" ADD CONSTRAINT "DeletionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
