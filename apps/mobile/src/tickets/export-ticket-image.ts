import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

export type ExportResult = 'shared' | 'saved' | 'printed' | 'permission_denied' | 'error';

export async function exportTicketImage(ref: RefObject<View | null>): Promise<ExportResult> {
  let uri: string;
  try {
    uri = await captureRef(ref, { format: 'png', quality: 1 });
  } catch {
    return 'error';
  }

  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Compartilhar ingresso',
      });
      return 'shared';
    }
  } catch {
    return 'error';
  }

  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission.granted) return 'permission_denied';

  try {
    await MediaLibrary.saveToLibraryAsync(uri);
    return 'saved';
  } catch {
    return 'error';
  }
}
