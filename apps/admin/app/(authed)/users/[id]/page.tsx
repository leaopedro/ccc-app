import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddUserToGroupModal } from '~/components/add-user-to-group-modal';
import { AdminUserDocumentsPanel } from '~/components/admin-user-documents-panel';
import { AdminXpAdjustmentTrigger } from '~/components/admin-xp-adjustment-trigger';
import { GarageBadgesPanel } from '~/components/garage-badges-panel';
import { GarageMembershipHistory } from '~/components/garage-membership-history';
import { GrantTicketModal } from '~/components/grant-ticket-modal';
import { RemoveMemberButton } from '~/components/remove-member-button';
import { UserAvatar } from '~/components/user-avatar';
import { UserGaragePanel } from '~/components/user-garage-panel';
import { UserStatusActions } from '~/components/user-status-actions';
import { UserStatusChip } from '~/components/user-status-chip';
import { getAdminUser, getMe, listAdminEvents, listAdminGroups } from '~/lib/admin-api';
import { getAdminUserGarage } from '~/lib/admin-garage-api';
import { ApiError } from '~/lib/api';
import { fetchBadgeCatalog, fetchPublicGarage } from '~/lib/public-garage';

export const dynamic = 'force-dynamic';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const fmtCurrency = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

const fmtCpf = (cpf: string) => {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const fmtPhone = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
};

// Three-way rendering, load-bearing per the product decision: `hasX` tells
// us whether the member ever filled the field; `x === null` on top of
// `hasX === true` means it exists but this viewer's role cannot see it
// (only `admin` gets the full value from the API). Never collapse the
// second case into "Não informado" — that would misreport an organizer's
// view as if the member had never filled it.
const fmtOptionalPii = (has: boolean, value: string | null, format: (v: string) => string) => {
  if (!has) return 'Não informado';
  if (value === null) return 'Cadastrado, visível apenas para admin';
  return format(value);
};

const roleLabelMap: Record<string, string> = {
  user: 'Usuário',
  organizer: 'Organizador',
  admin: 'Admin',
  staff: 'Staff',
};

const ticketStatusLabel: Record<string, string> = {
  valid: 'Válido',
  used: 'Utilizado',
  revoked: 'Revogado',
};

const ticketSourceLabel: Record<string, string> = {
  purchase: 'Compra',
  premium_grant: 'Premium',
  comp: 'Cortesia',
};

