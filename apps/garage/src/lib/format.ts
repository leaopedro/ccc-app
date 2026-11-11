/**
 * Currency formatting for the pre-sale order-status page. Same approach as
 * apps/admin/src/lib/format.ts's fmtBRL, but takes the currency code from
 * the order response instead of hardcoding BRL — the schema already carries
 * it (packages/shared/src/presale.ts), so use it instead of assuming.
 */
export function fmtCurrencyCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}
