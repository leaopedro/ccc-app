-- Rollback: DROP TABLE "UserGroupMembership"; DROP TABLE "UserGroup";
-- Note: Safe to roll back — no data loss beyond the new tables.

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGroupMembership" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserGroup_name_idx" ON "UserGroup"("name");

-- CreateIndex
CREATE INDEX "UserGroupMembership_userId_idx" ON "UserGroupMembership"("userId");

-- CreateIndex
CREATE INDEX "UserGroupMembership_groupId_idx" ON "UserGroupMembership"("groupId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "UserGroupMembership_groupId_userId_key" ON "UserGroupMembership"("groupId", "userId");

-- AddForeignKey
ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
