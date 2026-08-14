import type { Car } from '@ccc/shared/cars';
import type { FeedCommentResponse } from '@ccc/shared/feed';
import { PremiumBadge } from '@ccc/ui';
import { useEffect, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CarPickerPopover } from './CarPickerPopover';

import { createFeedComment, listFeedComments, reportFeedComment } from '~/api/feed';
import { useAuth } from '~/auth/context';
import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

type Props = {
  eventId: string;
  postId: string;
  commentCount: number;
  myCars: Car[];
  canPost: boolean;
};

export function FeedComments({ eventId, postId, commentCount, myCars, canPost }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState<FeedCommentResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { status: authStatus } = useAuth();
  const isAuthed = authStatus === 'authenticated';
  const selectedCar = myCars.find((car) => car.id === selectedCarId) ?? null;
  const canPickCar = myCars.length > 1;
  const hasCar = myCars.length > 0;
  const noProfileSelectedError = String(feedCopy.errors.noProfileSelected);
  const carLabel = selectedCar
    ? `${selectedCar.nickname ?? selectedCar.make} ${selectedCar.model}`
    : noProfileSelectedError;

  useEffect(() => {
    setSelectedCarId((current) => {
      if (!current) return myCars.length === 1 ? (myCars[0]?.id ?? null) : null;
      return myCars.some((car) => car.id === current) ? current : null;
    });
  }, [myCars]);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    void listFeedComments(eventId, postId, 1)
      .then((res) => {
        if (!cancelled) setComments(res.comments);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, eventId, postId]);

  const handleSubmit = async () => {
    if (!selectedCarId) {
      setSubmitError(noProfileSelectedError);
      return;
    }
    if (!draft.trim()) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const comment = await createFeedComment(eventId, postId, {
        body: draft.trim(),
        carId: selectedCarId,
      });
      setComments((prev) => [...prev, comment]);
      setDraft('');
    } catch {
      Alert.alert(feedCopy.errors.commentFailed);
    } finally {
      setSubmitting(false);
    }
  };

  if (commentCount === 0 && !expanded && !(canPost && isAuthed && hasCar)) return null;

  const handleReportComment = (comment: FeedCommentResponse) => {
    Alert.alert(feedCopy.post.report.title, feedCopy.post.report.prompt, [
      { text: feedCopy.post.report.cancel, style: 'cancel' },
      {
        text: feedCopy.post.report.submit,
        onPress: () => {
          void (async () => {
            try {
              await reportFeedComment(
                eventId,
                comment.id,
                `Denúncia via app — comentário ${comment.id}`,
              );
              Alert.alert(feedCopy.post.report.done);
            } catch {
              Alert.alert(feedCopy.post.report.error);
            }
          })();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? feedCopy.post.comments.hide : feedCopy.post.comments.show(commentCount)
        }
        hitSlop={8}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>
          {expanded ? feedCopy.post.comments.hide : feedCopy.post.comments.show(commentCount)}
        </Text>
      </Pressable>

      {expanded ? (
        <View style={styles.list}>
          {loading ? <ActivityIndicator size="small" color={theme.colors.muted} /> : null}
          {comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <View style={styles.commentAuthorRow}>
                <Text style={styles.commentAuthor}>
                  {c.car ? `${c.car.nickname ?? c.car.make} ${c.car.model}` : '—'}
                </Text>
                {c.car ? <PremiumBadge isPremiumActive={c.car.isPremiumActive} /> : null}
              </View>
              <Text style={styles.commentBody}>{c.body}</Text>
              {/* Guideline 1.2 applies to comments too, and a comment thread is
                  the classic harassment surface. Own comments are excluded the
                  same way posts are: reporting yourself is noise. Author identity
                  comes from car ownership, the only signal the payload carries,
                  so a car-less comment counts as yours and hides the control
                  rather than offering a self-report. */}
              {isAuthed && !(c.car ? myCars.some((mc) => mc.id === c.car?.id) : true) ? (
                <Pressable
                  onPress={() => handleReportComment(c)}
                  accessibilityRole="button"
                  accessibilityLabel={feedCopy.post.menu.report}
                  hitSlop={8}
                  style={styles.commentReportBtn}
                >
                  <Text style={styles.commentReportText}>{feedCopy.post.menu.report}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {canPost && isAuthed && hasCar ? (
            <>
              {canPickCar || !selectedCarId ? (
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`${feedCopy.composer.postingAs} ${carLabel}`}
                  style={styles.postingAsChip}
                >
                  <Text style={styles.postingAsLabel}>{feedCopy.composer.postingAs}</Text>
                  <Text style={styles.postingAsValue}>{carLabel}</Text>
                  {selectedCar ? (
                    <PremiumBadge isPremiumActive={selectedCar.isPremiumActive} />
                  ) : null}
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ) : null}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder={feedCopy.post.comments.placeholder}
                  placeholderTextColor={theme.colors.muted}
                  value={draft}
                  onChangeText={setDraft}
                  returnKeyType="send"
                  onSubmitEditing={() => void handleSubmit()}
                  editable={!submitting}
                  accessibilityLabel={feedCopy.post.comments.placeholder}
                />
                <Pressable
                  onPress={() => void handleSubmit()}
                  disabled={submitting || !draft.trim() || !selectedCarId}
                  style={styles.sendBtn}
                  accessibilityRole="button"
                  accessibilityLabel={feedCopy.post.comments.submit}
                  hitSlop={8}
                >
                  <Text style={styles.sendText}>{feedCopy.post.comments.submit}</Text>
                </Pressable>
              </View>
              {submitError ? <Text style={styles.commentErrorText}>{submitError}</Text> : null}
            </>
          ) : null}
          {canPost && isAuthed && !hasCar ? (
            <Text style={styles.commentNoCarText}>{feedCopy.composer.noCar_hint}</Text>
          ) : null}
        </View>
      ) : null}

      {canPickCar ? (
        <CarPickerPopover
          visible={pickerOpen}
          cars={myCars}
          selectedCarId={selectedCarId}
          onSelect={(car) => setSelectedCarId(car.id)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: theme.spacing.xs },
  toggle: { paddingVertical: theme.spacing.xs },
  toggleText: {
    color: theme.colors.accent,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  list: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  comment: { gap: 2 },
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  commentAuthor: {
    color: theme.colors.fg,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  commentReportBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  commentReportText: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  commentBody: { color: theme.colors.fg, fontSize: theme.font.size.sm },
  inputRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  input: {
    flex: 1,
    color: theme.colors.fg,
    backgroundColor: theme.colors.border,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.font.size.md,
  },
  sendBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  sendText: { color: theme.colors.accent, fontSize: theme.font.size.sm, fontWeight: '600' },
  postingAsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    backgroundColor: theme.colors.bg,
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  postingAsLabel: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  postingAsValue: { color: theme.colors.fg, fontWeight: '600', fontSize: theme.font.size.sm },
  chevron: { color: theme.colors.muted, fontSize: 18 },
  commentNoCarText: { color: theme.colors.muted, fontSize: theme.font.size.sm },
  commentErrorText: { color: theme.colors.accent, fontSize: theme.font.size.sm },
});
