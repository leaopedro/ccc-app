-- Qual aviso de corte ja saiu para esta caixa: empty | unconfirmed | unpaid.
-- Nulo enquanto nenhum saiu. Ver o comentario do campo em schema.prisma.
ALTER TABLE "MonthlyBox" ADD COLUMN "cutoffRemindedCase" VARCHAR(16);
