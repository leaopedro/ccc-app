import { redirect } from 'next/navigation';

import { readRole } from '~/lib/auth-session';

export default async function RootPage() {
  const role = await readRole();
  if (role === 'organizer' || role === 'admin') redirect('/events');
  redirect('/login');
}
