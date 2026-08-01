import type { Car } from '@ccc/shared/cars';
import type { FeedPostResponse } from '@ccc/shared/feed';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CarPickerPopover } from './CarPickerPopover';

import { feedCopy } from '~/copy/feed';
import { theme } from '~/theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

type Props = {
  visible: boolean;
  cars: Car[];
  editingPost: FeedPostResponse | null;
  submitting: boolean;
  onSubmit: (body: string, carId: string | undefined) => void;
  onClose: () => void;
};

export function FeedComposerSheet({
  visible,
  cars,
  editingPost,
  submitting,
  onSubmit,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const [selectedCarId, setSelectedCarId] = useState<string | null>(cars[0]?.id ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [body, setBody] = useState('');

  useEffect(() => {
    if (editingPost) setBody(editingPost.body);
    else setBody('');
  }, [editingPost]);

  useEffect(() => {
    setSelectedCarId((prev) => {
      if (cars.length === 0) return null;
      const stillValid = prev != null && cars.some((c) => c.id === prev);
      return stillValid ? prev : (cars[0]?.id ?? null);
    });
  }, [cars]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Keyboard.dismiss();
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: SCREEN_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          setBody('');
        }
      });
    }
  }, [visible, translateY, backdropOpacity]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) return null;

  const isEditing = editingPost !== null;
  const selectedCar = cars.find((c) => c.id === selectedCarId) ?? null;
  const carLabel = selectedCar
    ? `${selectedCar.nickname ?? selectedCar.make} ${selectedCar.model}`
    : feedCopy.composer.postingAs;
  const canSubmit = body.trim().length > 0 && !submitting;
  const showPicker = !isEditing && cars.length > 1;
  const hasNoCar = !isEditing && cars.length === 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(body.trim(), selectedCarId ?? undefined);
  };

  return (
    <>
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Fechar compositor"
          accessibilityRole="button"
        />
      </Animated.View>

      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
        importantForAccessibility={visible ? 'yes' : 'no-hide-descendants'}
        aria-modal={Platform.OS !== 'ios' ? true : undefined}
        accessibilityViewIsModal={Platform.OS === 'ios'}
      >
        <View style={styles.handle} />

        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>
            {isEditing ? feedCopy.composer.edit : feedCopy.composer.placeholder}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={feedCopy.composer.cancel}
            hitSlop={8}
            style={styles.cancelBtn}
          >
            <Text style={styles.cancelText}>{feedCopy.composer.cancel}</Text>
          </Pressable>
        </View>

        {!hasNoCar ? (
          <Pressable
            onPress={showPicker ? () => setPickerOpen(true) : undefined}
            disabled={!showPicker}
            accessibilityRole={showPicker ? 'button' : 'text'}
            accessibilityLabel={`${feedCopy.composer.postingAs} ${carLabel}`}
            style={styles.postingAsChip}
          >
            <Text style={styles.postingAsLabel}>{feedCopy.composer.postingAs}</Text>
            <Text style={styles.postingAsValue}>{carLabel}</Text>
            {showPicker ? <Text style={styles.chevron}>›</Text> : null}
          </Pressable>
        ) : null}

        {hasNoCar ? (
          <View style={styles.noCarBox}>
            <Text style={styles.noCarText}>{feedCopy.composer.noCar_hint}</Text>
          </View>
        ) : null}

        {!hasNoCar ? (
          <TextInput
            style={styles.bodyInput}
            placeholder={feedCopy.composer.placeholder}
            placeholderTextColor={theme.colors.muted}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={2000}
            autoFocus
            editable={!submitting}
            accessibilityLabel={feedCopy.composer.placeholder}
          />
        ) : null}

        {!hasNoCar ? (
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitBtn, !canSubmit && styles.submitDisabled]}
            accessibilityRole="button"
            accessibilityLabel={
              submitting ? feedCopy.composer.submitting : feedCopy.composer.submit
            }
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.submitText}>
              {submitting ? feedCopy.composer.submitting : feedCopy.composer.submit}
            </Text>
          </Pressable>
        ) : null}
      </Animated.View>

      {showPicker ? (
        <CarPickerPopover
          visible={pickerOpen}
          cars={cars}
          selectedCarId={selectedCarId}
          onSelect={(car) => setSelectedCarId(car.id)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 10,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.border,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    paddingBottom: 32,
    paddingHorizontal: theme.spacing.lg,
    zIndex: 11,
    gap: theme.spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.muted,
    marginTop: theme.spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: { color: theme.colors.fg, fontWeight: '700', fontSize: theme.font.size.md },
  cancelBtn: { minHeight: 44, justifyContent: 'center' },
  cancelText: { color: theme.colors.muted, fontSize: theme.font.size.md },
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
  noCarBox: {
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.bg,
    gap: theme.spacing.sm,
  },
  noCarText: { color: theme.colors.muted, fontSize: theme.font.size.sm, textAlign: 'center' },
  bodyInput: {
    color: theme.colors.fg,
    fontSize: theme.font.size.md,
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radii.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: theme.colors.fg, fontWeight: '700', fontSize: theme.font.size.md },
});
