'use server';

import { adminPresaleSettingsUpdateSchema } from '@ccc/shared/admin';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';

import { getPresaleSettings, searchPresaleOrders, updatePresaleSettings } from './admin-api';
import { ApiError, apiFetch } from './api';

export type PresaleFormState = { error: string | null };

const zodMessage = (issues: { message: string }[]): string =>
  issues.map((i) => i.message).join('; ');

const str = (fd: FormData, key: string): string | undefined => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
};

const num = (fd: FormData, key: string): number | undefined => {
  const v = fd.get(key);
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  return Number(v);
};

const bool = (fd: FormData, key: string): boolean => fd.get(key) === 'on';

// CEP ranges arrive as newline-separated "start:end" lines from a textarea.
const parseCepRanges = (raw: string | undefined): { start: string; end: string }[] =>
  (raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [start, end] = line.split(':');
      return { start: (start ?? '').trim(), end: (end ?? '').trim() };
    });

const PRESALE_PATH = '/loja/pre-venda';

export const updatePresaleSettingsAction = async (
  _prev: PresaleFormState,
  fd: FormData,
): Promise<PresaleFormState> => {
  const parsed = adminPresaleSettingsUpdateSchema.safeParse({
    enabled: bool(fd, 'enabled'),
    pickupAddress: str(fd, 'pickupAddress') ?? null,
    pickupHours: str(fd, 'pickupHours') ?? null,
    deliveryAreaLabel: str(fd, 'deliveryAreaLabel') ?? null,
    deliveryCepRanges: parseCepRanges(str(fd, 'deliveryCepRanges')),
    shippingFeeCents: num(fd, 'shippingFeeCents'),
    firstBatchLabel: str(fd, 'firstBatchLabel') ?? null,
  });
  if (!parsed.success) return { error: zodMessage(parsed.error.issues) };
  try {
    await updatePresaleSettings(parsed.data);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiError) return { error: e.message };
    return { error: 'Erro ao salvar configuracoes.' };
  }
  revalidatePath(PRESALE_PATH);
  return { error: null };
};
