// CoverPickerSheet — preset grid + R2 upload tile for the garage cover
// (plan §9.2 + corrections §C11/§C19).
//
// Behavior contract (locked-contract impact):
//   - Tile press on a premium preset for a free user surfaces the existing
//     PremiumSheet via `onPremiumUpsell` (NEVER a dead-tap or disabled
//     control — §C11). Same rule for the upload tile.
//   - Preset selection PATCHes `/me/garage/cover` with `{ coverPreset: slug }`.
//   - Upload flow: presign (`POST /me/garage/cover/upload`) → R2 PUT → PATCH
//     with `{ coverImageObjectKey: presign.objectKey }` (NOT `coverImageUrl`
//     — that's a server-resolved field, §C1).
//   - Tile thumbs render the server-resolved preset `imageUrl` at 80pt via a
//     plain `<Image>` (NOT `<GarageCover>`; that's hero-only — §C19 carry-
//     forward).
//
// All user-facing strings route through `~/copy/garage` per CLAUDE.md i18n
// scaffold rule.

import { type GarageOwner } from '@jdm/shared/garage';
import { SheetShell, garageTokens } from '@jdm/ui';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getCoverPresets, patchGarageCover, type GarageCoverPresetItem } from '~/api/garage';
import { requestGarageCoverUpload } from '~/api/uploads';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';
import { pickImage, uploadBlobToR2 } from '~/lib/upload-image';

type Props = {
  visible: boolean;
  garage: GarageOwner;
  onClose: () => void;
  onCoverChanged: (next: GarageOwner) => void;
  onPremiumUpsell: () => void;
};

