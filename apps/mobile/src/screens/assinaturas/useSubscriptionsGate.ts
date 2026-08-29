// Deep-link gate for the assinaturas purchase routes (contratar, [slug]).
//
// Hiding the premium tab (usePremiumSlot, Task 9) does not remove the route —
// `contratar` and the plan detail screen stay registered with `href: null` so
// existing deep links keep resolving. Without this, a reviewer (or anyone
// else) who opens one of those links directly on a gated platform lands on a
// purchase screen the platform gate was supposed to hide.
//
// Reads `subscriptionsEnabled` straight through usePremiumPlans (Task 8) — no
// module-level cache here; a previous task's cache was deliberately removed.
// Redirects to /inicio, and fails closed while the answer is still loading:
// the caller must not render either the purchase UI or a flash of it before
// the redirect lands.

import { router } from 'expo-router';
import { useEffect } from 'react';

import { usePremiumPlans } from '~/hooks/usePremiumPlans';

const GATED_REDIRECT_TARGET = '/inicio';

export function useSubscriptionsGate(): { canRender: boolean } {
  const { subscriptionsEnabled, loading } = usePremiumPlans();

  useEffect(() => {
    if (!loading && !subscriptionsEnabled) {
      router.replace(GATED_REDIRECT_TARGET);
    }
  }, [loading, subscriptionsEnabled]);

  return { canRender: !loading && subscriptionsEnabled };
}
