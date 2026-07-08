import { GARAGE_COVER_PRESETS, resolveGarageCoverSlug } from '@ccc/shared/garage-covers';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Text, View } from 'react-native';

const r2PublicBaseUrl = (): string => {
  const extra = (Constants.expoConfig?.extra ?? {}) as { r2PublicBaseUrl?: string };
  return (extra.r2PublicBaseUrl ?? '').replace(/\/$/, '');
};

const presetImageUrl = (slug: string): string | null => {
  const base = r2PublicBaseUrl();
  return base ? `${base}/garage-cover-presets/${slug}@2x.jpg` : null;
};

export interface GarageCoverProps {
  coverPreset: string | null;
  coverImageUrl: string | null;
  isPremiumActive: boolean;
  height?: number;
  testID?: string;
}

export function GarageCover({
  coverPreset,
  coverImageUrl,
  isPremiumActive,
  height = 168,
  testID,
}: GarageCoverProps) {
  const resolved = resolveGarageCoverSlug(coverPreset, coverImageUrl, isPremiumActive);

  if (resolved.kind === 'url') {
    return (
      <View testID={testID} style={{ width: '100%', height, position: 'relative' }}>
        <Image
          testID="cover-image"
          source={{ uri: resolved.url }}
          style={{ width: '100%', height }}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
          locations={[0, 0.6, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' }}
        />
      </View>
    );
  }

  const preset =
    GARAGE_COVER_PRESETS.find((p) => p.slug === resolved.slug) ?? GARAGE_COVER_PRESETS[0];
  const imageUrl = presetImageUrl(preset.slug);

  return (
    <View
      testID={testID}
      style={{ width: '100%', height, position: 'relative', overflow: 'hidden' }}
    >
      {/* Base hue ramp — also the load/error fallback under the R2 image */}
      <LinearGradient
        colors={[preset.hues[0], preset.hues[1]]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          width: '100%',
          height,
        }}
      />
      {/* Stripe glow */}
      <View
        testID={`cover-preset-${preset.slug}`}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          opacity: 0.4,
          backgroundColor: preset.stripe,
        }}
      />
      {imageUrl ? (
        <Image
          testID="cover-preset-image"
          source={{ uri: imageUrl }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            width: '100%',
            height,
          }}
          resizeMode="cover"
        />
      ) : null}
      {/* Bottom scrim */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
        locations={[0, 0.6, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' }}
      />
      {/* Corner slug label */}
      <View style={{ position: 'absolute', top: 14, right: 14 }}>
        <Text
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 9,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          cover · {preset.slug}
        </Text>
      </View>
    </View>
  );
}