export function CoverPickerSheet({
  visible,
  garage,
  onClose,
  onCoverChanged,
  onPremiumUpsell,
}: Props) {
  const [presets, setPresets] = useState<GarageCoverPresetItem[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible || presets !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getCoverPresets();
        if (!cancelled) setPresets(res.presets);
      } catch {
        if (!cancelled) showMessage(garageCopy.garage.coverPickerLoadFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, presets]);

  const isPremiumActive = garage.isPremiumActive;
  const currentSlug = garage.coverPreset;
  const usingCustomUpload = garage.coverImageObjectKey !== null;

  const selectPreset = async (preset: GarageCoverPresetItem) => {
    if (preset.premium && !isPremiumActive) {
      onPremiumUpsell();
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await patchGarageCover({ coverPreset: preset.slug });
      onCoverChanged(res.garage);
    } catch {
      showMessage(garageCopy.garage.coverPickerSaveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async () => {
    if (!isPremiumActive) {
      onPremiumUpsell();
      return;
    }
    if (submitting) return;
    let picked;
    try {
      picked = await pickImage();
    } catch {
      showMessage(garageCopy.garage.coverPickerUploadFailed);
      return;
    }
    if (!picked) return;
    setSubmitting(true);
    let presign;
    try {
      const blob = await (await fetch(picked.uri)).blob();
      presign = await requestGarageCoverUpload({
        contentType: picked.mime,
        size: blob.size,
      });
      await uploadBlobToR2(blob, presign);
    } catch {
      showMessage(garageCopy.garage.coverPickerUploadFailed);
      setSubmitting(false);
      return;
    }
    try {
      const res = await patchGarageCover({ coverImageObjectKey: presign.objectKey });
      onCoverChanged(res.garage);
    } catch {
      showMessage(garageCopy.garage.coverPickerSaveFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetShell
      visible={visible}
      title={garageCopy.garage.coverPickerTitle}
      onClose={onClose}
      closeLabel={garageCopy.garage.closeA11yLabel}
      testID="cover-picker-sheet"
    >
      <View style={styles.body}>
        <Text style={styles.hint}>
          {isPremiumActive
            ? garageCopy.garage.coverPickerHintPremium
            : garageCopy.garage.coverPickerHintFree}
        </Text>
        <View style={styles.grid}>
          {(presets ?? []).map((preset) => {
            const locked = preset.premium && !isPremiumActive;
            const selected =
              !usingCustomUpload &&
              (currentSlug === preset.slug ||
                (currentSlug === null && preset.slug === 'default-door'));
            return (
              <Pressable
                key={preset.slug}
                onPress={() => void selectPreset(preset)}
                accessibilityRole="button"
                accessibilityLabel={preset.label}
                style={[styles.tile, selected && styles.tileSelected, locked && styles.tileLocked]}
              >
                <View style={styles.tileCover}>
                  <Image
                    source={{ uri: preset.imageUrl }}
                    style={styles.tileImage}
                    resizeMode="cover"
                  />
                  {selected ? (
                    <View style={styles.checkBadge}>
                      <Text style={styles.checkLabel}>✓</Text>
                    </View>
                  ) : null}
                  {locked ? (
                    <View style={styles.lockPip}>
                      <Text style={styles.lockLabel}>
                        {garageCopy.garage.coverPickerPremiumPip}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.tileMeta}>
                  <Text style={styles.tileLabel} numberOfLines={1}>
                    {preset.label}
                  </Text>
                  <Text style={styles.tileSlug} numberOfLines={1}>
                    {preset.slug}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => void handleUpload()}
            accessibilityRole="button"
            accessibilityLabel={garageCopy.garage.coverUploadButton}
            style={[
              styles.tile,
              styles.uploadTile,
              usingCustomUpload && styles.tileSelected,
              !isPremiumActive && styles.tileLocked,
            ]}
          >
            <View style={[styles.tileCover, styles.uploadTilePreview]}>
              {usingCustomUpload && garage.coverImageUrl ? (
                <Image
                  source={{ uri: garage.coverImageUrl }}
                  style={styles.tileImage}
                  resizeMode="cover"
                />
              ) : (
                <>
                  <Text style={styles.uploadGlyph}>⤴</Text>
                  <Text style={styles.uploadLabel}>{garageCopy.garage.coverUploadButton}</Text>
                </>
              )}
              {usingCustomUpload ? (
                <View style={styles.checkBadge}>
                  <Text style={styles.checkLabel}>✓</Text>
                </View>
              ) : null}
              {!isPremiumActive ? (
                <View style={styles.lockPip}>
                  <Text style={styles.lockLabel}>{garageCopy.garage.coverPickerPremiumPip}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.tileMeta}>
              <Text style={styles.tileLabel} numberOfLines={1}>
                {garageCopy.garage.coverPickerCustomLabel}
              </Text>
              <Text style={styles.tileSlug} numberOfLines={1}>
                {garageCopy.garage.coverUploadHint}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18 },
  hint: { color: '#8A8A93', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: garageTokens.surface.border,
    backgroundColor: garageTokens.surface.sheet,
  },
  tileSelected: { borderColor: garageTokens.brand.base },
  tileLocked: { opacity: 0.45 },
  uploadTile: { borderStyle: 'dashed' },
  tileCover: { height: 80, position: 'relative' },
  tileImage: { width: '100%', height: '100%' },
  uploadTilePreview: {
    backgroundColor: garageTokens.surface.deep,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  uploadGlyph: { color: '#F5F5F5', fontSize: 20, lineHeight: 22 },
  uploadLabel: { color: '#F5F5F5', fontSize: 12, fontWeight: '600' },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: garageTokens.brand.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: { color: '#FFFFFF', fontSize: 12, lineHeight: 12 },
  lockPip: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: garageTokens.tier.goldTint,
    borderWidth: 1,
    borderColor: 'rgba(232,179,57,0.4)',
  },
  lockLabel: {
    color: garageTokens.tier.gold,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  tileMeta: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: garageTokens.surface.deep,
    borderTopWidth: 1,
    borderTopColor: garageTokens.surface.border,
  },
  tileLabel: { color: '#F5F5F5', fontSize: 12, fontWeight: '600' },
  tileSlug: {
    color: '#8A8A93',
    fontSize: 10,
    marginTop: 1,
    fontFamily: 'JetBrainsMono_400Regular',
  },
});
