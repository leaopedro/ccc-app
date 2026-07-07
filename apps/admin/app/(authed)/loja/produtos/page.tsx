import Link from 'next/link';

import { ProductStatusBadge } from './product-status-badge';

import { listAdminStoreProducts } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

const fmtBRL = (cents: number, currency: string) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);

export default async function ProductsPage() {
  const { items } = await listAdminStoreProducts();
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Produtos</h1>
        <Link
          href="/loja/produtos/new"
          className="rounded bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold"
        >
          Novo produto
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[color:var(--color-border)] text-sm text-[color:var(--color-muted)]">
              <th className="py-2">Título</th>
              <th>Status</th>
              <th>Tipo</th>
              <th>Preço base</th>
              <th>Variantes</th>
              <th>Fotos</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-[color:var(--color-border)]">
                <td className="py-2">
                  <Link href={`/loja/produtos/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                  <div className="text-xs text-[color:var(--color-muted)]">{p.slug}</div>
                </td>
                <td>
                  <ProductStatusBadge status={p.status} />
                </td>
                <td className="text-sm">{p.productTypeName}</td>
                <td className="text-sm">{fmtBRL(p.basePriceCents, p.currency)}</td>
                <td className="text-sm">{p.variantCount}</td>
                <td className="text-sm">{p.photoCount}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[color:var(--color-muted)]">
                  Nenhum produto ainda.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
