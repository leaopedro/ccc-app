import { prisma } from '@ccc/db';
import type { PresaleSettings } from '@prisma/client';

// PresaleSettings nasce sem id fixo (cuid, ver comentário no schema.prisma) —
// diferente de StoreSettings/BoxSettings, que usam upsert por um id
// constante. Duas chamadas concorrentes podem cada uma não achar linha no
// findFirst e criar a sua própria: isso gera uma segunda linha, não um erro
// de unique constraint, então não há como resolver a corrida com
// isUniqueConstraintError como em ensureStoreSettings.
//
// Dado isso, toda leitura usa a MESMA ordenação total e determinística
// (createdAt asc, id asc — ver memória "Nondeterministic row pick"), então
// mesmo que duas linhas existam, todo chamador sempre converge na mesma.
export const ensurePresaleSettings = async (): Promise<PresaleSettings> => {
  const existing = await prisma.presaleSettings.findFirst({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (existing) return existing;
  return prisma.presaleSettings.create({ data: {} });
};