const orderStatusLabel: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Reembolsado',
  expired: 'Expirado',
};

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let user;
  try {
    user = await getAdminUser(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const [{ items: events }, me] = await Promise.all([listAdminEvents(), getMe()]);

  let groups: Awaited<ReturnType<typeof listAdminGroups>>['items'] = [];
  try {
    const groupsRes = await listAdminGroups({ limit: 100 });
    groups = groupsRes.items;
  } catch {
    // non-fatal: page still renders, add-to-group action unavailable
  }
  const publishedEvents = events.filter((ev) => ev.status === 'published');
  const memberGroupIds = new Set(user.groups.map((g) => g.id));
  const availableGroups = groups.filter((g) => !memberGroupIds.has(g.id));
  const location = [user.city, user.stateCode].filter(Boolean).join('/');
  const isSelf = me.id === user.id;

  // Conquistas panel data. The badge catalog comes from the public
  // /badges/catalog endpoint (chunk 16) — no auth, killswitch-aware.
  // Earned badges are best-effort: chunk 18 ships only an admin grant
  // route, no admin badge READ. We fall back to the public garage
  // payload's pinned-earned list when the garage is public. Unpinned
  // earned badges therefore show as "not earned" in the indicator, but
  // the awarder still rejects double-grants with `already_earned` and
  // the panel surfaces that error inline.
  let badgeCatalog: Awaited<ReturnType<typeof fetchBadgeCatalog>> = null;
  let earnedCodes: string[] = [];
  let isPremiumActive = false;
  let adminGarage: Awaited<ReturnType<typeof getAdminUserGarage>> | undefined;
  try {
    const [catalog, fetchedGarage] = await Promise.all([
      fetchBadgeCatalog(),
      getAdminUserGarage(user.id),
    ]);
    badgeCatalog = catalog;
    adminGarage = fetchedGarage;
    isPremiumActive = fetchedGarage.garage.isPremiumActive;
    if (fetchedGarage.garage.isPublic) {
      const publicPayload = await fetchPublicGarage(fetchedGarage.garage.slug);
      earnedCodes = publicPayload?.garage.badges.map((b) => b.code) ?? [];
    }
  } catch {
    // non-fatal: panel falls back to empty-catalog state.
  }

  return (
    <section className="flex flex-col gap-6">
      <Link href="/users" className="text-sm text-[color:var(--color-muted)] hover:underline">
        ← Usuários
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {isSelf ? (
          <span className="text-xs text-[color:var(--color-muted)]">
            Você não pode alterar o status da sua própria conta.
          </span>
        ) : (
          <UserStatusActions userId={user.id} initialStatus={user.status} />
        )}
        <div className="flex flex-wrap gap-2">
          <AddUserToGroupModal userId={user.id} groups={availableGroups} />
          <GrantTicketModal userId={user.id} events={publishedEvents} />
          {me.role === 'admin' ? <AdminXpAdjustmentTrigger userId={user.id} /> : null}
        </div>
      </div>

      {/* Header card */}
      <div className="flex items-start gap-4 rounded border border-[color:var(--color-border)] p-4">
        <UserAvatar name={user.name} size="lg" />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{user.name}</h1>
          <span className="flex items-center gap-1 text-sm text-[color:var(--color-muted)]">
            {user.email}
            {user.emailVerifiedAt ? (
              <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                Verificado
              </span>
            ) : (
              <span className="rounded bg-yellow-900 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-300">
                Não verificado
              </span>
            )}
          </span>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded bg-[color:var(--color-border)] px-2 py-0.5 text-xs font-semibold">
              {roleLabelMap[user.role] ?? user.role}
            </span>
            {location && <span className="text-[color:var(--color-muted)]">{location}</span>}
          </div>
          <span className="text-xs text-[color:var(--color-muted)]">
            Membro desde {fmtDate(user.createdAt)}
          </span>
        </div>
      </div>

      {/* Dados da conta (view only, exceto o documento abaixo) */}
      <div className="rounded border border-[color:var(--color-border)] p-4">
        <h2 className="mb-3 text-lg font-semibold">Dados da conta</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">ID</div>
            <div className="text-sm">{user.id}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Email</div>
            <div className="text-sm">{user.email}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Perfil</div>
            <div className="text-sm">{roleLabelMap[user.role] ?? user.role}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Status</div>
            <div className="text-sm">
              <UserStatusChip status={user.status} />
            </div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Email verificado em</div>
            <div className="text-sm">
              {user.emailVerifiedAt ? fmtDate(user.emailVerifiedAt) : 'Não verificado'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Criado em</div>
            <div className="text-sm">{fmtDate(user.createdAt)}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Cidade</div>
            <div className="text-sm">{user.city ?? 'Não informado'}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">UF</div>
            <div className="text-sm">{user.stateCode ?? 'Não informado'}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Avatar</div>
            <div className="text-sm">
              {user.avatarUrl ? (
                <a
                  href={user.avatarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  Ver foto
                </a>
              ) : (
                'Não informado'
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">CPF</div>
            <div className="text-sm">{fmtOptionalPii(user.hasCpf, user.cpf, fmtCpf)}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-muted)]">Telefone</div>
            <div className="text-sm">{fmtOptionalPii(user.hasPhone, user.phone, fmtPhone)}</div>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <div className="text-xs text-[color:var(--color-muted)]">Bio</div>
            {/* `|| ` on purpose, not `??`: bio defaults to an empty string
                (not null) for most accounts, and an empty string must read
                as "not filled in" the same as null does. */}
            <div className="text-sm">{user.bio || 'Não informado'}</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4">
        <div className="rounded border border-[color:var(--color-border)] px-4 py-3 text-center">
          <div className="text-2xl font-bold">{user.stats.totalTickets}</div>
          <div className="text-xs text-[color:var(--color-muted)]">Ingressos</div>
        </div>
        <div className="rounded border border-[color:var(--color-border)] px-4 py-3 text-center">
          <div className="text-2xl font-bold">{user.stats.totalOrders}</div>
          <div className="text-xs text-[color:var(--color-muted)]">Pedidos</div>
        </div>
      </div>

      {/* Recent tickets */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Ingressos recentes</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
              <th className="py-2">Evento</th>
              <th>Status</th>
              <th>Origem</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {user.recentTickets.map((t) => (
              <tr key={t.id} className="border-b border-[color:var(--color-border)]">
                <td className="py-2 text-sm">{t.eventTitle}</td>
                <td className="text-sm">{ticketStatusLabel[t.status] ?? t.status}</td>
                <td className="text-sm">{ticketSourceLabel[t.source] ?? t.source}</td>
                <td className="text-sm">{fmtDate(t.createdAt)}</td>
              </tr>
            ))}
            {user.recentTickets.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="py-4 text-center text-sm text-[color:var(--color-muted)]"
                >
                  Nenhum ingresso.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Recent orders */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Pedidos recentes</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
              <th className="py-2">Evento</th>
              <th>Status</th>
              <th>Valor</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {user.recentOrders.map((o) => (
              <tr key={o.id} className="border-b border-[color:var(--color-border)]">
                <td className="py-2 text-sm">{o.eventTitle}</td>
                <td className="text-sm">{orderStatusLabel[o.status] ?? o.status}</td>
                <td className="text-sm">{fmtCurrency(o.amountCents, o.currency)}</td>
                <td className="text-sm">{fmtDate(o.createdAt)}</td>
              </tr>
            ))}
            {user.recentOrders.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="py-4 text-center text-sm text-[color:var(--color-muted)]"
                >
                  Nenhum pedido.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Garage */}
      <UserGaragePanel userId={user.id} />

      {/* Garage Conquistas (chunk 20) */}
      <GarageBadgesPanel
        userId={user.id}
        catalog={badgeCatalog?.enabled ? badgeCatalog.catalog : []}
        earnedCodes={earnedCodes}
        isPremiumActive={isPremiumActive}
      />

      {/* Membership history (F8.16) */}
      {adminGarage ? <GarageMembershipHistory garageId={adminGarage.garage.id} /> : null}

      {/* Documento de identidade */}
      <AdminUserDocumentsPanel
        userId={user.id}
        documents={user.documents}
        isAdmin={me.role === 'admin'}
      />

      {/* Group memberships */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Grupos</h2>
        {user.groups.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted)]">Nenhum grupo.</p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
                <th className="py-2">Grupo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {user.groups.map((g) => (
                <tr key={g.id} className="border-b border-[color:var(--color-border)]">
                  <td className="py-2 text-sm">{g.name}</td>
                  <td className="py-2 text-right">
                    <RemoveMemberButton groupId={g.id} userId={user.id} userName={user.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
