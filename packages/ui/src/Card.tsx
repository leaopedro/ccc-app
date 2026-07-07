import { View, type ViewProps } from 'react-native';

const cn = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export interface CardProps extends ViewProps {
  variant?: 'flat' | 'raised' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const byVariant: Record<NonNullable<CardProps['variant']>, string> = {
  flat: 'bg-surface',
  raised: 'bg-surface shadow-card',
  outlined: 'bg-bg border border-border',
};

const byPadding: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({ variant = 'flat', padding = 'md', className, ...rest }: CardProps) {
  return (
    <View
      className={cn(
        'rounded-xl overflow-hidden',
        byVariant[variant],
        byPadding[padding],
        className,
      )}
      {...rest}
    />
  );
}
