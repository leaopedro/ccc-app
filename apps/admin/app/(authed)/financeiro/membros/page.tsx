import { redirect } from 'next/navigation';

/**
 * A aba Assinaturas absorveu esta tela. A rota fica de pe so para nao quebrar
 * link salvo ou favorito, preservando os filtros que ja estavam na URL.
 *
 * redirect() lanca NEXT_REDIRECT, entao nunca pode ficar dentro de try/catch.
 */
export const dynamic = 'force-dynamic';

export default async function FinanceiroMembrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string' && value.length > 0) params.set(key, value);
  }
  const qs = params.toString();
  redirect(qs ? `/assinaturas?${qs}` : '/assinaturas');
}
