import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportTicketImage } from './export-ticket-image';

vi.mock('expo-media-library', () => ({
  requestPermissionsAsync: vi.fn(),
  saveToLibraryAsync: vi.fn(),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
}));

vi.mock('react-native-view-shot', () => ({
  captureRef: vi.fn(),
}));

function makeRef(): RefObject<View | null> {
  return { current: {} as View };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportTicketImage (native)', () => {
  it('shares the captured image via OS share sheet when sharing is available', async () => {
    vi.mocked(captureRef).mockResolvedValue('file:///tmp/ticket.png');
    vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    vi.mocked(Sharing.shareAsync).mockResolvedValue(undefined);

    const ref = makeRef();
    const result = await exportTicketImage(ref);

    expect(result).toBe('shared');
    expect(captureRef).toHaveBeenCalledWith(ref, expect.objectContaining({ format: 'png' }));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///tmp/ticket.png',
      expect.objectContaining({ mimeType: 'image/png', UTI: 'public.png' }),
    );
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('falls back to saving to gallery when sharing is unavailable', async () => {
    vi.mocked(captureRef).mockResolvedValue('file:///tmp/ticket.png');
    vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({
      granted: true,
    } as unknown as MediaLibrary.PermissionResponse);
    vi.mocked(MediaLibrary.saveToLibraryAsync).mockResolvedValue(undefined);

    const result = await exportTicketImage(makeRef());

    expect(result).toBe('saved');
    expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/ticket.png');
  });

  it('returns permission_denied when fallback media library permission is refused', async () => {
    vi.mocked(captureRef).mockResolvedValue('file:///tmp/ticket.png');
    vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
    vi.mocked(MediaLibrary.requestPermissionsAsync).mockResolvedValue({
      granted: false,
    } as unknown as MediaLibrary.PermissionResponse);

    const result = await exportTicketImage(makeRef());

    expect(result).toBe('permission_denied');
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns error when captureRef throws', async () => {
    vi.mocked(captureRef).mockRejectedValue(new Error('capture failed'));

    const result = await exportTicketImage(makeRef());
    expect(result).toBe('error');
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('returns error when shareAsync throws', async () => {
    vi.mocked(captureRef).mockResolvedValue('file:///tmp/ticket.png');
    vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
    vi.mocked(Sharing.shareAsync).mockRejectedValue(new Error('share failed'));

    const result = await exportTicketImage(makeRef());
    expect(result).toBe('error');
  });
});
