/**
 * /premium — public pricing page for CCC Gold membership.
 *
 * NOT inside the (authed) route group so unauthenticated visitors can browse.
 *
 * Auth-state to CTA mapping:
 *   - unauthenticated visitor → informational copy ("Assine pelo aplicativo");
 *     admin login rejects member roles and the web subscribe flow is admin-only
 *     in v1. Member-auth on the web is Phase F8.1 work.
 *   - authed + not-premium (organizer/admin/staff) → SubscribeButton triggers
 *     subscribeAction server action.
 *   - authed + already-premium → "Você já é membro" + manage link.
 *
 * Pricing fetched from GET /api/premium/pricing (F8.20, unauthed).
 * Status fetched from GET /api/me/premium/status (F8.11, authed) only when authed.
 * Both endpoints gate on GROWTH_PREMIUM_BILLING_ENABLED — flag-off → 503 → maintenance UI.
 *
 * Gross prices only — no devfee breakdown per canon §F8.1 user-facing rule.
 */

// Next App Router signals navigation by throwing an error with
// `digest: 'NEXT_REDIRECT;...'`. Any try/catch around apiFetch (which
// calls `redirect('/login?reauth=1')` on 401 in lib/api.ts) must rethrow
// that error or the framework never performs the redirect.
function isRedirectError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'digest' in e &&
    typeof (e as { digest: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

import { brand } from '@jdm/design';
import {
  premiumPricingResponseSchema,
  premiumStatusSchema,
  type PremiumPricingResponse,
  type PremiumStatus,
} from '@jdm/shared/premium';
import { garageTokens } from '@jdm/ui/web';

import { SubscribeButton } from './subscribe-button';

import { apiFetch } from '~/lib/api';
import { readRole } from '~/lib/auth-session';

export default async function PremiumPage() {
  const role = await readRole();
  const isAuthed = role !== null;

  // Fetch pricing (always, unauthed) and status (only when authed) in parallel.
  // Pricing failure → maintenance UI. Status failure for authed users degrades
  // to "treat as not-yet-premium" — still show pricing + subscribe CTA. Keeps
  // the page usable when the user is mid-checkout but status is briefly down.
  const [pricing, status] = await Promise.all([
    fetchPricing(),
    isAuthed ? fetchStatus() : Promise.resolve(null),
  ]);

  if (pricing === null) {
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center p-6">
        <p className="text-muted text-sm text-center">
          Assinaturas temporariamente indisponíveis. Tente novamente em breve.
        </p>
      </main>
    );
  }

  const { monthly, annual } = pricing;
  const isAlreadyPremium = status?.active === true;
  const manageUrl = status?.manageUrl ?? '/me/billing';

  return (
    <main className="min-h-screen bg-bg">
      <section
        className="px-6 pt-14 pb-10 text-center relative overflow-hidden"
        style={{
          background: `linear-gradient(180deg, ${garageTokens.brand.deep} 0%, #0b0b0f 100%)`,
        }}
      >
        <h1
          className="font-display text-[52px] leading-none text-fg tracking-tight"
          style={{ textShadow: `0 0 40px ${brand.color.glowBase}` }}
        >
          {brand.premium.productName}
        </h1>
        <p className="mt-3 text-muted text-sm max-w-xs mx-auto">
          Acesso premium ao melhor da comunidade {brand.name}.
        </p>
      </section>

      <section className="px-4 mt-6 flex flex-col gap-4 max-w-sm mx-auto">
        <PricingCard
          cadence="monthly"
          grossAmountCents={monthly.grossAmountCents}
          currency={monthly.currency}
          label="Mensal"
          sublabel="Cancele quando quiser"
          isAuthed={isAuthed}
          isAlreadyPremium={isAlreadyPremium}
          manageUrl={manageUrl}
        />
        <PricingCard
          cadence="annual"
          grossAmountCents={annual.grossAmountCents}
          currency={annual.currency}
          label="Anual"
          sublabel="Melhor custo-benefício"
          isAuthed={isAuthed}
          isAlreadyPremium={isAlreadyPremium}
          manageUrl={manageUrl}
          highlighted
        />
      </section>
    </main>
  );
}

async function fetchPricing(): Promise<PremiumPricingResponse | null> {
  try {
    return await apiFetch('/api/premium/pricing', {
      schema: premiumPricingResponseSchema,
      auth: false,
    });
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return null;
  }
}

async function fetchStatus(): Promise<PremiumStatus | null> {
  try {
    return await apiFetch('/api/me/premium/status', {
      schema: premiumStatusSchema,
      auth: true,
    });
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return null;
  }
}

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

type PricingCardProps = {
  cadence: 'monthly' | 'annual';
  grossAmountCents: number;
  currency: string;
  label: string;
  sublabel: string;
  isAuthed: boolean;
  isAlreadyPremium: boolean;
  manageUrl: string;
  highlighted?: boolean;
};

function PricingCard({
  cadence,
  grossAmountCents,
  label,
  sublabel,
  isAuthed,
  isAlreadyPremium,
  manageUrl,
  highlighted,
}: PricingCardProps) {
  const priceStr = formatBrl(grossAmountCents);
  const suffix = cadence === 'monthly' ? '/mês' : '/ano';

  return (
    <div
      className="rounded-2xl border p-5"
      style={{
        borderColor: highlighted ? garageTokens.brand.base : 'var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: highlighted ? `0 0 20px ${garageTokens.brand.soft}40` : undefined,
      }}
    >
      <div className="flex items-baseline gap-1">
        <span className="font-display text-[32px] leading-none text-fg">{priceStr}</span>
        <span className="text-muted text-sm font-mono">{suffix}</span>
      </div>
      <p className="mt-1 text-[13px] font-bold text-fg">{label}</p>
      <p className="text-muted text-xs mt-0.5">{sublabel}</p>

      <div className="mt-4">
        {isAlreadyPremium ? (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-fg text-center">Você já é membro</p>
            <a
              href={manageUrl}
              className="block text-center rounded-xl py-2.5 text-sm font-semibold border"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-fg)',
              }}
            >
              Gerenciar
            </a>
          </div>
        ) : isAuthed ? (
          <SubscribeButton cadence={cadence} />
        ) : (
          <p
            className="block text-center rounded-xl py-2.5 text-sm font-semibold"
            style={{
              background: garageTokens.brand.base,
              color: '#fff',
            }}
            data-testid={`guest-cta-${cadence}`}
          >
            Assine pelo aplicativo
          </p>
        )}
      </div>
    </div>
  );
}
