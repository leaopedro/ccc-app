import { FinanceDashboard } from './components/finance-dashboard';

import { readRole } from '~/lib/auth-session';

export const dynamic = 'force-dynamic';

export default async function FinanceiroPage() {
  const role = await readRole();

  if (role === 'staff') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-[color:var(--color-muted)]">
            Você não tem permissão para acessar esta página.
          </p>
        </div>
      </div>
    );
  }

  return <FinanceDashboard />;
}
