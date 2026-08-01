// EditGarageSheet — bottom sheet form for PATCH /me/garage (plan §8.3).
//
// Client-side validation pre-empts most round-trips, but the API still owns
// truth. Error mapping (per §C7):
//   - 409                                 → slugTaken
//   - 400 { error: 'invalid_slug' }       → invalidSlug      (regex violation)
//   - 400 { error: 'reserved_slug' }      → reservedSlug
//   - anything else                       → saveFailed toast
// The local validator surfaces `'invalid_slug'` for both wrong-chars and
// length-zero, mapping both to invalidSlug copy (length-40+ is blocked by
// `maxLength` on the input).

import { brand } from '@ccc/design';
import { GARAGE_RESERVED_SLUGS, type GarageOwner, type GaragePatch } from '@ccc/shared/garage';
import { SheetShell } from '@ccc/ui';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ApiError } from '~/api/client';
import { patchGarage } from '~/api/garage';
import { garageCopy } from '~/copy/garage';
import { showMessage } from '~/lib/confirm';

type Props = {
  visible: boolean;
  garage: GarageOwner;
  onClose: () => void;
  onSaved: (next: GarageOwner) => void;
};

const SLUG_RE = /^[a-z0-9-]+$/;

const validate = (input: { name: string; slug: string; description: string }): string | null => {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 50) return 'invalid_name';
  const slug = input.slug.trim();
  if (slug.length === 0 || slug.length > 40) return 'invalid_slug_length';
  if (!SLUG_RE.test(slug)) return 'invalid_slug';
  if (GARAGE_RESERVED_SLUGS.has(slug)) return 'reserved_slug';
  if (input.description.length > 500) return 'invalid_description';
  return null;
};

export function EditGarageSheet({ visible, garage, onClose, onSaved }: Props) {
  const [name, setName] = useState(garage.name);
  const [slug, setSlug] = useState(garage.slug);
  const [description, setDescription] = useState(garage.description ?? '');
  const [isPublic, setIsPublic] = useState(garage.isPublic);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    field: 'name' | 'slug' | 'description';
    msg: string;
  } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(garage.name);
    setSlug(garage.slug);
    setDescription(garage.description ?? '');
    setIsPublic(garage.isPublic);
    setError(null);
  }, [visible, garage.id, garage.name, garage.slug, garage.description, garage.isPublic]);

  const handleSave = async () => {
    const v = validate({ name, slug, description });
    if (v === 'invalid_slug' || v === 'invalid_slug_length') {
      setError({ field: 'slug', msg: garageCopy.garage.invalidSlug });
      return;
    }
    if (v === 'reserved_slug') {
      setError({ field: 'slug', msg: garageCopy.garage.reservedSlug });
      return;
    }
    if (v === 'invalid_description') {
      setError({ field: 'description', msg: garageCopy.garage.descriptionTooLong });
      return;
    }
    if (v === 'invalid_name') {
      setError({ field: 'name', msg: garageCopy.garage.nameTooLong });
      return;
    }

    const patch: GaragePatch = {};
    if (name.trim() !== garage.name) patch.name = name.trim();
    if (slug.trim() !== garage.slug) patch.slug = slug.trim();
    const nextDescription = description.trim() === '' ? null : description.trim();
    if (nextDescription !== garage.description) patch.description = nextDescription;
    if (isPublic !== garage.isPublic) patch.isPublic = isPublic;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await patchGarage(patch);
      onSaved(res.garage);
      showMessage(garageCopy.garage.saveSuccess);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError({ field: 'slug', msg: garageCopy.garage.slugTaken });
      } else if (err instanceof ApiError && err.status === 400) {
        const body = err.body as { error?: string } | null | undefined;
        if (body?.error === 'reserved_slug') {
          setError({ field: 'slug', msg: garageCopy.garage.reservedSlug });
        } else if (body?.error === 'invalid_slug') {
          setError({ field: 'slug', msg: garageCopy.garage.invalidSlug });
        } else {
          showMessage(garageCopy.garage.saveFailed);
        }
      } else {
        showMessage(garageCopy.garage.saveFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetShell
      visible={visible}
      title={garageCopy.garage.editSheetTitle}
      onClose={onClose}
      testID="edit-garage-sheet"
    >
      <View style={styles.body}>
        <Field
          label={garageCopy.garage.editFieldNameLabel}
          error={error?.field === 'name' ? error.msg : undefined}
        >
          <TextInput value={name} onChangeText={setName} maxLength={50} style={styles.input} />
          <Counter value={name.length} max={50} />
        </Field>

        <Field
          label={garageCopy.garage.editFieldSlugLabel}
          hint={garageCopy.garage.editSlugHint}
          error={error?.field === 'slug' ? error.msg : undefined}
        >
          <View style={styles.slugWrap}>
            <Text style={styles.slugPrefix}>/g/</Text>
            <TextInput
              value={slug}
              onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              maxLength={40}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.slugInput]}
            />
          </View>
        </Field>

        <Field
          label={garageCopy.garage.editFieldDescriptionLabel}
          error={error?.field === 'description' ? error.msg : undefined}
        >
          <TextInput
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            placeholder={garageCopy.garage.descriptionPlaceholder}
            placeholderTextColor="#8A8A93"
            style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
          />
          <Counter value={description.length} max={500} />
        </Field>

        <View style={styles.toggleRow}>
          <View style={styles.flex}>
            <Text style={styles.toggleTitle}>{garageCopy.garage.editToggleVisibilityLabel}</Text>
            <Text style={styles.toggleHint}>
              {isPublic
                ? garageCopy.garage.editVisibilityPublicConsequence(slug)
                : garageCopy.garage.visibilityPrivateHint}
            </Text>
          </View>
          <Switch value={isPublic} onValueChange={setIsPublic} disabled={submitting} />
        </View>

        <View style={styles.btnRow}>
          <Pressable
            onPress={onClose}
            disabled={submitting}
            style={styles.btnSecondary}
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryLabel}>{garageCopy.garage.editCancelLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSave()}
            disabled={submitting}
            style={styles.btnPrimary}
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryLabel}>{garageCopy.garage.editSaveLabel}</Text>
          </Pressable>
        </View>
      </View>
    </SheetShell>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  const near = value / max > 0.9;
  return (
    <Text style={[styles.counter, near && { color: '#F59E0B' }]}>
      {value}/{max}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 12 },
  field: {},
  fieldLabel: { color: '#C9C9CD', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  fieldHint: { color: '#8A8A93', fontSize: 11, marginTop: 4 },
  fieldError: { color: '#EF4444', fontSize: 11, marginTop: 4 },
  input: {
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F5F5F5',
    fontSize: 13,
  },
  slugWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  slugPrefix: { color: '#8A8A93', paddingLeft: 12, paddingRight: 8, fontSize: 13 },
  slugInput: { borderWidth: 0, backgroundColor: 'transparent', flex: 1, paddingLeft: 0 },
  counter: { color: '#8A8A93', fontSize: 10, marginTop: 4, textAlign: 'right' },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
  },
  toggleTitle: { color: '#F5F5F5', fontSize: 13, fontWeight: '600' },
  toggleHint: { color: '#8A8A93', fontSize: 11.5, marginTop: 2, lineHeight: 17 },
  flex: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1F1F1F',
    borderWidth: 1,
    borderColor: '#3A3A3A',
    alignItems: 'center',
  },
  btnSecondaryLabel: { color: '#F5F5F5', fontSize: 13, fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: brand.color.brand,
    alignItems: 'center',
  },
  btnPrimaryLabel: { color: '#0A0A0A', fontSize: 13, fontWeight: '700' },
});
