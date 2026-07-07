import type { MyTicket } from '@jdm/shared/tickets';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import { Share } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import type { ViewProps } from 'react-native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { listMyTickets, updateMyTicket } from '~/api/tickets';
import { HiddenQR } from '~/components/HiddenQR';
import { TicketPassExportCard } from '~/components/TicketPassExportCard';
import { ticketsCopy } from '~/copy/tickets';
import { formatEventDateRange } from '~/lib/format';
import { theme } from '~/theme';
import { exportTicketImage } from '~/tickets/export-ticket-image';
import {
  getSavedTicket,
  isTicketSaved,
  removeSavedTicket,
  saveTicket,
} from '~/tickets/offline-storage';

function Toast({ message, onHide }: { message: string; onHide: () => void }) {
  useEffect(() => {
    const t = setTimeout(onHide, 3000);
    return () => clearTimeout(t);
  }, [onHide]);

  return (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

export default function TicketDetail() {
  useKeepAwake();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.setAttribute('data-jdm-print', 'ticket');
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        [data-jdm-export-card], [data-jdm-export-card] * { visibility: visible !important; }
        [data-jdm-export-card] {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
          opacity: 1 !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);
  const params = useLocalSearchParams<{ ticketId: string; ticket?: string }>();
  const ticketId = params.ticketId;
  const preloaded = params.ticket ? (JSON.parse(params.ticket) as MyTicket) : null;
  const [ticket, setTicket] = useState<MyTicket | null>(preloaded);
  const [loaded, setLoaded] = useState<boolean>(preloaded !== null);
  const [editing, setEditing] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const exportRef = useRef<View>(null);

  useEffect(() => {
    if (preloaded) {
      void isTicketSaved(ticketId).then(setSavedOffline);
      return;
    }
    void (async () => {
      try {
        const { items } = await listMyTickets();
        const found = items.find((t) => t.id === ticketId) ?? null;
        if (found) {
          setTicket(found);
          const alreadySaved = await isTicketSaved(ticketId);
          if (alreadySaved) await saveTicket(found);
          setSavedOffline(alreadySaved);
        } else {
          const offline = await getSavedTicket(ticketId);
          setTicket(offline);
          setSavedOffline(offline !== null);
        }
      } catch {
        const offline = await getSavedTicket(ticketId);
        setTicket(offline);
        setSavedOffline(offline !== null);
      } finally {
        setLoaded(true);
      }
    })();
  }, [ticketId, preloaded]);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!ticket) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>{ticketsCopy.detail.notFound}</Text>
      </View>
    );
  }

  const label =
    ticket.status === 'valid'
      ? ticketsCopy.detail.valid
      : ticket.status === 'used'
        ? ticketsCopy.detail.used
        : ticketsCopy.detail.revoked;

  const nickname = ticket.nickname?.trim() || null;

  const openEdit = () => {
    setNicknameDraft(nickname ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(false);
  };

  const submit = async (next: string | null) => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateMyTicket(ticket.id, { nickname: next });
      setTicket(updated);
      setEditing(false);
    } catch {
      setSaveError(ticketsCopy.detail.nicknameError);
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    const trimmed = nicknameDraft.trim();
    if (trimmed.length === 0) {
      void submit(null);
      return;
    }
    void submit(trimmed);
  };

  const onRemove = () => {
    void submit(null);
  };

  const handleSaveOffline = async () => {
    setMenuOpen(false);
    await saveTicket(ticket);
    setSavedOffline(true);
    setToast(ticketsCopy.offline.savedToast);
  };

  const handleRemoveOffline = async () => {
    setMenuOpen(false);
    await removeSavedTicket(ticket.id);
    setSavedOffline(false);
    setToast(ticketsCopy.offline.removedToast);
  };

  const handleExport = async () => {
    setMenuOpen(false);
    const result = await exportTicketImage(exportRef);
    if (result === 'shared') {
      setToast(ticketsCopy.offline.sharedToast);
    } else if (result === 'saved') {
      setToast(ticketsCopy.offline.exportedToast);
    } else if (result === 'printed') {
      setToast(ticketsCopy.offline.printedToast);
    } else if (result === 'permission_denied') {
      setToast(ticketsCopy.offline.exportPermissionDenied);
    } else {
      setToast(ticketsCopy.offline.exportError);
    }
  };

  // react-native-web emits dataSet as data-* DOM attributes; not in RN 0.81 ViewProps.
  const ExportCardView = View as React.ComponentType<
    ViewProps & { dataSet?: Record<string, string> }
  >;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{nickname ?? ticket.event.title}</Text>
            {nickname ? <Text style={styles.subTitle}>{ticket.event.title}</Text> : null}
          </View>
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={styles.overflowBtn}
            accessibilityRole="button"
            accessibilityLabel="Exportar ingresso"
            hitSlop={8}
          >
            <Share color={theme.colors.fg} size={22} />
          </Pressable>
        </View>
        <Pressable
          onPress={openEdit}
          style={styles.editButton}
          accessibilityRole="button"
          accessibilityLabel={
            nickname ? ticketsCopy.detail.nicknameEdit : ticketsCopy.detail.nicknameAdd
          }
        >
          <Text style={styles.editButtonText}>
            {nickname ? ticketsCopy.detail.nicknameEdit : ticketsCopy.detail.nicknameAdd}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.sub}>
        {formatEventDateRange(ticket.event.startsAt, ticket.event.endsAt)}
      </Text>
      <Text style={styles.sub}>{ticket.tierName}</Text>

      {ticket.status === 'used' ? (
        <View
          style={styles.qrUsedBox}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={ticketsCopy.detail.qrUsed}
        >
          <Text style={styles.qrUsedText}>{ticketsCopy.detail.qrUsed}</Text>
        </View>
      ) : (
        <>
          <View style={styles.qrBox}>
            <HiddenQR
              value={ticket.code}
              size={240}
              accessibilityLabel={`QR code for ${ticket.event.title}`}
            />
          </View>
          <Text style={styles.hint}>{ticketsCopy.detail.brightness}</Text>
        </>
      )}
      <Text style={[styles.status, ticket.status !== 'valid' && styles.statusMuted]}>{label}</Text>

      {ticket.extras.length > 0 && (
        <View style={styles.extrasSection}>
          <Text style={styles.extrasTitle}>{ticketsCopy.detail.extrasTitle}</Text>
          {ticket.extras.map((extra) => {
            const isUsed = extra.status !== 'valid';
            const extraLabel =
              extra.status === 'valid'
                ? ticketsCopy.detail.valid
                : extra.status === 'used'
                  ? ticketsCopy.detail.used
                  : ticketsCopy.detail.revoked;

            return (
              <View key={extra.id} style={[styles.extraCard, isUsed && styles.extraCardUsed]}>
                <Text style={[styles.extraName, isUsed && styles.textMuted]}>
                  {extra.extraName}
                </Text>
                {extra.status === 'used' ? (
                  <View
                    style={styles.extraQrUsedBox}
                    accessible={true}
                    accessibilityRole="text"
                    accessibilityLabel={ticketsCopy.detail.qrUsed}
                  >
                    <Text style={styles.qrUsedText}>{ticketsCopy.detail.qrUsed}</Text>
                  </View>
                ) : (
                  <View style={styles.extraQrBox}>
                    <HiddenQR
                      value={extra.code}
                      size={140}
                      accessibilityLabel={`QR code for ${extra.extraName}`}
                    />
                  </View>
                )}
                <Text style={[styles.extraStatus, isUsed && styles.textMuted]}>{extraLabel}</Text>
              </View>
            );
          })}
        </View>
      )}

      {ticket.pickupVouchers.length > 0 && (
        <View style={styles.pickupSection}>
          <Text style={styles.extrasTitle}>{ticketsCopy.detail.vouchersTitle}</Text>
          <Text style={styles.pickupHelp}>{ticketsCopy.detail.vouchersHelp}</Text>
          {ticket.pickupVouchers.map((voucher) => {
            const used = voucher.status === 'used';
            const revoked = voucher.status === 'revoked';
            const statusLabel = used
              ? ticketsCopy.detail.voucherUsed
              : revoked
                ? ticketsCopy.detail.voucherRevoked
                : ticketsCopy.detail.voucherValid;
            const title = voucher.productTitle ?? '—';
            const variantSuffix = voucher.variantName ? ` · ${voucher.variantName}` : '';
            return (
              <View
                key={voucher.id}
                style={[styles.extraCard, (used || revoked) && styles.extraCardUsed]}
              >
                <Text style={[styles.extraName, (used || revoked) && styles.textMuted]}>
                  {title}
                  {variantSuffix}
                </Text>
                <Text style={[styles.pickupItemQty, (used || revoked) && styles.textMuted]}>
                  {ticketsCopy.detail.voucherOrderLabel(voucher.orderShortId)}
                </Text>
                {used || revoked ? (
                  <View
                    style={styles.extraQrUsedBox}
                    accessible={true}
                    accessibilityRole="text"
                    accessibilityLabel={statusLabel}
                  >
                    <Text style={styles.qrUsedText}>{statusLabel}</Text>
                  </View>
                ) : (
                  <View style={styles.extraQrBox}>
                    <HiddenQR
                      value={voucher.code}
                      size={160}
                      accessibilityLabel={`Voucher QR for ${title}`}
                    />
                  </View>
                )}
                <Text style={[styles.extraStatus, (used || revoked) && styles.textMuted]}>
                  {statusLabel}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {ticket.pickupOrders.length > 0 && (
        <View style={styles.pickupSection}>
          <Text style={styles.extrasTitle}>{ticketsCopy.detail.pickupTitle}</Text>
          <Text style={styles.pickupHelp}>{ticketsCopy.detail.pickupHelp}</Text>
          {ticket.pickupOrders.map((order) => {
            const collected = order.fulfillmentStatus === 'picked_up';
            const cancelled = order.fulfillmentStatus === 'cancelled';
            return (
              <View
                key={order.orderId}
                style={[styles.pickupCard, (collected || cancelled) && styles.pickupCardMuted]}
              >
                <View style={styles.pickupHeader}>
                  <Text style={styles.pickupOrderId}>
                    {ticketsCopy.detail.pickupOrderLabel(order.shortId)}
                  </Text>
                  <Text style={[styles.pickupStatus, (collected || cancelled) && styles.textMuted]}>
                    {ticketsCopy.detail.pickupStatus[order.fulfillmentStatus]}
                  </Text>
                </View>
                {order.items.map((item) => (
                  <View key={item.id} style={styles.pickupItemRow}>
                    <Text style={[styles.pickupItemName, cancelled && styles.textMuted]}>
                      {item.productTitle ?? '—'}
                      {item.variantName ? ` · ${item.variantName}` : ''}
                    </Text>
                    <Text style={styles.pickupItemQty}>
                      {ticketsCopy.detail.pickupItemQuantity(item.quantity)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      )}

      {/* Hidden off-screen export card captured by react-native-view-shot */}
      <ExportCardView dataSet={{ jdmExportCard: 'ticket' }} style={styles.exportCardHidden}>
        <TicketPassExportCard ref={exportRef} ticket={ticket} />
      </ExportCardView>

      {/* Overflow menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)} />
        <View style={styles.menuCard}>
          {ticket.status === 'valid' && !savedOffline ? (
            <Pressable
              style={styles.menuRow}
              onPress={() => void handleSaveOffline()}
              accessibilityRole="button"
            >
              <Text style={styles.menuText}>{ticketsCopy.offline.saveLabel}</Text>
            </Pressable>
          ) : null}
          {savedOffline ? (
            <Pressable
              style={styles.menuRow}
              onPress={() => void handleRemoveOffline()}
              accessibilityRole="button"
            >
              <Text style={styles.menuText}>{ticketsCopy.offline.removeLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.menuRow}
            onPress={() => void handleExport()}
            accessibilityRole="button"
          >
            <Text style={styles.menuText}>{ticketsCopy.offline.exportLabel}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Nickname edit modal */}
      <Modal visible={editing} animationType="fade" transparent onRequestClose={closeEdit}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.backdrop} onPress={closeEdit} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{ticketsCopy.detail.nicknameLabel}</Text>
            <TextInput
              value={nicknameDraft}
              onChangeText={setNicknameDraft}
              placeholder={ticketsCopy.detail.nicknamePlaceholder}
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
              maxLength={60}
              autoFocus
              editable={!saving}
              accessibilityLabel={ticketsCopy.detail.nicknameLabel}
            />
            <Text style={styles.hintSmall}>{ticketsCopy.detail.nicknameMaxLengthHint}</Text>
            {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeEdit}
                style={[styles.actionButton, styles.actionSecondary]}
                accessibilityRole="button"
                disabled={saving}
              >
                <Text style={styles.actionSecondaryText}>{ticketsCopy.detail.nicknameCancel}</Text>
              </Pressable>
              <Pressable
                onPress={onSave}
                style={[styles.actionButton, styles.actionPrimary, saving && styles.actionDisabled]}
                accessibilityRole="button"
                disabled={saving}
              >
                <Text style={styles.actionPrimaryText}>
                  {saving ? ticketsCopy.detail.nicknameSaving : ticketsCopy.detail.nicknameSave}
                </Text>
              </Pressable>
            </View>
            {nickname ? (
              <Pressable
                onPress={onRemove}
                style={styles.removeButton}
                accessibilityRole="button"
                disabled={saving}
              >
                <Text style={styles.removeText}>{ticketsCopy.detail.nicknameRemove}</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {toast ? <Toast message={toast} onHide={() => setToast(null)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
    minHeight: '100%',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
  },
  header: {
    alignItems: 'center',
    gap: theme.spacing.xs,
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  subTitle: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    textAlign: 'center',
  },
  overflowBtn: {
    padding: theme.spacing.xs,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  editButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  editButtonText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  sub: { color: theme.colors.muted, textAlign: 'center' },
  qrBox: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.lg,
    backgroundColor: '#fff',
    borderRadius: theme.radii.md,
  },
  hint: { color: theme.colors.muted, textAlign: 'center', fontSize: theme.font.size.sm },
  hintSmall: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  status: { color: theme.colors.fg, fontWeight: '700' },
  statusMuted: { color: theme.colors.muted },
  extrasSection: {
    width: '100%',
    marginTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  extrasTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '700',
  },
  extraCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  extraCardUsed: { opacity: 0.5 },
  extraName: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  extraQrBox: {
    padding: theme.spacing.md,
    backgroundColor: '#fff',
    borderRadius: theme.radii.sm,
  },
  extraStatus: { color: theme.colors.fg, fontWeight: '600', fontSize: theme.font.size.sm },
  textMuted: { color: theme.colors.muted },
  qrUsedBox: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl + theme.spacing.lg,
    minHeight: 240 + theme.spacing.lg * 2,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 280,
  },
  extraQrUsedBox: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    minHeight: 140 + theme.spacing.md * 2,
    borderRadius: theme.radii.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  qrUsedText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  exportCardHidden: {
    position: 'absolute',
    left: -9999,
    top: -9999,
    opacity: 0,
    pointerEvents: 'none',
  },
  menuCard: {
    position: 'absolute',
    top: 80,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minWidth: 200,
    overflow: 'hidden',
  },
  menuRow: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  menuText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
  },
  toast: {
    position: 'absolute',
    bottom: 40,
    left: theme.spacing.xl,
    right: theme.spacing.xl,
    backgroundColor: theme.colors.fg,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  toastText: {
    color: theme.colors.bg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  modalTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: theme.font.size.sm,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.sm,
  },
  actionSecondary: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionSecondaryText: {
    color: theme.colors.fg,
    fontWeight: '600',
  },
  actionPrimary: {
    backgroundColor: theme.colors.fg,
  },
  actionPrimaryText: {
    color: theme.colors.bg,
    fontWeight: '700',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  removeButton: {
    alignSelf: 'flex-start',
    paddingVertical: theme.spacing.xs,
  },
  removeText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    textDecorationLine: 'underline',
  },
  pickupSection: {
    width: '100%',
    marginTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  pickupHelp: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  pickupCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  pickupCardMuted: { opacity: 0.6 },
  pickupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickupOrderId: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '700',
  },
  pickupStatus: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  pickupItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  pickupItemName: {
    flex: 1,
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
  pickupItemQty: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
});
