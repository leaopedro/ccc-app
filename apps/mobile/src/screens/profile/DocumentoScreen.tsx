// Identity document upload screen. State machine per
// plans/perfil-progressivo-plan.md §4.5:
//
//   selecting_type -> capturing -> preview -> uploading -> sent | error
//   error -> preview (retryable)
//   sent -> navigates to `next`, or shows `pending`
//   pending/approved/rejected are read from GET /me/documents on mount, so a
//   returning user with a live or reviewed document skips the picker.
//
// `sent` has no distinct rendered state: the 201 response either navigates
// away immediately (when `next` is set) or lands directly on `pending`
// (when it is not), which is the same thing the table describes.
import { DOCUMENT_ALREADY_PENDING_CODE, USER_DOCUMENT_TYPES } from '@ccc/shared/documents';
import type { UserDocument, UserDocumentType } from '@ccc/shared/documents';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError } from '~/api/client';
import { listDocuments } from '~/api/documents';
import { getApiErrorCode } from '~/api/errors';
import { profileCopy } from '~/copy/profile';
import { pickImage, type PickedImage } from '~/lib/upload-image';
import { DocumentTooLargeError, pickAndUploadDocument } from '~/lib/upload-document';
import { theme } from '~/theme';

const copy = profileCopy.documento;

const typeLabel = (type: UserDocumentType): string => (type === 'cnh' ? copy.typeCnh : copy.typeRg);

// A more permissive companion to auth/redirect-intent's sanitizeNext: that
// helper's allowlist is scoped to post-login redirects and does not include
// routes like /verify-email-pending, which this screen must support when
// reached from signup (and /assinaturas/... when reached from the
// subscription flow). Same core safety checks, no prefix allowlist: this
// param always comes from an in-app navigation, not a public redirect target.
const sanitizeDocumentNext = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 512) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw.includes('://')) return null;
  if (raw.includes('\n') || raw.includes('\r') || raw.includes('\t')) return null;
  return raw;
};

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'selecting_type' }
  | { kind: 'capturing'; type: UserDocumentType }
  | { kind: 'preview'; type: UserDocumentType; picked: PickedImage }
  | { kind: 'uploading'; type: UserDocumentType; picked: PickedImage }
  | { kind: 'error'; type: UserDocumentType; picked: PickedImage; message: string }
  | { kind: 'pending'; document: UserDocument | null }
  | { kind: 'approved'; document: UserDocument | null }
  | { kind: 'rejected'; document: UserDocument | null };

