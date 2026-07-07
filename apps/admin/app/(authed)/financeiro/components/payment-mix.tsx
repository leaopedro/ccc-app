import type { AdminFinancePaymentMixItem } from '@jdm/shared/admin';

const fmtCurrency = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const methodLabels: Record<string, string> = {
  card: 'Cartão',
  pix: 'Pix',
  subscription: 'Assinatura',
  storekit: 'App Store',
};

const providerLabels: Record<string, string> = {
  stripe: 'Stripe',
  abacatepay: 'AbacatePay',
  apple_revenuecat: 'RevenueCat',
};

export function PaymentMix({ items }: { items: AdminFinancePaymentMixItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[color:var(--color-border)] p-4">
        <h3 className="mb-3 text-sm font-semibold">Mix de pagamento</h3>
        <p className="text-sm text-[color:var(--color-muted)]">Sem dados.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-4">
      <h3 className="mb-3 text-sm font-semibold">Mix de pagamento</h3>
      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const label = `${methodLabels[item.method] ?? item.method} · ${providerLabels[item.provider] ?? item.provider}`;
          return (
            <div key={`${item.provider}-${item.method}`}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span>{label}</span>
                <span className="tabular-nums font-medium">{fmtPct(item.percentage)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[color:var(--color-border)]">
                <div
                  className="h-full rounded-full bg-[color:var(--color-accent)]"
                  style={{ width: `${Math.min(item.percentage, 100)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-[color:var(--color-muted)]">
                <span>{fmtCurrency(item.revenueCents)}</span>
                <span>
                  {item.orderCount}{' '}
                  {item.method === 'subscription' || item.method === 'storekit'
                    ? 'cobranças'
                    : 'pedidos'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
