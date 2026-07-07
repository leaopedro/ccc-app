'use client';

import { logoutAction } from '~/lib/auth-actions';

export const LogoutButton = () => (
  <form action={logoutAction}>
    <button
      type="submit"
      className="rounded border border-[color:var(--color-border)] px-3 py-1 text-sm hover:bg-[color:var(--color-border)]"
    >
      Sair
    </button>
  </form>
);
