import Link from 'next/link';

import { CreateGroupModal } from '~/components/create-group-modal';
import { listAdminGroups } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const params = await searchParams;
  const cursor = params.cursor;
  const { items, nextCursor } = await listAdminGroups(cursor ? { cursor } : undefined);

  const nextParams = new URLSearchParams();
  if (nextCursor) nextParams.set('cursor', nextCursor);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Grupos</h1>
        <CreateGroupModal />
      </header>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Nome</th>
            <th>Membros</th>
            <th>Criado em</th>
          </tr>
        </thead>
        <tbody>
          {items.map((g) => (
            <tr key={g.id} className="border-b border-[color:var(--color-border)]">
              <td className="py-2">
                <Link href={`/groups/${g.id}`} className="hover:underline">
                  {g.name}
                </Link>
                {g.description && (
                  <p className="text-xs text-[color:var(--color-muted)]">{g.description}</p>
                )}
              </td>
              <td className="text-sm">{g.memberCount}</td>
              <td className="text-sm text-[color:var(--color-muted)]">{fmtDate(g.createdAt)}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={3} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhum grupo criado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/groups?${nextParams}`}
            className="rounded border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-border)]"
          >
            Carregar mais
          </Link>
        </div>
      )}
    </section>
  );
}
