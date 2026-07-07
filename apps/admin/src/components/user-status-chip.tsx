import type { UserStatusName } from '@jdm/shared/auth';

const COPY: Record<UserStatusName, string> = {
  partial: 'Parcial',
  active: 'Ativo',
  disabled: 'Desabilitado',
  deleted: 'Excluído',
  anonymized: 'Anonimizado',
};

const TONE: Record<UserStatusName, string> = {
  partial: 'bg-yellow-900 text-yellow-200',
  active: 'bg-emerald-900 text-emerald-200',
  disabled: 'bg-red-900 text-red-200',
  deleted: 'bg-zinc-900 text-zinc-400',
  anonymized: 'bg-zinc-900 text-zinc-400',
};

export const UserStatusChip = ({ status }: { status: UserStatusName }) => (
  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TONE[status]}`}>
    {COPY[status]}
  </span>
);
