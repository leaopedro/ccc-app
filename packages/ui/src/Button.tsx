import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  type PressableProps,
  type View,
} from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

const containerBase = 'flex-row items-center justify-center rounded-lg active:opacity-80';

const containerByVariant: Record<ButtonVariant, string> = {
  primary: 'bg-brand shadow-glow',
  secondary: 'bg-surface border border-border-strong',
  ghost: 'bg-transparent',
  danger: 'bg-danger',
};

const containerBySize: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 gap-2',
  md: 'h-12 px-5 gap-2',
  lg: 'h-14 px-6 gap-3',
};

const labelBase = 'font-sans text-base';

const labelByVariant: Record<ButtonVariant, string> = {
  primary: 'text-fg font-bold',
  secondary: 'text-fg font-semibold',
  ghost: 'text-fg-secondary font-medium',
  danger: 'text-fg-inverse font-bold',
};

const labelBySize: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

const cn = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

export const Button = forwardRef<View, ButtonProps>(
  (
    {
      label,
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      iconLeft,
      iconRight,
      disabled,
      className,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        disabled={isDisabled}
        className={cn(
          containerBase,
          containerByVariant[variant],
          containerBySize[size],
          fullWidth && 'w-full',
          isDisabled && 'opacity-50',
          className,
        )}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color="#F5F5F5" />
        ) : (
          <>
            {iconLeft}
            <RNText className={cn(labelBase, labelByVariant[variant], labelBySize[size])}>
              {label}
            </RNText>
            {iconRight}
          </>
        )}
      </Pressable>
    );
  },
);

Button.displayName = 'Button';
