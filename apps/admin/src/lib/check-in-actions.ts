'use server';

import type {
  CheckInExtraItem,
  ExtraClaimResponse,
  PickupVoucherClaimResponse,
  StorePickupOrder,
  TicketCheckInResponse,
} from '@ccc/shared/check-in';
import { unstable_rethrow } from 'next/navigation';

import {
  checkInTicket as apiCheckInTicket,
  claimExtraItem as apiClaimExtra,
  claimPickupVoucher as apiClaimVoucher,
} from './admin-api';
import { ApiError } from './api';

export type CheckInActionResult =
  | {
      ok: true;
      ticketId: string;
      result: 'admitted' | 'already_used';
      holder: string;
      tier: string;
      checkedInAt: string;
      car: { make: string; model: string; year: number; isPremiumActive: boolean } | null;
      licensePlate: string | null;
      extras: CheckInExtraItem[];
      storePickup: StorePickupOrder[];
    }
  | { ok: false; error: string; message: string };

export const submitCheckIn = async (
  code: string,
  eventId: string,
): Promise<CheckInActionResult> => {
  try {
    const res: TicketCheckInResponse = await apiCheckInTicket({ code, eventId });
    return {
      ok: true,
      ticketId: res.ticket.id,
      result: res.result,
      holder: res.ticket.holder.name,
      tier: res.ticket.tier.name,
      checkedInAt: res.ticket.checkedInAt,
      car: res.ticket.car ?? null,
      licensePlate: res.ticket.licensePlate ?? null,
      extras: res.ticket.extras,
      storePickup: res.storePickup,
    };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      return { ok: false, error: err.code, message: err.message };
    }
    return { ok: false, error: 'Unknown', message: 'erro inesperado' };
  }
};

export type ExtraClaimActionResult =
  | {
      ok: true;
      result: 'claimed' | 'already_used';
      name: string;
      holder: string;
      tier: string;
      usedAt: string | null;
    }
  | { ok: false; error: string; message: string };

export const submitExtraClaim = async (
  code: string,
  eventId: string,
): Promise<ExtraClaimActionResult> => {
  try {
    const res: ExtraClaimResponse = await apiClaimExtra({ code, eventId });
    return {
      ok: true,
      result: res.result,
      name: res.item.name,
      holder: res.item.holder.name,
      tier: res.item.tier.name,
      usedAt: res.item.usedAt,
    };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      return { ok: false, error: err.code, message: err.message };
    }
    return { ok: false, error: 'Unknown', message: 'erro inesperado' };
  }
};

export type VoucherClaimActionResult =
  | {
      ok: true;
      result: 'claimed' | 'already_used';
      voucher: PickupVoucherClaimResponse['voucher'];
    }
  | { ok: false; error: string; message: string };

export const submitVoucherClaim = async (
  code: string,
  eventId: string,
): Promise<VoucherClaimActionResult> => {
  try {
    const res: PickupVoucherClaimResponse = await apiClaimVoucher({ code, eventId });
    return { ok: true, result: res.result, voucher: res.voucher };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) {
      return { ok: false, error: err.code, message: err.message };
    }
    return { ok: false, error: 'Unknown', message: 'erro inesperado' };
  }
};
