import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function SentryDebugPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DEBUG !== '1') {
    notFound();
  }

  const params = await searchParams;
  if (params['debug'] === 'sentry') {
    throw new Error('Sentry test error from admin — intentional');
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Sentry Debug</h1>
      <p className="text-sm opacity-70">
        Add <code>?debug=sentry</code> to this URL to trigger a test error captured by Sentry.
      </p>
    </section>
  );
}
