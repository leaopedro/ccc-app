'use client';

import { brand } from '@jdm/design';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useState } from 'react';

import { LogoutButton } from './logout-button';

const ORGANIZER_LINKS = [
  { href: '/events', label: 'Eventos' },
  { href: '/loja', label: 'Loja' },
  { href: '/premium/catalogo', label: 'Premium' },
  { href: '/users', label: 'Usuários' },
  { href: '/financeiro', label: 'Financeiro' },
  { href: '/broadcasts', label: 'Broadcasts' },
  { href: '/support', label: 'Suporte' },
  { href: '/check-in', label: 'Check-in' },
] as const;

const STAFF_LINKS = [{ href: '/check-in', label: 'Check-in' }] as const;

const USERS_SUB_LINKS = [
  { href: '/users', label: 'Usuários' },
  { href: '/groups', label: 'Grupos' },
] as const;

export const AuthedNav = ({ isStaff }: { isStaff: boolean }) => {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = isStaff ? STAFF_LINKS : ORGANIZER_LINKS;
  const homeHref = isStaff ? '/check-in' : '/events';
  const inUsersSection =
    !isStaff && (pathname.startsWith('/users') || pathname.startsWith('/groups'));

  return (
    <nav className="border-b border-[color:var(--color-border)]">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href={homeHref} className="font-semibold">
            {brand.shortName} Admin
          </Link>
          <div className="hidden items-center gap-4 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-sm opacity-80 hover:opacity-100">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LogoutButton />
          <button
            type="button"
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex flex-col justify-center gap-1.5 rounded p-1 focus-visible:outline focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-border)] md:hidden"
          >
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
          </button>
        </div>
      </div>
      {open ? (
        <div className="flex flex-col border-t border-[color:var(--color-border)] px-6 py-2 md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="py-2.5 text-sm opacity-80 hover:opacity-100"
            >
              {l.label}
            </Link>
          ))}
          {inUsersSection &&
            USERS_SUB_LINKS.map((l) => (
              <Link
                key={`sub-${l.href}`}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`py-2 pl-4 text-sm ${pathname.startsWith(l.href) ? 'font-semibold' : 'opacity-70 hover:opacity-100'}`}
              >
                {l.label}
              </Link>
            ))}
        </div>
      ) : null}
      {inUsersSection && (
        <div
          className="flex gap-1 border-t border-[color:var(--color-border)] px-6"
          data-testid="users-subnav"
        >
          {USERS_SUB_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`border-b-2 px-2 py-2 text-sm ${
                pathname.startsWith(l.href)
                  ? 'border-[color:var(--color-accent)] font-semibold'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
};
