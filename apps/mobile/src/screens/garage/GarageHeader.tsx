// GarageHeader — thin wrapper around the cover hero + identity card (plan
// §8.4). The previous monolithic form is now split into `EditGarageSheet`
// (form) + `IdentityCard` (display). Chunk 09 internalizes `CoverPickerSheet`
// here (plan §9.4): the route no longer wires `onCoverEdit`; the header owns
// the sheet's open/close state and passes the open-handler to `IdentityCard`.
//
// `GarageCover` import path note: it lives in `apps/mobile/src/screens/garage/`,
// NOT in `@ccc/ui`. Declaring `expo-linear-gradient` on the shared package
// broke admin's React resolution — see chunk 07 round-3/4 and plan §C12 (now
// resolved by colocating the cover with the mobile app).

import { type GarageOwner } from '@ccc/shared/garage';
import { PremiumSheet } from '@ccc/ui';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { CoverPickerSheet } from './CoverPickerSheet';
import { EditGarageSheet } from './EditGarageSheet';
import { GarageCover } from './GarageCover';
import { IdentityCard } from './IdentityCard';

import { publicGarageUrl } from '~/config/urls';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';
import { isCaixaBuildEnabled } from '~/screens/caixa/caixa-enabled';
import { premiumSheetBenefits } from '~/screens/garage/premium-benefits';

type Props = {
  garage: GarageOwner;
  onUpdated: (next: GarageOwner) => void;
  carCount: number;
};

export function GarageHeader({ garage, onUpdated, carCount }: Props) {
  const [editSheet, setEditSheet] = useState(false);
  const [coverSheet, setCoverSheet] = useState(false);
  const [premiumSheet, setPremiumSheet] = useState(false);

  const handleShare = async () => {
    if (!garage.isPublic) {
      showMessage(garageCopy.garage.shareLinkDisabledHint);
      return;
    }
    try {
      const url = publicGarageUrl(garage.slug);
      await Share.share({ message: url, url, title: garage.name });
    } catch {
      /* user-dismiss */
    }
  };

  return (
    <View>
      <GarageCover
        coverPreset={garage.coverPreset}
        coverImageUrl={garage.coverImageUrl}
        isPremiumActive={garage.isPremiumActive}
      />
      <IdentityCard
        garage={garage}
        carCount={carCount}
        isOwner
        onEdit={() => setEditSheet(true)}
        onCoverEdit={() => setCoverSheet(true)}
        onShare={() => void handleShare()}
        onBadgePress={() => setPremiumSheet(true)}
      />
      <EditGarageSheet
        visible={editSheet}
        garage={garage}
        onClose={() => setEditSheet(false)}
        onSaved={onUpdated}
      />
      <CoverPickerSheet
        visible={coverSheet}
        garage={garage}
        onClose={() => setCoverSheet(false)}
        onCoverChanged={(next) => {
          onUpdated(next);
          setCoverSheet(false);
        }}
        onPremiumUpsell={() => {
          setCoverSheet(false);
          setPremiumSheet(true);
        }}
      />
      <PremiumSheet
        visible={premiumSheet}
        tier={garage.premiumTier}
        isPremiumActive={garage.isPremiumActive}
        daysLeftUntilExpiry={garage.daysLeftUntilExpiry}
        onClose={() => setPremiumSheet(false)}
        copy={{
          title: garageCopy.garage.premiumSheetTitle,
          tierLabel: garageCopy.garage.premiumTierLabel(garage.premiumTier ?? 'gold'),
          heroTitle: garageCopy.garage.premiumHeroTitle,
          heroBody: garageCopy.garage.premiumHeroBody,
          nearExpiry: garageCopy.garage.premiumNearExpiry,
          // Final review C2 — the caixa only appears when the build can
          // actually deliver it (EXPO_PUBLIC_CAIXA_ENABLED).
          benefits: premiumSheetBenefits({
            caixaEnabled: isCaixaBuildEnabled(),
            copy: garageCopy.garage,
          }),
          footer: garageCopy.garage.premiumFooter,
        }}
      />
    </View>
  );
}
