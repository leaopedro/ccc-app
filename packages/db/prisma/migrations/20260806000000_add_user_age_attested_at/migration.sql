-- 18+ self-attestation captured at signup. Stores only the fact/timestamp of
-- acceptance, never a date of birth (privacy policy: no DOB collected).
ALTER TABLE "User" ADD COLUMN     "ageAttestedAt" TIMESTAMP(3);
