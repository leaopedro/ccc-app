'use client';

import { brand } from '@jdm/design';
import type { AdminFinanceTrendPoint } from '@jdm/shared/admin';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const fmtCurrency = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const fmtDateShort = (dateStr: string) => {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: AdminFinanceTrendPoint;
    dataKey: string;
    value: number;
    color: string;
  }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  const hasStore = p.storeRevenueCents > 0;
  const hasMembership = p.membershipRevenueCents > 0;
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 font-semibold">{p.date}</div>
      <div className="text-[color:var(--color-accent)]">
        Ingressos: {fmtCurrency(p.ticketRevenueCents)}
      </div>
      {hasStore ? (
        <div style={{ color: '#f97316' }}>Loja: {fmtCurrency(p.storeRevenueCents)}</div>
      ) : null}
      {hasMembership ? (
        <div style={{ color: '#8b5cf6' }}>Assinaturas: {fmtCurrency(p.membershipRevenueCents)}</div>
      ) : null}
      <div className="mt-1 text-[color:var(--color-muted)]">
        Total: {fmtCurrency(p.revenueCents)} · {p.orderCount} pedidos
      </div>
    </div>
  );
}

export function TrendChart({ points }: { points: AdminFinanceTrendPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">Sem dados de tendência</p>
      </div>
    );
  }

  const hasStoreData = points.some((p) => p.storeRevenueCents > 0);
  const hasMembershipData = points.some((p) => p.membershipRevenueCents > 0);

  return (
    <div className="rounded-lg border border-[color:var(--color-border)] p-4">
      <h3 className="mb-3 text-sm font-semibold">Receita diária</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="ticketGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={brand.color.brand} stopOpacity={0.3} />
              <stop offset="95%" stopColor={brand.color.brand} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="storeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="membershipGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1f1f24" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDateShort}
            tick={{ fill: '#8a8a93', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => fmtCurrency(v)}
            tick={{ fill: '#8a8a93', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} />
          {hasStoreData || hasMembershipData ? (
            <Legend
              formatter={(value: string) =>
                value === 'ticketRevenueCents'
                  ? 'Ingressos'
                  : value === 'storeRevenueCents'
                    ? 'Loja'
                    : 'Assinaturas'
              }
              wrapperStyle={{ fontSize: 12, color: '#8a8a93' }}
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="ticketRevenueCents"
            stackId="revenue"
            stroke={brand.color.brand}
            strokeWidth={2}
            fill="url(#ticketGradient)"
            name="ticketRevenueCents"
          />
          {hasStoreData ? (
            <Area
              type="monotone"
              dataKey="storeRevenueCents"
              stackId="revenue"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#storeGradient)"
              name="storeRevenueCents"
            />
          ) : null}
          {hasMembershipData ? (
            <Area
              type="monotone"
              dataKey="membershipRevenueCents"
              stackId="revenue"
              stroke="#8b5cf6"
              strokeWidth={2}
              fill="url(#membershipGradient)"
              name="membershipRevenueCents"
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
