import Link from 'next/link';

import { SearchForm } from './search-form';

import { CreateUserModal } from '~/components/create-user-modal';
import { UserAvatar } from '~/components/user-avatar';
import { UserStatusChip } from '~/components/user-status-chip';
import { searchAdminUsers } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const q = params.q ?? '';
  const cursor = params.cursor;
  const searchOpts: { q?: string; cursor?: string } = {};
  if (q) searchOpts.q = q;
  if (cursor) searchOpts.cursor = cursor;
  const { items, nextCursor } = await searchAdminUsers(searchOpts);

  const nextParams = new URLSearchParams();
  if (q) nextParams.set('q', q);
  if (nextCursor) nextParams.set('cursor', nextCursor);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Usuários</h1>
          <CreateUserModal />
        </div>
        <SearchForm />
      </header>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Nome</th>
            <th>Email</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id} className="border-b border-[color:var(--color-border)]">
              <td className="py-2">
                <Link href={`/users/${u.id}`} className="flex items-center gap-2 hover:underline">
                  <UserAvatar name={u.name} />
                  {u.name}
                </Link>
              </td>
              <td className="text-sm text-[color:var(--color-muted)]">{u.email}</td>
              <td className="text-sm">
                <UserStatusChip status={u.status} />
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={3} className="py-6 text-center text-[color:var(--color-muted)]">
                Nenhum usuário encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/users?${nextParams}`}
            className="rounded border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-border)]"
          >
            Carregar mais
          </Link>
        </div>
      )}
    </section>
  );
}
