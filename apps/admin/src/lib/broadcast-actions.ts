'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';

import {
  broadcastTargetSchema,
  createBroadcastRequestSchema,
  type BroadcastTarget,
  type CreateBroadcastRequest,
} from '../../../../packages/shared/src/broadcasts';
import type {
  NotificationDeliveryMode,
  NotificationDestination,
} from '../../../../packages/shared/src/notifications';

import { cancelAdminBroadcast, createAdminBroadcast, dryRunAdminBroadcast } from './admin-api';
import { ApiError } from './api';

export type BroadcastFormValues = Record<string, string>;
export type BroadcastFormState = {
  error: string | null;
  success: string | null;
  values?: BroadcastFormValues;
};

export type BroadcastDryRunState =
  | { ok: true; estimatedRecipients: number }
  | { ok: false; error: string };

const captureValues = (fd: FormData): BroadcastFormValues => {
  const out: BroadcastFormValues = {};
  for (const [key, value] of fd.entries()) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
};

const getTrimmedString = (value: FormDataEntryValue | null): string | null =>
  typeof value === 'string' ? value.trim() : null;

const parseScheduledAtInput = (
  raw: FormDataEntryValue | null,
  offsetMinutesInput: FormDataEntryValue | null,
): string => {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Informe a data e hora do envio.');
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Informe uma data de envio válida.');

  const offsetMinutes = Number(offsetMinutesInput);
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) {
    throw new Error('Fuso horário do agendamento inválido.');
  }

  const [, year, month, day, hour, minute] = match;
  const utcMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) +
    offsetMinutes * 60 * 1000;
  const parsed = new Date(utcMs);
  if (Number.isNaN(parsed.getTime())) throw new Error('Informe uma data de envio válida.');
  if (parsed.getTime() <= Date.now()) throw new Error('O agendamento deve estar no futuro.');
  return parsed.toISOString();
};

const parseTarget = (fd: FormData): BroadcastTarget => {
  const kind = fd.get('targetKind');
  if (kind === 'attendees_of_event') {
    return broadcastTargetSchema.parse({
      kind,
      eventId: fd.get('targetEventId'),
    });
  }
  if (kind === 'city') {
    const city = fd.get('targetCity');
    return broadcastTargetSchema.parse({
      kind,
      city: typeof city === 'string' ? city.trim() : '',
    });
  }
  return broadcastTargetSchema.parse({ kind });
};

const parseNotificationDeliveryMode = (fd: FormData): NotificationDeliveryMode => {
  const value = fd.get('notificationDeliveryMode');
  return value === 'in_app_only' ? 'in_app_only' : 'in_app_plus_push';
};

const parseDestination = (fd: FormData): NotificationDestination | undefined => {
  const kind = fd.get('destinationKind');
  if (kind === 'event') {
    const eventId = getTrimmedString(fd.get('destinationEventId'));
    if (!eventId) throw new Error('Selecione o evento de destino.');
    return { kind: 'event', eventId };
  }

  if (kind === 'product') {
    const productId = getTrimmedString(fd.get('destinationProductId'));
    if (!productId) throw new Error('Selecione o produto de destino.');
    return { kind: 'product', productId };
  }

  if (kind === 'tickets') return { kind: 'tickets' };

  if (kind === 'internal_path') {
    const path = getTrimmedString(fd.get('destinationInternalPath'));
    if (!path) throw new Error('Informe o caminho interno de destino.');
    if (!path.startsWith('/')) throw new Error('O caminho interno deve começar com /.');
    if (path.includes('://')) throw new Error('O caminho interno deve ser relativo ao app.');
    if (path.split('/').includes('..')) throw new Error('O caminho interno não pode subir pastas.');
    return { kind: 'internal_path', path };
  }

  if (kind === 'external_url') {
    const url = getTrimmedString(fd.get('destinationExternalUrl'));
    if (!url) throw new Error('Informe a URL externa de destino.');

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('A URL externa deve começar com http:// ou https://.');
      }
    } catch {
      throw new Error('Informe uma URL externa válida.');
    }

    return { kind: 'external_url', url };
  }

  return undefined;
};

const parseCreateInput = (fd: FormData): CreateBroadcastRequest =>
  (() => {
    const sendTiming = fd.get('sendTiming');
    let scheduledAt: string | undefined;
    if (sendTiming === 'schedule') {
      scheduledAt = parseScheduledAtInput(
        fd.get('scheduledAt'),
        fd.get('scheduledAtOffsetMinutes'),
      );
    }

    const title = fd.get('title');
    const body = fd.get('body');
    return createBroadcastRequestSchema.parse({
      title: getTrimmedString(title) ?? title,
      body: getTrimmedString(body) ?? body,
      data: {},
      target: parseTarget(fd),
      deliveryMode: parseNotificationDeliveryMode(fd),
      destination: parseDestination(fd),
      scheduledAt,
      sendNow: sendTiming === 'now' ? true : undefined,
    });
  })();

export const createBroadcastAction = async (
  _prev: BroadcastFormState,
  fd: FormData,
): Promise<BroadcastFormState> => {
  const values = captureValues(fd);

  let input: CreateBroadcastRequest;
  try {
    input = parseCreateInput(fd);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        error: error.issues.map((issue) => issue.message).join('; '),
        success: null,
        values,
      };
    }
    if (error instanceof Error) return { error: error.message, success: null, values };
    return { error: 'Dados inválidos para o broadcast.', success: null, values };
  }

  try {
    await createAdminBroadcast(input);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, success: null, values };
    return { error: 'Erro ao criar broadcast.', success: null, values };
  }

  revalidatePath('/broadcasts');
  return {
    error: null,
    success: input.sendNow ? 'Broadcast enviado para processamento.' : 'Broadcast agendado.',
  };
};

export const dryRunBroadcastAction = async (
  target: BroadcastTarget,
): Promise<BroadcastDryRunState> => {
  try {
    const parsed = broadcastTargetSchema.parse(target);
    const result = await dryRunAdminBroadcast({ target: parsed });
    return { ok: true, estimatedRecipients: result.estimatedRecipients };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    if (error instanceof Error) return { ok: false, error: error.message };
    return { ok: false, error: 'Não foi possível calcular o alcance.' };
  }
};

export const cancelBroadcastAction = async (id: string): Promise<{ error: string | null }> => {
  try {
    await cancelAdminBroadcast(id);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: 'Erro ao cancelar broadcast.' };
  }

  revalidatePath('/broadcasts');
  return { error: null };
};
