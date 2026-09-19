import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TextField } from '~/components/TextField';
import { profileCopy } from '~/copy/profile';
import { theme } from '~/theme';

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  error: string | undefined;
};

const parse = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const same = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Comma-separated list input. The raw text is local state on purpose: deriving
 * it from `value.join(', ')` swallowed the comma on every keystroke, because
 * the parse drops the empty segment the user needs in order to start a second
 * item. The array reported upward stays parsed and clean.
 */
export const ModificationsField = ({ value, onChange, error }: Props) => {
  const items = value ?? [];
  const [text, setText] = useState(() => items.join(', '));
  const [lastValue, setLastValue] = useState(items);

  // The form can change `value` from outside (reset after load). Adopt that
  // text, but not when it is just the echo of what the user is typing.
  if (value !== lastValue) {
    setLastValue(items);
    if (!same(parse(text), items)) setText(items.join(', '));
  }

  return (
    <View>
      <TextField
        label={profileCopy.garage.modificationsLabel}
        hint={profileCopy.garage.modificationsHint}
        value={text}
        onChangeText={(next) => {
          setText(next);
          const parsed = parse(next);
          if (!same(parsed, items)) onChange(parsed);
        }}
        error={error}
      />
      {items.length > 0 ? (
        <View style={styles.pillsRow}>
          {items.map((mod, i) => (
            <View key={i} style={styles.pill}>
              <Text style={styles.pillText}>{mod}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  pill: {
    backgroundColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pillText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
});
