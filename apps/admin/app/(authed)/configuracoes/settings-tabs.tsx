'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/configuracoes', label: 'Gerais' },
  { href: '/configuracoes/home', label: 'Home' },
] as const;

// '/configuracoes' e prefixo de '/configuracoes/home', entao a aba Gerais so
// fica ativa em match exato.
const isActiveTab = (pathname: string, href: string) =>
  href === '/configuracoes' ? pathname === href : pathname.startsWith(href);

export const SettingsTabs = () => {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação das configurações"
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
