import type { SupportTicket } from '@jdm/shared/support';
import { Image as LucideImage, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createSupportTicket, listOpenSupportTickets } from '~/api/support';
import { profileCopy } from '~/copy/profile';
import { pickAndUpload } from '~/lib/upload-image';
import { theme } from '~/theme';

const copy = profileCopy.support;

function StatusBadge({ status }: { status: SupportTicket['status'] }) {
  const isOpen = status === 'open';
  return (
    <View style={[styles.badge, isOpen ? styles.badgeOpen : styles.badgeClosed]}>
      <Text style={[styles.badgeText, isOpen ? styles.badgeTextOpen : styles.badgeTextClosed]}>
        {isOpen ? 'Aberto' : 'Fechado'}
      </Text>
    </View>
  );
}

function TicketRow({ ticket }: { ticket: SupportTicket }) {
  const date = new Date(ticket.createdAt).toLocaleDateString('pt-BR');
  return (
    <View style={styles.ticketRow}>
      <View style={styles.ticketHeader}>
        <StatusBadge status={ticket.status} />
        <Text style={styles.ticketDate}>
          {copy.ticketCreatedOn} {date}
        </Text>
      </View>
      <Text style={styles.ticketMessage} numberOfLines={2}>
        {ticket.message}
      </Text>
    </View>
  );
}

export default function SupportScreen() {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [attachedKey, setAttachedKey] = useState<string | null>(null);
  const [attachedUri, setAttachedUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (msg: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(msg);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  };

  const loadTickets = async () => {
    setLoadingTickets(true);
    try {
      setTickets(await listOpenSupportTickets());
    } catch {
      showBanner(copy.loadFailed);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    void loadTickets();
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, []);

  const onPickImage = async () => {
    const result = await pickAndUpload('support_attachment');
    if (!result) return;
    setAttachedKey(result.presign.objectKey);
    setAttachedUri(result.picked.uri);
  };

  const onRemoveImage = () => {
    setAttachedKey(null);
    setAttachedUri(null);
  };

  const onSubmit = async () => {
    if (submitting) return;
    if (!phone.trim()) {
      showBanner(copy.phoneRequired);
      return;
    }
    if (!message.trim()) {
      showBanner(copy.messageRequired);
      return;
    }
    setSubmitting(true);
    try {
      await createSupportTicket({
        phone,
        message,
        attachmentObjectKey: attachedKey ?? undefined,
      });
      setPhone('');
      setMessage('');
      setAttachedKey(null);
      setAttachedUri(null);
      showBanner(copy.submitted);
      await loadTickets();
    } catch {
      showBanner(copy.submitFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.explainer}>{copy.explainer}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{copy.phoneLabel}</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder={copy.phonePlaceholder}
          placeholderTextColor={theme.colors.muted}
          keyboardType="phone-pad"
          returnKeyType="next"
          editable={!submitting}
        />

        <Text style={styles.label}>{copy.messageLabel}</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={message}
          onChangeText={setMessage}
          placeholder={copy.messagePlaceholder}
          placeholderTextColor={theme.colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          editable={!submitting}
        />
        <Text style={styles.hint}>{copy.messageHint}</Text>

        {attachedUri ? (
          <View style={styles.attachmentRow}>
            <Image source={{ uri: attachedUri }} style={styles.thumbnail} />
            <Text style={styles.attachedLabel}>{copy.imageAttached}</Text>
            <Pressable onPress={onRemoveImage} accessibilityLabel={copy.removeImage}>
              <X color={theme.colors.muted} size={18} strokeWidth={1.75} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => void onPickImage()}
            style={styles.attachButton}
            accessibilityRole="button"
            accessibilityLabel={copy.attachImage}
            disabled={submitting}
          >
            <LucideImage color={theme.colors.muted} size={16} strokeWidth={1.75} />
            <Text style={styles.attachButtonText}>{copy.attachImage}</Text>
          </Pressable>
        )}

        {banner ? <Text style={styles.banner}>{banner}</Text> : null}

        <Pressable
          onPress={() => void onSubmit()}
          style={[styles.submitButton, submitting ? styles.submitButtonDisabled : null]}
          accessibilityRole="button"
          accessibilityLabel={submitting ? copy.submitting : copy.submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={theme.colors.bg} />
          ) : (
            <Text style={styles.submitButtonText}>{copy.submit}</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>{copy.openTicketsTitle}</Text>

      {loadingTickets ? (
        <ActivityIndicator style={styles.ticketsLoader} />
      ) : tickets.length === 0 ? (
        <Text style={styles.emptyText}>{copy.noOpenTickets}</Text>
      ) : (
        tickets.map((t) => <TicketRow key={t.id} ticket={t} />)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  card: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#111217',
  },
  explainer: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    lineHeight: 22,
  },
  label: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  input: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  textarea: {
    minHeight: 96,
  },
  hint: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
    marginTop: 4,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.md,
  },
  attachedLabel: {
    flex: 1,
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
  },
  attachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: 'dashed',
  },
  attachButtonText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  banner: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  submitButton: {
    backgroundColor: theme.colors.fg,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: theme.colors.bg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  sectionTitle: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    marginTop: theme.spacing.sm,
  },
  ticketsLoader: {
    marginTop: theme.spacing.md,
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
  },
  ticketRow: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#111217',
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketDate: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  ticketMessage: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    lineHeight: 20,
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radii.md,
  },
  badgeOpen: {
    backgroundColor: '#0F3020',
  },
  badgeClosed: {
    backgroundColor: '#2A2A30',
  },
  badgeText: {
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  badgeTextOpen: {
    color: '#4ADE80',
  },
  badgeTextClosed: {
    color: theme.colors.muted,
  },
});
