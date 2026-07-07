import { ALLOWED_IMAGE_TYPES, type PresignResponse, type UploadKind } from '@jdm/shared/uploads';
import * as ImagePicker from 'expo-image-picker';

import { requestPresign } from '~/api/uploads';

export type PickedImage = {
  uri: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  width: number;
  height: number;
};

const MIME_FROM_EXT: Record<string, PickedImage['mime']> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const ALLOWED_MIME = new Set<string>(ALLOWED_IMAGE_TYPES);

const inferMime = (asset: ImagePicker.ImagePickerAsset): PickedImage['mime'] | null => {
  if (asset.mimeType && ALLOWED_MIME.has(asset.mimeType)) {
    return asset.mimeType as PickedImage['mime'];
  }
  const ext = asset.uri.split('.').pop()?.toLowerCase() ?? '';
  return MIME_FROM_EXT[ext] ?? null;
};

export const pickImage = async (): Promise<PickedImage | null> => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    quality: 0.85,
    exif: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const mime = inferMime(asset);
  if (!mime) return null;
  return {
    uri: asset.uri,
    mime,
    size: asset.fileSize ?? 0,
    width: asset.width,
    height: asset.height,
  };
};

export const uploadBlobToR2 = async (blob: Blob, presign: PresignResponse): Promise<void> => {
  const res = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`upload failed (${res.status})`);
  }
};

export const pickAndUpload = async (
  kind: UploadKind,
): Promise<{ picked: PickedImage; presign: PresignResponse } | null> => {
  const picked = await pickImage();
  if (!picked) return null;
  const blob = await (await fetch(picked.uri)).blob();
  const presign = await requestPresign({
    kind,
    contentType: picked.mime,
    size: blob.size,
  });
  await uploadBlobToR2(blob, presign);
  return { picked, presign };
};
