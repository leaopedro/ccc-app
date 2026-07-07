-- DropIndex
-- Multi-ticket orders (quantity > 1) require multiple valid tickets per (userId, eventId).
-- Application code retains the conflict check for tickets from different orders/sources.
DROP INDEX "Ticket_userId_eventId_valid_key";
