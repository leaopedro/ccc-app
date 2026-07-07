'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/loja/produtos', label: 'Produtos' },
  { href: '/loja/colecoes', label: 'Coleções' },
  { href: '/loja/tipos', label: 'Tipos' },
  { href: '/loja/pedidos', label: 'Pedidos' },
  { href: '/loja/estoque', label: 'Estoque' },
  { href: '/loja/configuracoes', label: 'Configurações' },
] as const;

const isActiveTab = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export const StoreSectionTabs = () => {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação da loja"
      className="flex flex-wrap gap-2 border-b border-[color:var(--color-border)] pb-4"
    >
      {TABS.map((tab) => {
        const active = isActiveTab(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              active
                ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] font-semibold text-black'
                : 'border-[color:var(--color-border)] text-[color:var(--color-muted)] hover:text-inherit',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};
