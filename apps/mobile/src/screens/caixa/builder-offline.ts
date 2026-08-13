// Caixa — minimal offline persistence for the builder selection. One draft per
// box, keyed nowhere (single slot); loadDraft returns null when the stored
// draft is for a different box (a new cycle), so a stale draft never leaks
// across cycles. No connectivity library: a dirty draft is resent on the next
// builder mount. Mirrors src/tickets/offline-storage.ts.

import { brand } from '@ccc/design';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

const STORAGE_KEY = `@${brand.app.storagePrefix}/caixa/builder-draft/v1`;

const selectionSchema = z.record(z.string(), z.number());

const draftSchema = z.object({
  version: z.literal(1),
  boxId: z.string(),
  savedAt: z.string(),
  dirty: z.boolean(),
  items: selectionSchema,
  partners: selectionSchema,
});

export type BuilderDraft = z.infer<typeof draftSchema>;

export async function loadDraft(boxId: string): Promise<BuilderDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success || parsed.data.boxId !== boxId) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function saveDraft(input: {
  boxId: string;
  items: Record<string, number>;
  partners: Record<string, number>;
  dirty: boolean;
}): Promise<void> {
  const draft: BuilderDraft = {
    version: 1,
    boxId: input.boxId,
    // savedAt is informational only; never used for ordering.
    savedAt: new Date().toISOString(),
    dirty: input.dirty,
    items: input.items,
    partners: input.partners,
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Best effort: a failed local persist must not break the builder.
  }
}

export async function clearDraft(boxId: string): Promise<void> {
  const existing = await loadDraft(boxId);
  if (!existing) return;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort.
  }
}
