import { Ticket as TicketIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

type Props = {
  onPress: () => void;
};

export function TicketStrip({ onPress }: Props) {
  const label = feedCopy.strip.buyTicket;

  return (
    <View style={styles.strip}>
      <TicketIcon size={16} strokeWidth={2} color={theme.colors.fg} accessible={false} />
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        style={styles.btn}
      >
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.border,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.bg,
    minHeight: 44,
  },
  btn: { flex: 1, minHeight: 44, justifyContent: 'center' },
  label: { color: theme.colors.fg, fontWeight: '600', fontSize: theme.font.size.sm },
});
