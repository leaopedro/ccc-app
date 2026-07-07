import { redirect } from 'next/navigation';

import { readRole } from '~/lib/auth-session';

export default async function EventsLayout({ children }: { children: React.ReactNode }) {
  const role = await readRole();
  if (role === 'staff') {
    redirect('/check-in');
  }
  return <>{children}</>;
}
