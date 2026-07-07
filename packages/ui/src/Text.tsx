import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

export type TextVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodyLg'
  | 'bodySm'
  | 'caption'
  | 'eyebrow'
  | 'mono';

export type TextTone = 'primary' | 'secondary' | 'muted' | 'brand' | 'inverse' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}

const byVariant: Record<TextVariant, string> = {
  display: 'font-display text-5xl tracking-tight leading-[1.05]',
  h1: 'font-display text-4xl tracking-tight leading-tight',
  h2: 'font-sans text-2xl leading-snug',
  h3: 'font-sans text-xl leading-snug',
  body: 'font-sans text-base leading-normal',
  bodyLg: 'font-sans text-lg leading-normal',
  bodySm: 'font-sans text-sm leading-normal',
  caption: 'font-sans text-xs leading-normal',
  eyebrow: 'font-sans text-xs uppercase tracking-widest',
  mono: 'font-mono text-base',
};

const byTone: Record<TextTone, string> = {
  primary: 'text-fg',
  secondary: 'text-fg-secondary',
  muted: 'text-fg-muted',
  brand: 'text-brand',
  inverse: 'text-fg-inverse',
  danger: 'text-danger',
};

const fontFamilyByWeight: Record<NonNullable<TextProps['weight']>, string> = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

const cn = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export function Text({
  variant = 'body',
  tone = 'primary',
  weight,
  className,
  style,
  ...rest
}: TextProps) {
  // For display/heading variants, font family is set via class. For body
  // weights we override via style to map to the loaded weighted Inter.
  const weightStyle =
    weight && (variant === 'body' || variant === 'bodyLg' || variant === 'bodySm')
      ? { fontFamily: fontFamilyByWeight[weight] }
      : undefined;
  return (
    <RNText
      className={cn(byVariant[variant], byTone[tone], className)}
      style={[weightStyle, style]}
      {...rest}
    />
  );
}
