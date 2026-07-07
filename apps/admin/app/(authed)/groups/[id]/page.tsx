import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddGroupMemberModal } from '~/components/add-group-member-modal';
import { EditGroupModal } from '~/components/edit-group-modal';
import { RemoveMemberButton } from '~/components/remove-member-button';
import { getAdminGroup, listGroupMembers } from '~/lib/admin-api';
import { ApiError } from '~/lib/api';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ memberCursor?: string }>;
}) {
  const { id } = await params;
  const { memberCursor } = await searchParams;

  let group;
  try {
    group = await getAdminGroup(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const { items: members, nextCursor } = await listGroupMembers(
    id,
    memberCursor ? { cursor: memberCursor } : undefined,
  );

  const nextParams = new URLSearchParams();
  if (nextCursor) nextParams.set('memberCursor', nextCursor);

  return (
    <section className="flex flex-col gap-6">
      <Link href="/groups" className="text-sm text-[color:var(--color-muted)] hover:underline">
        ← Grupos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded border border-[color:var(--color-border)] p-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{group.name}</h1>
          {group.description && (
            <p className="text-sm text-[color:var(--color-muted)]">{group.description}</p>
          )}
          <span className="text-xs text-[color:var(--color-muted)]">
            {group.memberCount} {group.memberCount === 1 ? 'membro' : 'membros'} · Criado em{' '}
            {fmtDate(group.createdAt)}
          </span>
        </div>
        <EditGroupModal
          groupId={group.id}
          currentName={group.name}
          currentDescription={group.description}
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Membros</h2>
          <AddGroupMemberModal groupId={group.id} />
        </div>

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
              <th className="py-2">Usuário</th>
              <th>Email</th>
              <th>Desde</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-[color:var(--color-border)]">
                <td className="py-2">
                  <Link href={`/users/${m.userId}`} className="hover:underline">
                    {m.userName}
                  </Link>
                </td>
                <td className="text-sm text-[color:var(--color-muted)]">{m.userEmail}</td>
                <td className="text-sm text-[color:var(--color-muted)]">{fmtDate(m.joinedAt)}</td>
                <td className="text-right">
                  <RemoveMemberButton groupId={group.id} userId={m.userId} userName={m.userName} />
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="py-6 text-center text-sm text-[color:var(--color-muted)]"
                >
                  Nenhum membro neste grupo.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {nextCursor && (
          <div className="mt-3 flex justify-center">
            <Link
              href={`/groups/${id}?${nextParams}`}
              className="rounded border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-border)]"
            >
              Carregar mais membros
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
