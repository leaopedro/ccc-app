import { EditUserGarageModal } from './edit-user-garage-modal';
import { GrantGaragePremiumModal } from './grant-garage-premium-modal';
import { GrantGarageSpotButton } from './grant-garage-spot-button';
import { RevokeGaragePremiumButton } from './revoke-garage-premium-button';
import { RevokeGarageSpotButton } from './revoke-garage-spot-button';

import { getAdminUserGarage } from '~/lib/admin-garage-api';

interface Props {
  userId: string;
}

const sourceLabel: Record<
  'default_free' | 'purchase' | 'admin_grant' | 'premium_membership',
  string
> = {
  default_free: 'Free',
  purchase: 'Comprada',
  admin_grant: 'Admin grant',
  premium_membership: 'Premium',
};

const tierLabel: Record<'bronze' | 'silver' | 'gold', string> = {
  bronze: 'Bronze',
  silver: 'Prata',
  gold: 'Ouro',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export async function UserGaragePanel({ userId }: Props) {
  const data = await getAdminUserGarage(userId);
  const { garage, spots } = data;

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Garagem</h2>

      <div className="mb-4 rounded border border-[color:var(--color-border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{garage.name}</span>
            <span className="text-xs text-[color:var(--color-muted)]">
              Slug:{' '}
              <code className="rounded bg-[color:var(--color-border)] px-1 py-0.5">
                {garage.slug}
              </code>
            </span>
            {garage.description ? (
              <p className="mt-1 text-xs text-[color:var(--color-muted)]">{garage.description}</p>
            ) : (
              <span className="mt-1 text-xs text-[color:var(--color-muted)]">Sem descrição.</span>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span
                className={
                  garage.isPublic
                    ? 'rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300'
                    : 'rounded bg-[color:var(--color-border)] px-1.5 py-0.5 text-[10px] font-semibold'
                }
              >
                {garage.isPublic ? 'Pública' : 'Privada'}
              </span>
              {garage.isPremiumActive && garage.premiumTier ? (
                <span className="rounded bg-amber-900 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                  Premium {tierLabel[garage.premiumTier]}
                </span>
              ) : null}
              {garage.premiumUntil ? (
                <span className="text-xs text-[color:var(--color-muted)]">
                  até {fmtDate(garage.premiumUntil)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <EditUserGarageModal
              userId={userId}
              current={{
                name: garage.name,
                slug: garage.slug,
                description: garage.description,
                isPublic: garage.isPublic,
              }}
            />
            <div className="flex items-center gap-2">
              <GrantGaragePremiumModal
                userId={userId}
                currentTier={garage.premiumTier}
                currentUntil={garage.premiumUntil}
              />
              {garage.premiumTier ? <RevokeGaragePremiumButton userId={userId} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Vagas</h3>
        <GrantGarageSpotButton userId={userId} />
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
            <th className="py-2">Origem</th>
            <th>Carro</th>
            <th>Criada em</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {spots.map((s) => (
            <tr key={s.id} className="border-b border-[color:var(--color-border)]">
              <td className="py-2 text-sm">{sourceLabel[s.source]}</td>
              <td className="text-sm">
                {s.carId ? (
                  <code className="rounded bg-[color:var(--color-border)] px-1 py-0.5 text-xs">
                    {s.carId}
                  </code>
                ) : (
                  <span className="text-[color:var(--color-muted)]">vazia</span>
                )}
              </td>
              <td className="text-sm">{fmtDate(s.createdAt)}</td>
              <td className="text-right">
                <RevokeGarageSpotButton
                  userId={userId}
                  spotId={s.id}
                  source={s.source}
                  disabled={s.carId !== null}
                />
              </td>
            </tr>
          ))}
          {spots.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-sm text-[color:var(--color-muted)]">
                Nenhuma vaga.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
