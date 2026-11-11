import { notFound } from 'next/navigation';

import { PublicGarageView } from '~/components/public-garage-view';
import { fetchBadgeCatalog, fetchPublicGarage } from '~/lib/public-garage';

export default async function PublicGaragePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchPublicGarage(slug);
  if (!data) notFound();
  // Only spend a roundtrip on the catalog when the garage actually has
  // pinned badges to render (skips the call for the cold majority).
  const hasBadges = (data.garage.badges?.length ?? 0) > 0;
  const catalogResp = hasBadges ? await fetchBadgeCatalog() : null;
  const badgeCatalog = catalogResp?.enabled ? catalogResp.catalog : [];
  return (
    <PublicGarageView
      garage={data.garage}
      cars={data.cars}
      gamificationEnabled={data.gamification?.enabled ?? false}
      progress={data.progress}
      stats={data.stats}
      badgeCatalog={badgeCatalog}
    />
  );
}
