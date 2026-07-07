import Link from 'next/link';

import { listAdminAuditLogs } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-BR');

// Lightweight metadata summarizer. The audit-row table is intentionally
// generic — surfacing the most relevant field per action keeps badge.*
// rows readable without a per-action renderer. Chunk 18 writes
// `metadata: { badgeCode, sourceRef }` for badge.award; chunk 19 writes
// `metadata: { badgeCode }` for badge.pin/unpin. We treat `null`
// metadata as "no detail" and fall back gracefully.
const summarizeMetadata = (action: string, metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  if (action.startsWith('badge.')) {
    const code = m.badgeCode;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return null;
};

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{
    actorId?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
    cursor?: string;
  }>;
}) {
  const params = await searchParams;

  const auditOpts: Parameters<typeof listAdminAuditLogs>[0] = {};
  if (params.actorId) auditOpts.actorId = params.actorId;
  if (params.action) auditOpts.action = params.action;
  if (params.entityType) auditOpts.entityType = params.entityType;
  if (params.dateFrom) auditOpts.dateFrom = params.dateFrom;
  if (params.dateTo) auditOpts.dateTo = params.dateTo;
  if (params.cursor) auditOpts.cursor = params.cursor;
  const { items, nextCursor } = await listAdminAuditLogs(auditOpts);

  const filterHref = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = {
      actorId: params.actorId,
      action: params.action,
      entityType: params.entityType,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/auditoria${qs ? '?' + qs : ''}`;
  };

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Auditoria</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Registro de ações administrativas.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-[color:var(--color-muted)]">Nenhum registro encontrado.</p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-[color:var(--color-muted)]">
              <th className="py-2 pr-4">Ação</th>
              <th className="pr-4">Entidade</th>
              <th className="pr-4">ID entidade</th>
              <th className="pr-4">Detalhe</th>
              <th className="pr-4">Ator</th>
              <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const detail = summarizeMetadata(r.action, r.metadata);
              return (
                <tr
                  key={r.id}
                  className="border-b border-[color:var(--color-border)] hover:bg-[color:var(--color-surface)]"
                >
                  <td className="py-2 pr-4 font-mono text-xs">{r.action}</td>
                  <td className="pr-4">
                    <Link
                      href={filterHref({ entityType: r.entityType, cursor: undefined })}
                      className="hover:underline"
                    >
                      {r.entityType}
                    </Link>
                  </td>
                  <td className="pr-4 font-mono text-xs text-[color:var(--color-muted)]">
                    {r.entityId}
                  </td>
                  <td className="pr-4 font-mono text-xs">
                    {detail ?? <span className="text-[color:var(--color-muted)]">—</span>}
                  </td>
                  <td className="pr-4 font-mono text-xs text-[color:var(--color-muted)]">
                    {r.actorId}
                  </td>
                  <td className="whitespace-nowrap text-[color:var(--color-muted)]">
                    {fmtDate(r.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {nextCursor && (
        <Link href={filterHref({ cursor: nextCursor })} className="self-start text-sm underline">
          Próxima página
        </Link>
      )}
    </section>
  );
}
