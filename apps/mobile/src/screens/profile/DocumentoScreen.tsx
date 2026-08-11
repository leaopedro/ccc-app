// Identity document upload screen. State machine per
// plans/perfil-progressivo-plan.md §4.5 (see documento-state.ts for the pure
// reducer that implements the table):
//
//   selecting_type -> capturing -> preview -> uploading -> sent | error
//   error -> preview (retryable), or hidden when a rate limit makes an
//   immediate retry pointless
//   sent -> navigates to `next`, or shows `pending`
//   pending/approved/rejected are read from GET /me/documents on mount, so a
//   returning user with a live or reviewed document skips the picker.
//
// `sent` has no distinct rendered state: the 201 response either navigates
// away immediately (when `next` is set) or lands directly on `pending`
// (when it is not), which is the same thing the table describes.
//
// Reached only from the profile menu and from the subscription flow (Mobile
// B), both post-verification, so the email-verification gate in
// app/_layout.tsx never intercepts a navigation to this screen.
import { DOCUMENT_ALREADY_PENDING_CODE, USER_DOCUMENT_TYPES } from '@ccc/shared/documents';
import type { UserDocumentType } from '@ccc/shared/documents';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useReducer, useRef } from 'react';
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
import { sanitizeNext } from '~/auth/redirect-intent';
import { profileCopy } from '~/copy/profile';
import { ImagePickerPermissionDeniedError, pickImage, type PickedImage } from '~/lib/upload-image';
import { DocumentTooLargeError, uploadDocument } from '~/lib/upload-document';
import { theme } from '~/theme';

import { documentoReducer, initialDocumentoState } from './documento-state';

const copy = profileCopy.documento;

const typeLabel = (type: UserDocumentType): string => (type === 'cnh' ? copy.typeCnh : copy.typeRg);

export default function DocumentoScreen() {
  const router = useRouter();
  const { next: nextParam } = useLocalSearchParams<{ next?: string }>();
  const next = sanitizeNext(nextParam);
  const [state, dispatch] = useReducer(documentoReducer, initialDocumentoState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshLatestState = useCallback(async () => {
    dispatch({ type: 'LOAD_STARTED' });
    try {
      const res = await listDocuments();
      if (!mountedRef.current) return;
      dispatch({ type: 'LOAD_RESOLVED', latest: res.items[0] ?? null });
    } catch {
      if (!mountedRef.current) return;
      dispatch({ type: 'LOAD_FAILED' });
    }
  }, []);

  useEffect(() => {
    void refreshLatestState();
  }, [refreshLatestState]);

  const startCapture = async (docType: UserDocumentType) => {
    dispatch({ type: 'CAPTURE_STARTED', docType });
    try {
      const picked = await pickImage();
      if (!picked) {
        dispatch({ type: 'CAPTURE_CANCELLED' });
        return;
      }
      dispatch({ type: 'CAPTURE_PICKED', picked });
    } catch (err) {
      if (err instanceof ImagePickerPermissionDeniedError) {
        dispatch({ type: 'CAPTURE_DENIED', message: copy.pickFailed });
        return;
      }
      dispatch({ type: 'CAPTURE_CANCELLED' });
    }
  };

  const handleSend = async (docType: UserDocumentType, picked: PickedImage) => {
    dispatch({ type: 'SEND_STARTED' });
    try {
      const document = await uploadDocument(docType, picked);
      if (next) {
        router.replace(next as never);
        return;
      }
      dispatch({ type: 'SEND_SUCCEEDED', document });
    } catch (err) {
      if (err instanceof DocumentTooLargeError) {
        dispatch({ type: 'SEND_FAILED', message: copy.tooLarge, retryable: true });
        return;
      }
      if (err instanceof ApiError && err.status === 429) {
        dispatch({ type: 'SEND_FAILED', message: copy.rateLimited, retryable: false });
        return;
      }
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        getApiErrorCode(err) === DOCUMENT_ALREADY_PENDING_CODE
      ) {
        // Handled as state, not as an error toast: the 409 means the same
        // thing a live document found on mount means.
        await refreshLatestState();
        return;
      }
      dispatch({ type: 'SEND_FAILED', message: copy.uploadFailed, retryable: true });
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
          {state.message ? <Text style={styles.errorText}>{state.message}</Text> : null}
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
    const showPrimaryAction = state.kind !== 'error' || state.retryable;
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
            {showPrimaryAction ? (
              <Pressable
                onPress={() =>
                  state.kind === 'error'
                    ? dispatch({ type: 'RETRY_REQUESTED' })
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
            ) : null}
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
          <>
            <Text style={styles.hint}>{copy.rejectedReasonLabel}</Text>
            <Text style={styles.hint}>{document.rejectionReason ?? copy.rejectedBody}</Text>
          </>
        ) : (
          <Text style={styles.hint}>{body}</Text>
        )}
        <Text style={styles.metaText}>
          {typeLabel(document.type)} · {copy.sentOn}{' '}
          {new Date(document.sentAt).toLocaleDateString('pt-BR')}
        </Text>
        {state.kind === 'rejected' ? (
          <Pressable
            onPress={() => dispatch({ type: 'RESET_TO_SELECTING' })}
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
