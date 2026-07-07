-- AlterTable: add optional nickname to Ticket (per-ticket label for multi-ticket orders)
ALTER TABLE "Ticket" ADD COLUMN "nickname" VARCHAR(60);
