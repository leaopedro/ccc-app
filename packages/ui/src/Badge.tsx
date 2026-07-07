import { Text as RNText, View } from 'react-native';

export type BadgeTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'live';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  className?: string;
}

const byTone: Record<BadgeTone, { bg: string; fg: string }> = {
  brand: { bg: 'bg-brand', fg: 'text-fg-inverse' },
  success: { bg: 'bg-success/20', fg: 'text-success' },
  warning: { bg: 'bg-warning/20', fg: 'text-warning' },
  danger: { bg: 'bg-danger/20', fg: 'text-danger' },
  neutral: { bg: 'bg-surface-alt', fg: 'text-fg-secondary' },
  live: { bg: 'bg-brand', fg: 'text-fg-inverse' },
};

const bySize = {
  sm: { container: 'h-6 px-2', label: 'text-[10px]' },
  md: { container: 'h-7 px-3', label: 'text-xs' },
} as const;

const cn = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export function Badge({ label, tone = 'brand', size = 'md', className }: BadgeProps) {
  const t = byTone[tone];
  const s = bySize[size];
  return (
    <View
      className={cn(
        'flex-row items-center justify-center self-start rounded-full',
        t.bg,
        s.container,
        className,
      )}
    >
      <RNText
        className={cn('font-sans uppercase tracking-widest', t.fg, s.label)}
        style={{ fontFamily: 'Inter_700Bold' }}
      >
        {label}
      </RNText>
    </View>
  );
}
