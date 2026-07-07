import { tierColors, type GaragePremiumTier } from '../garage-tokens.js';

export interface PremiumBadgeProps {
  isPremiumActive: boolean | null | undefined;
  tier?: GaragePremiumTier | null;
  size?: 'sm' | 'md';
  daysLeftUntilExpiry?: number | null;
  onPress?: () => void;
}

const heightFor = (size: 'sm' | 'md') => (size === 'md' ? 'h-7' : 'h-6');
const fontSizeFor = (size: 'sm' | 'md') => (size === 'md' ? 'text-[11px]' : 'text-[10px]');
const tierName = (tier: GaragePremiumTier | null | undefined): string => {
  if (tier === 'gold') return 'Gold';
  if (tier === 'silver') return 'Silver';
  if (tier === 'bronze') return 'Bronze';
  return 'Premium';
};

export function PremiumBadge({
  isPremiumActive,
  tier = null,
  size = 'sm',
  daysLeftUntilExpiry = null,
  onPress,
}: PremiumBadgeProps) {
  if (isPremiumActive !== true) return null;
  const t = tierColors(tier);
  const showDays =
    daysLeftUntilExpiry !== null && daysLeftUntilExpiry > 0 && daysLeftUntilExpiry <= 7;
  const a11yLabel = `${t.label}${showDays ? `, expira em ${daysLeftUntilExpiry} dias` : ''}`;

  const inner = (
    <span
      className={`inline-flex items-stretch overflow-hidden rounded ${heightFor(size)}`}
      style={{ borderColor: `${t.main}66`, borderWidth: 1, borderStyle: 'solid' }}
    >
      <span
        className={`inline-flex items-center px-[7px] font-bold uppercase tracking-widest ${fontSizeFor(size)}`}
        style={{ backgroundColor: t.main, color: '#0A0A0A' }}
      >
        {tierName(tier)}
      </span>
      {showDays ? (
        <span
          className={`inline-flex items-center px-[7px] font-bold ${fontSizeFor(size)} tabular-nums`}
          style={{ color: t.main }}
        >
          {daysLeftUntilExpiry}d
        </span>
      ) : null}
    </span>
  );

  if (!onPress)
    return (
      <span role="img" aria-label={a11yLabel}>
        {inner}
      </span>
    );
  return (
    <button type="button" aria-label={a11yLabel} onClick={onPress} className="inline-flex">
      {inner}
    </button>
  );
}
