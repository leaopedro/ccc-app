-- AlterEnum (must commit before referencing new values in constraints)
ALTER TYPE "UserStatus" ADD VALUE 'deleted';
ALTER TYPE "UserStatus" ADD VALUE 'anonymized';
