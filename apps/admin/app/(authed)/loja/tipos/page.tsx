import { TiposList } from '../../store/tipos/tipos-list';

import { listAdminProductTypes } from '~/lib/admin-api';

export const dynamic = 'force-dynamic';

export default async function LojaTiposPage() {
  const { items } = await listAdminProductTypes();
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Tipos de produto</h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Categorias livres para classificar produtos da loja (ex.: Camisetas, Bonés). Não é
          possível excluir um tipo enquanto houver produtos vinculados.
        </p>
      </header>
      <TiposList tipos={items} />
    </section>
  );
}
