import { brand } from '@jdm/design';
import type { MyTicket } from '@jdm/shared/tickets';
import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';

type Props = {
  ticket: MyTicket;
};

export const TicketPassExportCard = forwardRef<View, Props>(({ ticket }, ref) => {
  const validExtras = ticket.extras.filter((e) => e.status === 'valid');
  const validVouchers = ticket.pickupVouchers.filter((v) => v.status === 'valid');

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {ticket.event.title}
        </Text>
        <Text style={styles.sub}>
          {formatEventDateRange(ticket.event.startsAt, ticket.event.endsAt)}
        </Text>
        <Text style={styles.tier}>{ticket.tierName}</Text>
      </View>

      <View style={styles.qrWrap}>
        <QRCode value={ticket.code} size={200} backgroundColor="#FFFFFF" color="#000000" />
      </View>

      {validExtras.length > 0 && (
        <View style={styles.extras}>
          {validExtras.map((extra) => (
            <View key={extra.id} style={styles.extraCard}>
              <Text style={styles.extraName}>{extra.extraName}</Text>
              <View style={styles.extraQr}>
                <QRCode value={extra.code} size={100} backgroundColor="#FFFFFF" color="#000000" />
              </View>
            </View>
          ))}
        </View>
      )}

      {validVouchers.length > 0 && (
        <View style={styles.extras}>
          {validVouchers.map((voucher) => {
            const title = voucher.productTitle ?? '—';
            const suffix = voucher.variantName ? ` · ${voucher.variantName}` : '';
            return (
              <View key={voucher.id} style={styles.extraCard}>
                <Text style={styles.extraName}>
                  {title}
                  {suffix}
                </Text>
                <View style={styles.extraQr}>
                  <QRCode
                    value={voucher.code}
                    size={100}
                    backgroundColor="#FFFFFF"
                    color="#000000"
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <Text style={styles.footer}>{brand.name}</Text>
    </View>
  );
});

TicketPassExportCard.displayName = 'TicketPassExportCard';

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
    alignItems: 'center',
    minWidth: 320,
  },
  header: {
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  sub: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    textAlign: 'center',
  },
  tier: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrWrap: {
    padding: theme.spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radii.md,
  },
  extras: {
    width: '100%',
    gap: theme.spacing.md,
    alignItems: 'center',
  },
  extraCard: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    width: '100%',
  },
  extraName: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  extraQr: {
    padding: theme.spacing.sm,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.radii.sm,
  },
  footer: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
});
