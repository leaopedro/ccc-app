-- Records WHICH Terms of Use text a user accepted, not just that they ticked a
-- box. Nullable: rows created before this column existed genuinely have no
-- recorded acceptance, and pretending otherwise would be worse than null.
ALTER TABLE "User" ADD COLUMN "termsVersion" VARCHAR(40);
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
