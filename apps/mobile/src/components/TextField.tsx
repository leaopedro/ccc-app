import { Text } from '@jdm/ui';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

type Props = TextInputProps & {
  label: string;
  error: string | undefined;
  hint?: string;
};

const cn = (...parts: (string | false | undefined)[]): string => parts.filter(Boolean).join(' ');

export const TextField = ({
  label,
  error,
  hint,
  style,
  onFocus,
  onBlur,
  editable,
  ...rest
}: Props) => {
  const [focused, setFocused] = useState(false);
  const isDisabled = editable === false;

  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setFocused(false);
    onBlur?.(e);
  };

  const borderClass = error ? 'border-danger' : focused ? 'border-border-strong' : 'border-border';

  return (
    <View>
      <Text variant="caption" tone="secondary" className="mb-1">
        {label}
      </Text>
      <View
        className={cn(
          'bg-surface-alt border rounded-lg h-12 px-4 flex-row items-center',
          borderClass,
          isDisabled && 'opacity-50',
        )}
      >
        <TextInput
          accessibilityLabel={error ? `${label}, error: ${error}` : label}
          placeholderTextColor="#8A8A93"
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="text-fg text-base flex-1"
          style={[{ fontFamily: 'Inter_400Regular' }, style]}
          {...rest}
        />
      </View>
      {hint && !error ? (
        <Text variant="bodySm" tone="secondary" className="mt-1">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text variant="bodySm" tone="danger" className="mt-1">
          {error}
        </Text>
      ) : null}
    </View>
  );
};
