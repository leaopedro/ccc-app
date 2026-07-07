import type { AdminStoreProductStatus } from '@jdm/shared/admin';

const COPY: Record<AdminStoreProductStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  archived: 'Arquivado',
};

const TONE: Record<AdminStoreProductStatus, string> = {
  draft: 'bg-neutral-700 text-neutral-100',
  active: 'bg-emerald-700 text-emerald-50',
  archived: 'bg-amber-800 text-amber-50',
};

export const ProductStatusBadge = ({ status }: { status: AdminStoreProductStatus }) => (
  <span className={`rounded px-2 py-0.5 text-xs ${TONE[status]}`}>{COPY[status]}</span>
);
