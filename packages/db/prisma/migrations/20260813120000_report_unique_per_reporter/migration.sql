-- One report per reporter per target, enforced in the DB instead of a
-- read-then-write check. NULLs do not collide in a Postgres unique index, so a
-- post report (commentId NULL) never conflicts with another post report, and
-- both indexes coexist on the same table.
CREATE UNIQUE INDEX "Report_reporterUserId_postId_key" ON "Report"("reporterUserId", "postId");
CREATE UNIQUE INDEX "Report_reporterUserId_commentId_key" ON "Report"("reporterUserId", "commentId");