export default function DocumentoScreen() {
  const router = useRouter();
  const { next: nextParam } = useLocalSearchParams<{ next?: string }>();
  const next = sanitizeDocumentNext(nextParam);
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });

  const refreshLatestState = async () => {
    setState({ kind: 'loading' });
    try {
      const res = await listDocuments();
      const latest = res.items[0] ?? null;
      if (latest && (latest.status === 'pending' || latest.status === 'approved')) {
        setState({ kind: latest.status, document: latest });
        return;
      }
      if (latest && latest.status === 'rejected') {
        setState({ kind: 'rejected', document: latest });
        return;
      }
      setState({ kind: 'selecting_type' });
    } catch {
      // Fail open to the picker: worst case, a live document mid-flight
      // surfaces as a 409 on submit, handled the same way below.
      setState({ kind: 'selecting_type' });
    }
  };

  useEffect(() => {
    void refreshLatestState();
  }, []);

  const startCapture = async (type: UserDocumentType) => {
    setState({ kind: 'capturing', type });
    const picked = await pickImage();
    if (!picked) {
      setState({ kind: 'selecting_type' });
      return;
    }
    setState({ kind: 'preview', type, picked });
  };

  const handleSend = async (type: UserDocumentType, picked: PickedImage) => {
    setState({ kind: 'uploading', type, picked });
    try {
      const document = await pickAndUploadDocument(type, picked);
      if (next) {
        router.replace(next as never);
        return;
      }
      setState({ kind: 'pending', document });
    } catch (err) {
      if (err instanceof DocumentTooLargeError) {
        setState({ kind: 'error', type, picked, message: copy.tooLarge });
        return;
      }
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        getApiErrorCode(err) === DOCUMENT_ALREADY_PENDING_CODE
      ) {
        await refreshLatestState();
        return;
      }
      setState({ kind: 'error', type, picked, message: copy.uploadFailed });
    }
  };

  const goToNext = () => {
    if (next) router.replace(next as never);
  };

  if (state.kind === 'loading' || state.kind === 'capturing') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (state.kind === 'selecting_type') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.selectTypeTitle}</Text>
          <Text style={styles.hint}>{copy.selectTypeHint}</Text>
          <View style={styles.typeRow}>
            {USER_DOCUMENT_TYPES.map((type) => (
              <Pressable
                key={type}
                onPress={() => void startCapture(type)}
                accessibilityRole="button"
                accessibilityLabel={typeLabel(type)}
                style={styles.typeButton}
              >
                <Text style={styles.typeButtonText}>{typeLabel(type)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  }

  if (state.kind === 'preview' || state.kind === 'uploading' || state.kind === 'error') {
    const busy = state.kind === 'uploading';
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>{copy.previewTitle}</Text>
          <Image
            source={{ uri: state.picked.uri }}
            style={styles.previewImage}
            resizeMode="contain"
          />
          {state.kind === 'error' ? <Text style={styles.errorText}>{state.message}</Text> : null}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => void startCapture(state.type)}
              accessibilityRole="button"
              accessibilityLabel={copy.retake}
              disabled={busy}
              style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            >
              <Text style={styles.secondaryButtonText}>{copy.retake}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                state.kind === 'error'
                  ? setState({ kind: 'preview', type: state.type, picked: state.picked })
                  : void handleSend(state.type, state.picked)
              }
              accessibilityRole="button"
              accessibilityLabel={
                state.kind === 'error' ? copy.retry : busy ? copy.sending : copy.send
              }
              disabled={busy}
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.bg} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {state.kind === 'error' ? copy.retry : copy.send}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  // pending | approved | rejected
  const document = state.document;
  const title =
    state.kind === 'pending'
      ? copy.pendingTitle
      : state.kind === 'approved'
        ? copy.approvedTitle
        : copy.rejectedTitle;
  const body = state.kind === 'pending' ? copy.pendingBody : copy.approvedBody;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        {state.kind === 'rejected' ? (
          <Text style={styles.hint}>{document?.rejectionReason}</Text>
        ) : (
          <Text style={styles.hint}>{body}</Text>
        )}
        {document ? (
          <Text style={styles.metaText}>
            {typeLabel(document.type)} · {copy.sentOn}{' '}
            {new Date(document.sentAt).toLocaleDateString('pt-BR')}
          </Text>
        ) : null}
        {state.kind === 'rejected' ? (
          <Pressable
            onPress={() => setState({ kind: 'selecting_type' })}
            accessibilityRole="button"
            accessibilityLabel={copy.rejectedRetry}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{copy.rejectedRetry}</Text>
          </Pressable>
        ) : null}
        {next ? (
          <Pressable
            onPress={goToNext}
            accessibilityRole="button"
            accessibilityLabel={copy.continue}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>{copy.continue}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
    flexGrow: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  title: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  hint: {
    color: theme.colors.muted,
    fontSize: theme.font.size.md,
    lineHeight: 20,
  },
  metaText: {
    color: theme.colors.muted,
    fontSize: theme.font.size.sm,
  },
  errorText: {
    color: theme.colors.accent,
    fontSize: theme.font.size.sm,
  },
  typeRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  typeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  typeButtonText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.lg,
    fontWeight: '600',
  },
  previewImage: {
    width: '100%',
    height: 260,
    borderRadius: theme.radii.md,
    backgroundColor: '#000',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  primaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.fg,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
  },
  primaryButtonText: {
    color: theme.colors.bg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  secondaryButtonText: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
