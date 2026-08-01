'use server';

import { adminEventCreateSchema, adminEventUpdateSchema } from '@ccc/shared/admin';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  cancelAdminEvent,
  createAdminEvent,
  publishAdminEvent,
  unpublishAdminEvent,
  updateAdminEvent,
} from './admin-api';
import { ApiError } from './api';
import { toIso, toNumber } from './form-helpers';

// Values are echoed back to the form on error so the user does not have to
// re-type everything. React 19 resets form inputs after any <form action>
// settles; round-tripping the values via state + defaultValue is the
// simplest way to preserve them.
export type EventFormValues = Record<string, string>;
export type EventFormState = { error: string | null; values?: EventFormValues };

const revalidateEventPaths = (id: string) => {
  revalidatePath('/events');
  revalidatePath(`/events/${id}`);
};

const captureValues = (fd: FormData): EventFormValues => {
  const out: EventFormValues = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
};

const parseCheckbox = (value: unknown) => value === 'on' || value === 'true';

export const createEventAction = async (
  _prev: EventFormState,
  fd: FormData,
): Promise<EventFormState> => {
  const values = captureValues(fd);
  const parsed = adminEventCreateSchema.safeParse({
    slug: fd.get('slug'),
    title: fd.get('title'),
    description: fd.get('description'),
    coverObjectKey: (fd.get('coverObjectKey') as string) || null,
    startsAt: toIso(fd.get('startsAt')),
    endsAt: toIso(fd.get('endsAt')),
    venueName: fd.get('venueName'),
    venueAddress: fd.get('venueAddress'),
    city: fd.get('city'),
    stateCode: fd.get('stateCode'),
    type: fd.get('type'),
    capacity: toNumber(fd.get('capacity')),
    feedEnabled: parseCheckbox(fd.get('feedEnabled')),
    feedAccess: fd.get('feedAccess'),
    postingAccess: fd.get('postingAccess'),
    maxPostsPerUser: (() => {
      const v = fd.get('maxPostsPerUser');
      if (typeof v !== 'string' || v.trim() === '') return null;
      return Number(v);
    })(),
    maxPhotosPerUser: (() => {
      const v = fd.get('maxPhotosPerUser');
      if (typeof v !== 'string' || v.trim() === '') return undefined;
      return Number(v);
    })(),
    // Empty string -> null (unlimited tickets per user).
    maxTicketsPerUser: (() => {
      const v = fd.get('maxTicketsPerUser');
      if (typeof v !== 'string' || v.trim() === '') return null;
      return Number(v);
    })(),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      values,
    };
  }
  let created;
  try {
    created = await createAdminEvent(parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao criar.', values };
  }
  revalidatePath('/events');
  redirect(`/events/${created.id}`);
};

export const updateEventAction = async (
  id: string,
  _prev: EventFormState,
  fd: FormData,
): Promise<EventFormState> => {
  const values = captureValues(fd);
  const raw: Record<string, unknown> = {};
  for (const key of ['title', 'description', 'venueName', 'venueAddress', 'city', 'type']) {
    const v = fd.get(key);
    if (typeof v === 'string') raw[key] = v;
  }
  // stateCode: empty-string -> null so the user can clear a previously set value.
  const stateCode = fd.get('stateCode');
  if (typeof stateCode === 'string') raw.stateCode = stateCode === '' ? null : stateCode;
  const capacity = fd.get('capacity');
  if (typeof capacity === 'string' && capacity !== '') raw.capacity = Number(capacity);
  // maxTicketsPerUser: blank -> null (clear cap), value -> number.
  const maxTickets = fd.get('maxTicketsPerUser');
  if (typeof maxTickets === 'string') {
    raw.maxTicketsPerUser = maxTickets.trim() === '' ? null : Number(maxTickets);
  }
  const feedEnabled = fd.get('feedEnabled');
  raw.feedEnabled = parseCheckbox(feedEnabled);
  const feedAccess = fd.get('feedAccess');
  if (typeof feedAccess === 'string' && feedAccess !== '') raw.feedAccess = feedAccess;
  const postingAccess = fd.get('postingAccess');
  if (typeof postingAccess === 'string' && postingAccess !== '') raw.postingAccess = postingAccess;
  const maxPostsPerUser = fd.get('maxPostsPerUser');
  if (typeof maxPostsPerUser === 'string') {
    raw.maxPostsPerUser = maxPostsPerUser.trim() === '' ? null : Number(maxPostsPerUser);
  }
  const maxPhotosPerUser = fd.get('maxPhotosPerUser');
  if (typeof maxPhotosPerUser === 'string' && maxPhotosPerUser.trim() !== '') {
    raw.maxPhotosPerUser = Number(maxPhotosPerUser);
  }
  for (const key of ['startsAt', 'endsAt']) {
    const v = fd.get(key);
    if (typeof v === 'string' && v !== '') raw[key] = new Date(v).toISOString();
  }
  const coverKey = fd.get('coverObjectKey');
  if (typeof coverKey === 'string') raw.coverObjectKey = coverKey === '' ? null : coverKey;

  const parsed = adminEventUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      values,
    };
  }
  try {
    await updateAdminEvent(id, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message, values };
    return { error: 'Erro ao salvar.', values };
  }
  revalidateEventPaths(id);
  return { error: null };
};

export const publishEventAction = async (
  id: string,
  prev: EventFormState,
): Promise<EventFormState> => {
  void prev;
  try {
    await publishAdminEvent(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao publicar.' };
  }
  revalidateEventPaths(id);
  return { error: null };
};

export const unpublishEventAction = async (
  id: string,
  prev: EventFormState,
): Promise<EventFormState> => {
  void prev;
  try {
    await unpublishAdminEvent(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao despublicar.' };
  }
  revalidateEventPaths(id);
  return { error: null };
};

export const cancelEventAction = async (
  id: string,
  prev: EventFormState,
): Promise<EventFormState> => {
  void prev;
  try {
    await cancelAdminEvent(id);
  } catch (e) {
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao cancelar.' };
  }
  revalidateEventPaths(id);
  return { error: null };
};
