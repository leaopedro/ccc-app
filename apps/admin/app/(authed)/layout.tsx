import { AuthedNav } from '~/components/authed-nav';
import { CookieBanner } from '~/components/cookie-banner';
import { readRole } from '~/lib/auth-session';

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const role = await readRole();
  const isStaff = role === 'staff';

  return (
    <div className="min-h-screen">
      <AuthedNav isStaff={isStaff} />
      <main className="mx-auto max-w-5xl p-6">{children}</main>
      <CookieBanner />
    </div>
  );
}
